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
from datetime import datetime, timezone
from typing import Any

from app.services.database import _db_op, get_client

logger = logging.getLogger(__name__)

BUCKET = "brochure-pages"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Documents ────────────────────────────────────────────────────────────

@_db_op
def create_document(
    content_hash: str, filename: str, uploaded_by: str | None
) -> dict[str, Any]:
    """Insert a new work-queue document row in the non-claimable 'splitting'
    (preparing) state. The upload path stores the source PDF, then flips it to
    'staged' — uploaded and durable, but deliberately NOT claimable until the
    user presses "Start processing" (start_documents), so nothing costs an AI
    call until they say so. The worker splits lazily once released (a crash
    before split just re-splits from the PDF)."""
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
def touch_claim(doc_id: str) -> None:
    """Heartbeat: refresh claimed_at so the reconciler can tell a live worker
    making page-by-page progress from a dead one (stall detection)."""
    get_client().table("documents").update({"claimed_at": _now_iso()}).eq("id", doc_id).execute()


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


# Statuses from which a document can still be paused/cancelled (work outstanding).
_ACTIVE = ("pending", "splitting", "split", "extracting", "paused")


def _claimable_status(doc: dict[str, Any]) -> str:
    """Where a resumed/restarted document should go: 'split' if it already has
    page rows (resume extraction), else 'pending' (needs a first split)."""
    has_pages = bool(
        get_client()
        .table("pages")
        .select("id", count="exact")
        .eq("document_id", doc["id"])
        .limit(1)
        .execute()
        .count
    )
    return "split" if has_pages else "pending"


@_db_op
def request_cancel(doc_id: str) -> dict[str, Any] | None:
    """Flag a document for cancellation. If nothing is in flight (pending/split/
    paused), flip it straight to 'cancelled'. For 'splitting'/'extracting' we
    only set the flag; the worker stops at the next page boundary. Nothing
    already written (listings, supplier) is rolled back, and the PDF is retained."""
    client = get_client()
    doc = get_document(doc_id)
    if doc is None:
        return None
    if doc.get("status") in ("done", "failed", "cancelled"):
        return doc  # already terminal — nothing to cancel
    fields: dict[str, Any] = {"cancel_requested": True}
    if doc.get("status") in ("staged", "pending", "split", "paused"):
        fields["status"] = "cancelled"  # not in flight — cancel immediately
    client.table("documents").update(fields).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def request_pause(doc_id: str) -> dict[str, Any] | None:
    """Pause a document. This only sets status='paused' so claim_next_document
    excludes it — no page rows change. A doc actively 'extracting' is left for
    the worker to release at the next page boundary (it sees the status change);
    the current in-flight page still finishes."""
    doc = get_document(doc_id)
    if doc is None:
        return None
    if doc.get("status") not in _ACTIVE or doc.get("status") == "paused":
        return doc  # nothing to pause (already terminal or paused)
    get_client().table("documents").update({"status": "paused"}).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def resume_document(doc_id: str) -> dict[str, Any] | None:
    """Resume a paused document back to a claimable status. No page is
    reprocessed — the worker resumes at the first non-done page."""
    doc = get_document(doc_id)
    if doc is None or doc.get("status") != "paused":
        return doc
    get_client().table("documents").update({
        "status": _claimable_status(doc),
        "claimed_by": None,
        "claimed_at": None,
    }).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def restart_document(doc_id: str) -> dict[str, Any] | None:
    """Reset a failed/cancelled document so the worker re-claims it. If it has
    page rows, resume at the first incomplete page (no re-split): 'done' pages
    are kept, 'failed'/'dead' pages reset to 'pending'. If it has NO page rows
    (crashed before splitting), go to 'pending' so the worker re-splits from the
    retained PDF."""
    client = get_client()
    doc = get_document(doc_id)
    if doc is None or doc.get("status") not in ("failed", "cancelled"):
        return doc
    client.table("pages").update({"status": "pending", "error_message": None}).eq(
        "document_id", doc_id
    ).in_("status", ["failed", "dead"]).execute()
    client.table("documents").update({
        "status": _claimable_status(doc),
        "cancel_requested": False,
        "claimed_by": None,
        "claimed_at": None,
    }).eq("id", doc_id).execute()
    return get_document(doc_id)


