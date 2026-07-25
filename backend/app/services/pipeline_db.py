"""
Work-queue + Storage helpers for the DB-worker extraction pipeline.

All pipeline state lives in Postgres (documents/pages) and Supabase Storage
(page images) — there is no in-memory queue. These helpers wrap the queue
operations the splitter, worker, and reconciler need; they reuse the single
service-role client and the DatabaseError funnel from services.database rather
than opening their own connection.

Document lifecycle:
  pending -> splitting -> split -> extracting -> done | failed
Page lifecycle:
  pending -> extracting -> done | failed | dead
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.database import _db_op, get_client

logger = logging.getLogger(__name__)

BUCKET = "brochure-pages"


# ── Documents ────────────────────────────────────────────────────────────

@_db_op
def create_document(
    content_hash: str, filename: str, uploaded_by: str | None
) -> dict[str, Any]:
    """Insert a new work-queue document row (status='splitting'). The upload
    path calls this after the content-hash dedup check."""
    resp = (
        get_client()
        .table("documents")
        .insert({
            "content_hash": content_hash,
            "filename": filename,
            "uploaded_by": uploaded_by,
            "status": "splitting",
        })
        .execute()
    )
    return resp.data[0]


@_db_op
def set_document(doc_id: str, **fields: Any) -> None:
    """Patch arbitrary columns on a document row (status, page_count,
    running_context, company_id, ...)."""
    get_client().table("documents").update(fields).eq("id", doc_id).execute()


@_db_op
def claim_next_document(worker_id: str) -> dict[str, Any] | None:
    """Atomically claim the next ready document (longest-job-first) via the
    claim_next_document RPC. Returns the claimed row, or None if none available."""
    resp = get_client().rpc("claim_next_document", {"p_worker_id": worker_id}).execute()
    data = resp.data
    # The function returns a single documents row (or NULL). supabase-py may hand
    # it back as a dict, a 1-element list, or — when nothing matched — a row of
    # all-null columns. Treat a missing/null id as "nothing to claim".
    if not data:
        return None
    row = data[0] if isinstance(data, list) else data
    if not row or row.get("id") in (None, "None", ""):
        return None
    return row


@_db_op
def get_document(doc_id: str) -> dict[str, Any] | None:
    resp = get_client().table("documents").select("*").eq("id", doc_id).limit(1).execute()
    return (resp.data or [None])[0]


def is_cancel_requested(doc_id: str) -> bool:
    """Whether a user has asked to cancel this document (checked by the worker
    between pages)."""
    doc = get_document(doc_id)
    return bool(doc and doc.get("cancel_requested"))


@_db_op
def request_cancel(doc_id: str) -> dict[str, Any] | None:
    """Flag a document for cancellation. If it hasn't been claimed yet ('split'),
    flip it straight to 'cancelled' — there's nothing in flight. For 'splitting'
    or 'extracting' we only set the flag; the splitter/worker stop at the next
    safe point (never mid-page), and nothing already written is rolled back."""
    client = get_client()
    doc = get_document(doc_id)
    if doc is None:
        return None
    if doc.get("status") in ("done", "failed", "cancelled"):
        return doc  # already terminal — nothing to cancel
    fields: dict[str, Any] = {"cancel_requested": True}
    if doc.get("status") == "split":
        fields["status"] = "cancelled"
    client.table("documents").update(fields).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def restart_document(doc_id: str) -> dict[str, Any] | None:
    """Reset a failed/cancelled document so the worker re-claims it and resumes
    at its first incomplete page. Pages already 'done' are kept (not
    reprocessed); 'failed'/'dead' pages are reset to 'pending' for a retry."""
    client = get_client()
    doc = get_document(doc_id)
    if doc is None or doc.get("status") not in ("failed", "cancelled"):
        return doc
    client.table("pages").update({"status": "pending", "error_message": None}).eq(
        "document_id", doc_id
    ).in_("status", ["failed", "dead"]).execute()
    client.table("documents").update({
        "status": "split",
        "cancel_requested": False,
        "claimed_by": None,
        "claimed_at": None,
    }).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def list_documents_status(uploader_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """The caller's recent pipeline documents with derived progress (pages done /
    page_count) and resolved supplier name — drives the upload progress UI."""
    client = get_client()
    docs = (
        client.table("documents")
        .select("id, content_hash, filename, status, page_count, product_count, company_id, created_at")
        .eq("uploaded_by", uploader_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    for d in docs:
        if d.get("status") in ("done", "failed"):
            d["pages_done"] = d.get("page_count") or 0
        else:
            done = (
                client.table("pages")
                .select("id", count="exact")
                .eq("document_id", d["id"])
                .eq("status", "done")
                .execute()
            )
            d["pages_done"] = done.count or 0

    cids = [d["company_id"] for d in docs if d.get("company_id")]
    names: dict[int, str] = {}
    if cids:
        rows = (
            client.table("companies")
            .select("id, company_name, company_name_en")
            .in_("id", cids)
            .execute()
            .data
            or []
        )
        names = {r["id"]: (r.get("company_name_en") or r.get("company_name") or "") for r in rows}
    for d in docs:
        d["company_name"] = names.get(d.get("company_id"))
    return docs


# ── Pages ────────────────────────────────────────────────────────────────

@_db_op
def insert_page(doc_id: str, page_number: int, image_path: str) -> dict[str, Any]:
    resp = (
        get_client()
        .table("pages")
        .insert({
            "document_id": doc_id,
            "page_number": page_number,
            "image_path": image_path,
            "status": "pending",
        })
        .execute()
    )
    return resp.data[0]


@_db_op
def list_pages(doc_id: str) -> list[dict[str, Any]]:
    """All pages of a document, ordered by page_number (the worker's crash-resume
    point is the first row here whose status != 'done')."""
    resp = (
        get_client()
        .table("pages")
        .select("*")
        .eq("document_id", doc_id)
        .order("page_number")
        .execute()
    )
    return resp.data or []


@_db_op
def update_page(page_id: str, **fields: Any) -> None:
    get_client().table("pages").update(fields).eq("id", page_id).execute()


# ── Storage (page images) ────────────────────────────────────────────────

def page_object_path(doc_id: str, page_number: int) -> str:
    """Deterministic Storage key for a page image."""
    return f"{doc_id}/{page_number:04d}.png"


def upload_page_image(doc_id: str, page_number: int, png_bytes: bytes) -> str:
    """Upload one page PNG to the private bucket; returns its object path.
    Upserts so a re-split of the same document overwrites cleanly."""
    path = page_object_path(doc_id, page_number)
    try:
        get_client().storage.from_(BUCKET).upload(
            path,
            png_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001 — surface as a clear pipeline error
        raise RuntimeError(f"Failed to upload page image {path}: {exc}") from exc
    return path


def download_page_image(path: str) -> bytes:
    """Fetch a page PNG back from Storage (the worker reads what the splitter
    wrote, so a page image is never held in memory across the split→extract gap)."""
    return get_client().storage.from_(BUCKET).download(path)


def signed_page_url(path: str, expires_in: int = 3600) -> str | None:
    """A short-lived signed URL for the review UI to display a page image."""
    try:
        res = get_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
        return res.get("signedURL") or res.get("signedUrl")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not sign URL for %s: %s", path, exc)
        return None