@_db_op
def start_documents(uploader_id: str, doc_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Release staged documents for processing: 'staged' -> 'pending', which is
    the only thing standing between an uploaded PDF and the worker's claim query.

    Scoped to one uploader so a shared "Start processing" press can never release
    somebody else's staged batch. `doc_ids` narrows it further (None = all of the
    caller's staged documents). Documents already flagged for cancellation are
    skipped — releasing one would produce a document no worker will ever claim.

    Returns the released rows.
    """
    query = (
        get_client()
        .table("documents")
        .update({"status": "pending"})
        .eq("uploaded_by", uploader_id)
        .eq("status", "staged")
        .or_("cancel_requested.is.null,cancel_requested.is.false")
    )
    if doc_ids is not None:
        if not doc_ids:
            return []
        query = query.in_("id", doc_ids)
    rows = query.execute().data or []
    if rows:
        logger.info("Released %d staged document(s) for processing", len(rows))
    return rows


@_db_op
def discard_document(doc_id: str) -> bool:
    """Delete a staged document outright — the user changed their mind before
    spending anything on it. Safe precisely because 'staged' means nothing has
    run yet: no pages, no listings, no supplier. Drops the retained PDF too, so
    an abandoned upload leaves nothing behind.

    Returns False (and deletes nothing) if the document has moved past 'staged'
    — anything with extracted data must go through cancel/undo instead.
    """
    doc = get_document(doc_id)
    if doc is None or doc.get("status") != "staged":
        return False
    delete_source_pdf(doc_id)
    get_client().table("documents").delete().eq("id", doc_id).execute()
    logger.info("Discarded staged document %s (%s)", doc_id, doc.get("filename"))
    return True


def should_stop(doc_id: str) -> str | None:
    """Between-page check for the worker: returns 'cancel' if the user requested
    cancellation, 'pause' if the document was paused, else None."""
    doc = get_document(doc_id)
    if doc is None:
        return None
    if doc.get("cancel_requested"):
        return "cancel"
    if doc.get("status") == "paused":
        return "pause"
    return None


def all_pages_terminal(doc_id: str) -> bool:
    """True when every page of the document is in a terminal state (done/dead) —
    the condition for deleting the retained source PDF."""
    pages = list_pages(doc_id)
    return bool(pages) and all(p["status"] in ("done", "dead") for p in pages)


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

def source_pdf_path(doc_id: str) -> str:
    """Deterministic Storage key for a document's retained source PDF."""
    return f"{doc_id}/source.pdf"


def upload_source_pdf(doc_id: str, pdf_bytes: bytes) -> str:
    """Retain the source PDF in Storage so the worker can (re)split it — kept
    until every page is terminal, then deleted (see delete_source_pdf)."""
    path = source_pdf_path(doc_id)
    try:
        get_client().storage.from_(BUCKET).upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Failed to store source PDF {path}: {exc}") from exc
    return path


def source_pdf_exists(doc_id: str) -> bool:
    """Whether a retained source PDF still exists for this document (used by the
    reconciler to avoid re-queuing an unrecoverable no-pages document forever)."""
    try:
        items = get_client().storage.from_(BUCKET).list(doc_id)
        return any(i.get("name") == "source.pdf" for i in (items or []))
    except Exception:  # noqa: BLE001
        return False


def download_source_pdf(doc_id: str) -> bytes | None:
    """Fetch the retained source PDF, or None if it's already been deleted."""
    try:
        return get_client().storage.from_(BUCKET).download(source_pdf_path(doc_id))
    except Exception as exc:  # noqa: BLE001
        logger.info("No source PDF for document %s: %s", doc_id, exc)
        return None


def delete_source_pdf(doc_id: str) -> None:
    """Drop the retained source PDF (called once every page is terminal)."""
    try:
        get_client().storage.from_(BUCKET).remove([source_pdf_path(doc_id)])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not delete source PDF for %s: %s", doc_id, exc)


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


def delete_page_image(path: str) -> None:
    """Drop one page image once its page is 'done'.

    Called from the worker's page loop the moment a page succeeds, so peak
    Storage tracks work-in-progress rather than the whole corpus. Safe because a
    'done' page is never reprocessed (the worker skips it, restart only resets
    failed/dead pages) — so nothing will ever ask for this object again.

    NEVER call this for a page that isn't 'done': restart deliberately does not
    re-split when page rows exist, so a missing image would fail that page
    forever until it dead-letters. Best-effort — a failed delete leaks one
    object, which must not fail the page.
    """
    try:
        get_client().storage.from_(BUCKET).remove([path])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not delete page image %s: %s", path, exc)


def delete_page_images(doc_id: str, page_numbers: list[int]) -> None:
    """Bulk variant of delete_page_image for a document's finished pages."""
    if not page_numbers:
        return
    try:
        get_client().storage.from_(BUCKET).remove(
            [page_object_path(doc_id, n) for n in page_numbers]
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not delete page images for %s: %s", doc_id, exc)


def signed_page_url(path: str, expires_in: int = 3600) -> str | None:
    """A short-lived signed URL for the review UI to display a page image."""
    try:
        res = get_client().storage.from_(BUCKET).create_signed_url(path, expires_in)
        return res.get("signedURL") or res.get("signedUrl")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not sign URL for %s: %s", path, exc)
        return None
