"""
DB extraction worker — one worker owns one document at a time and walks its
pages strictly in order (IMPLEMENTATION_BRIEF.md §2).

Run as a standalone process (locally or as a Railway service):

    python -m app.worker

Concurrency = number of these processes running; there is NO in-process page
scheduler and NO tuning against provider rate limits — each worker has exactly
one extraction call in flight at a time. All state lives in Postgres, so a crash
mid-document loses no completed pages: the reconciler resets a stalled claim and
the next worker resumes at the first page whose status != 'done'.

Loop:
  1. claim one ready document (longest-job-first, via claim_next_document RPC)
  2. resolve its supplier from the first/last pages
  3. for each page from the first incomplete one, in order:
       extract(image, running_context) -> write listings, update running_context
  4. mark the document done
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import time
from typing import Any

from app.config import eff_str
from app.services import (
    cas,
    dedup,
    extraction,
    ocr,
    page_extract,
    pipeline_db,
    splitter,
    supplier,
)
from app.services.database import get_client

logger = logging.getLogger(__name__)

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
_POLL_INTERVAL = 3.0  # seconds to wait when the queue is empty

_stop = False


def _handle_stop(signum: int, _frame: Any) -> None:
    global _stop
    _stop = True
    logger.info("Worker %s received signal %s — finishing current work then exiting", WORKER_ID, signum)


# ── Supplier identity (first two + last two pages) ───────────────────────

# Total pages the identity pass is willing to look at across the quick first
# try AND the wider retry — bounded so a bad first guess on a long catalog
# doesn't turn into scanning the whole document just to find a footer.
_IDENTITY_MAX_PAGES = 8


def _identity_pass(
    pages: list[dict[str, Any]], indices: list[int], provider: str
) -> dict[str, Any]:
    """One best-effort identity attempt over a specific set of page indices.

    On the Claude pipeline the pages go to Claude directly (native vision) —
    no Qwen OCR step, so a Claude-only setup never needs a Qwen key. Every
    other pipeline still OCRs with Qwen first, then completes the prompt on
    the configured provider."""
    try:
        images = [pipeline_db.download_page_image(pages[i]["image_path"]) for i in indices]
        if provider == "claude":
            raw = extraction.complete_claude_vision(
                images, extraction._COMPANY_PROMPT, max_tokens=300
            )
        else:
            text = ocr.ocr_pages(images)
            if not text.strip():
                return {}
            raw = extraction.complete_text(
                f"{extraction._COMPANY_PROMPT}\n\n--- PAGE TEXT ---\n{text}\n--- END ---",
                provider=provider,
                max_tokens=300,
            )
        return extraction._parse_json_soft(raw, page_no=0)
    except Exception as exc:  # noqa: BLE001 — identity is best-effort
        logger.warning("Company-identity pass failed for document: %s", exc)
        return {}


def _extract_identity(pages: list[dict[str, Any]]) -> dict[str, Any]:
    """Best-effort document-level company identity, cover/footer first.

    Most brochures print the supplier on the cover or the contact/footer
    page, so that's the cheap first try. When that comes back empty — some
    brochures bury contact details in an "About us" page instead — this
    widens to the next few not-yet-tried pages once before giving up, rather
    than leaving the document supplier-less over one bad guess at where to
    look."""
    if not pages:
        return {}
    n = len(pages)
    provider = eff_str("page_extract_provider")

    narrow = sorted({0, 1, n - 2, n - 1} & set(range(n)))
    identity = _identity_pass(pages, narrow, provider)
    if _has_identity(identity):
        return identity

    budget = _IDENTITY_MAX_PAGES - len(narrow)
    if budget > 0:
        unvisited = [i for i in range(n) if i not in narrow][:budget]
        if unvisited:
            logger.info(
                "No supplier identity on cover/footer — widening to page(s) %s",
                unvisited,
            )
            identity = _identity_pass(pages, unvisited, provider)
    return identity


def _has_identity(identity: dict[str, Any]) -> bool:
    return any(identity.get(k) for k in ("company_name", "company_website", "company_email"))


# ── Per-page listing writing (CAS normalization + review flags) ──────────

def _review_reasons(
    listing: page_extract.PageListing,
    cas_result: cas.CasNormalization,
    page_has_cas: bool,
    stage2_attempts: int,
) -> list[str]:
    """The needs_review triggers from IMPLEMENTATION_BRIEF.md §6."""
    reasons: list[str] = []
    if cas_result.canonical and not cas_result.checksum_ok:
        reasons.append("CAS checksum failed")
    if not (listing.name_raw or "").strip():
        reasons.append("Missing product name")
    if not listing.cas_number_raw and page_has_cas:
        reasons.append("CAS blank while sibling rows on the page have one")
    if stage2_attempts > 1:
        reasons.append("Page needed a stage-2 retry")
    if listing.confidence == "low":
        reasons.append("Model reported low confidence")
    return reasons


def _build_details(listing: page_extract.PageListing) -> dict[str, Any] | None:
    """Flatten a listing's flexible attributes into the `details` JSON column.

    `product_family` is a first-class field on the extraction schema (a grade row
    like "DA-100" is unfindable without the family label printed above it), but
    `details` is what search indexes and the UI renders — so it is merged in here
    rather than needing its own column. An explicit key the model already set in
    characteristics wins, so we never overwrite a more specific value.
    """
    details = dict(listing.characteristics or {})
    family = (listing.product_family or "").strip()
    if family:
        details.setdefault("product_family", family)
    return details or None


def _write_page_listings(
    doc: dict[str, Any],
    page: dict[str, Any],
    result: page_extract.PageExtraction,
    company_id: int | None,
    company_website: str | None,
) -> list[str]:
    """Insert every listing from one page; returns the inserted listing ids."""
    from app.services import database  # local import: avoid a heavy import cycle

    page_has_cas = any(l.cas_number_raw for l in result.listings)
    inserted: list[str] = []
    for listing in result.listings:
        cas_result = cas.normalize(listing.cas_number_raw)
        reasons = _review_reasons(listing, cas_result, page_has_cas, result.stage2_attempts)

        # Keep the canonical chemicals layer populated (CAS-first dedup) so
        # substance-level grouping in search keeps working.
        chemical_id, chem_review = dedup.resolve_chemical(
            name_en=listing.name_en,
            cas_number=cas_result.canonical,
        )
        if chem_review:
            reasons.append("Ambiguous chemical name match")

        row = database.insert_listing({
            "chemical_id": chemical_id,
            "company_id": company_id,
            "document_id": doc["id"],
            "source_page_id": page["id"],
            "name_raw": listing.name_raw,
            "name_en": listing.name_en,
            "cas_number": cas_result.canonical,
            "cas_number_raw": cas_result.raw,
            "price": listing.price,
            "currency": listing.currency,
            "purity": listing.purity,
            # Write flexible attributes to `details` — the column the rest of the
            # app reads (search_text/details_text index it, ProductDetail renders
            # it, the admin editor edits it). `characteristics` is not read anywhere.
            "details": _build_details(listing),
            # Per-listing supplier website, matching the old jobs.py write shape
            # (the suppliers directory + ProductDetail's website link read this).
            "company_website": company_website,
            "needs_review": bool(reasons),
            "review_reason": "; ".join(reasons) or None,
            "uploaded_by": doc.get("uploaded_by"),
        })
        if row.get("id"):
            inserted.append(str(row["id"]))
    return inserted


# ── Document processing ──────────────────────────────────────────────────

def process_document(doc: dict[str, Any]) -> None:
    doc_id = doc["id"]

    # Split lazily from the retained PDF if this document has no pages yet
    # (fresh upload, or a restart that crashed before splitting completed).
    pages = pipeline_db.list_pages(doc_id)
    if not pages:
        pdf = pipeline_db.download_source_pdf(doc_id)
        if pdf is None:
            logger.warning("Document %s has no pages and no source PDF — failing", doc_id)
            pipeline_db.set_document(
                doc_id, status="failed",
                error="The uploaded file is missing — try uploading it again.",
            )
            return
        try:
            splitter.split_document(doc_id, pdf)
        except splitter.SplitError as exc:
            logger.warning("Split failed for document %s: %s", doc_id, exc)
            pipeline_db.set_document(
                doc_id, status="failed",
                error="Couldn't open this file — check it's a valid PDF and try again.",
            )
            return
        pages = pipeline_db.list_pages(doc_id)

    # Supplier resolution — independent of per-page extraction (§4). Resolved up
    # front so every listing is stamped with company_id at insert time.
    company_id = doc.get("company_id")
    if company_id is None:
        identity = _extract_identity(pages)
        if _has_identity(identity):
            company_id = supplier.resolve_company(identity)
            pipeline_db.set_document(doc_id, company_id=company_id)

    # Denormalize the supplier website onto each listing (the suppliers directory
    # and ProductDetail read listings.company_website). Fetched from companies so
    # it's populated on a resume too, where identity isn't re-extracted.
    company_website: str | None = None
    if company_id:
        from app.services.database import get_client
        rows = (
            get_client().table("companies").select("website")
            .eq("id", company_id).limit(1).execute().data
        )
        company_website = (rows[0].get("website") if rows else None)

    running_context = doc.get("running_context")
    all_listing_ids: list[str] = []
    stopped: str | None = None  # 'cancel' | 'pause'

    for page in pages:
        if page["status"] == "done":
            continue  # crash-resume: already extracted
        # Pause/cancel are checked BETWEEN pages, never mid-page: the in-flight
        # extraction always finishes, then we stop claiming further pages.
        # Nothing already written is rolled back; the PDF is retained.
        stopped = pipeline_db.should_stop(doc_id)
        if stopped:
            logger.info(
                "Document %s %sd — stopping after %d listing(s)",
                doc_id, stopped, len(all_listing_ids),
            )
            break
        image = pipeline_db.download_page_image(page["image_path"])
        attempts = (page.get("attempts") or 0) + 1
        try:
            result = page_extract.extract(image, running_context)
        except page_extract.PageExtractError as exc:
            logger.warning("Page %s extraction failed: %s", page["id"], exc)
            pipeline_db.update_page(
                page["id"], status="failed", attempts=attempts, error_message=str(exc)
            )
            if exc.fatal:
                # A bad key / no credit / unknown model fails every remaining
                # page identically — stop this document now with a clear
                # reason instead of grinding through the rest one at a time.
                # fatal=True also tells the reconciler not to auto-retry this
                # one every ~30s (see reconciler.py) — its remaining pages are
                # still 'pending', which would otherwise look retriable.
                pipeline_db.set_document(doc_id, status="failed", error=str(exc), fatal=True)
                logger.error("Document %s stopped: %s", doc_id, exc)
                return
            continue

        listing_ids = _write_page_listings(doc, page, result, company_id, company_website)
        all_listing_ids.extend(listing_ids)

        pipeline_db.update_page(
            page["id"],
            status="done",
            attempts=attempts,
            markdown_output=result.markdown,
            raw_json=json.loads(result.model_dump_json())["listings"],
        )
        # The page is banked — drop its image immediately rather than at document
        # completion, so peak Storage tracks work-in-progress instead of the whole
        # corpus. Only ever for 'done' pages: a failed/dead page keeps its image
        # because restart resumes without re-splitting. markdown_output/raw_json
        # above are what debugging actually needs, and they persist.
        pipeline_db.delete_page_image(page["image_path"])
        # Heartbeat after each page so the reconciler sees ongoing progress and
        # doesn't reset a live worker on a long document.
        pipeline_db.touch_claim(doc_id)
        # Carry the running_context forward, persisted so a crash mid-document
        # resumes with the same table/family context.
        if result.next_context is not None:
            running_context = result.next_context
            pipeline_db.set_document(doc_id, running_context=running_context)

    # A pause leaves the document 'paused' (already set by the endpoint) and
    # keeps the PDF — do NOT finalize it as terminal. Record what it produced.
    if stopped == "pause":
        ids = _document_listing_ids(doc_id)
        pipeline_db.set_document(doc_id, product_count=len(ids), listing_ids=ids)
        return

    _finalize_document(doc_id, cancelled=(stopped == "cancel"))


def _document_listing_ids(doc_id: str) -> list[str]:
    """Every listing id this document has produced, read from the DB — complete
    even across a crash + resume (undo-upload depends on the full set, which the
    in-memory per-run list would miss for pages done in an earlier run)."""
    from app.services.database import get_client
    rows = (
        get_client().table("listings").select("id").eq("document_id", doc_id).execute().data
        or []
    )
    return [str(r["id"]) for r in rows]


def _finalize_document(doc_id: str, *, cancelled: bool = False) -> None:
    """Set the terminal status and record ledger fields (product_count,
    listing_ids) for upload history/undo. When cancelled or when a page still
    needs another attempt, the source PDF is RETAINED; only a genuinely finished
    document (every page terminal) is 'done', has its PDF deleted, and writes an
    upload audit entry (matching the old jobs.py path)."""
    from app.services import database

    fresh = pipeline_db.list_pages(doc_id)
    done = [p for p in fresh if p["status"] == "done"]
    non_terminal = [p for p in fresh if p["status"] in ("pending", "failed", "extracting", "claimed")]

    if cancelled:
        status = "cancelled"  # keep PDF — restartable
    elif non_terminal:
        status = "failed"  # a page still needs work — keep PDF for restart
    else:
        status = "done"  # every page terminal (done/dead) — finished

    listing_ids = _document_listing_ids(doc_id)
    fields: dict[str, Any] = {
        "status": status,
        "product_count": len(listing_ids),
        "listing_ids": listing_ids,
    }
    if status == "failed":
        # Give the user a reason, not just "failed" — the last page that
        # actually failed (not just still-queued) is the best summary.
        failed_pages = [p for p in non_terminal if p["status"] == "failed" and p.get("error_message")]
        if failed_pages:
            reason = failed_pages[-1]["error_message"]
            fields["error"] = (
                reason if len(failed_pages) == 1
                else f"{reason} ({len(failed_pages)} pages affected)"
            )
    pipeline_db.set_document(doc_id, **fields)

    # A genuinely finished document: drop the retained PDF and log the upload to
    # the activity feed (only on 'done', matching jobs.py._finalize).
    if status == "done":
        pipeline_db.delete_source_pdf(doc_id)
        doc = pipeline_db.get_document(doc_id) or {}
        try:
            database.audit(
                doc.get("uploaded_by"),
                "upload",
                {
                    "filename": doc.get("filename"),
                    "content_hash": doc.get("content_hash"),
                    "company_id": doc.get("company_id"),
                    "listings": len(listing_ids),
                },
            )
        except Exception:  # noqa: BLE001 — audit is best-effort, never fail the doc
            logger.exception("Failed to write upload audit for document %s", doc_id)

        # Refresh the semantic index for just the chemicals this upload
        # touched (P3). Best-effort by design: a finished document must never
        # be held back by an embedding provider, and the index is rebuildable
        # at any time with `python -m app.embed_backfill`.
        try:
            from app.services import embeddings

            stats = embeddings.refresh_document(doc_id)
            if stats["embedded"]:
                logger.info(
                    "Embedded %d chemical(s) for document %s",
                    stats["embedded"], doc_id,
                )
        except Exception:  # noqa: BLE001
            logger.exception("Embedding refresh failed for document %s", doc_id)

    logger.info(
        "Document %s %s — %d/%d pages done, %d listing(s)",
        doc_id, status, len(done), len(fresh), len(listing_ids),
    )


# ── Main loop ────────────────────────────────────────────────────────────

def run_forever(poll_interval: float = _POLL_INTERVAL) -> None:
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    logger.info("Extraction worker %s started (provider=%s)", WORKER_ID, eff_str("page_extract_provider"))
    while not _stop:
        try:
            doc = pipeline_db.claim_next_document(WORKER_ID)
        except Exception:  # noqa: BLE001 — never let the loop die on a transient error
            logger.exception("Claim query failed; backing off")
            time.sleep(poll_interval)
            continue
        if doc is None:
            time.sleep(poll_interval)
            continue
        try:
            process_document(doc)
        except Exception:  # noqa: BLE001 — a bad document must not kill the worker
            logger.exception("Document %s crashed during processing", doc.get("id"))
            try:
                pipeline_db.set_document(
                    doc["id"], status="failed",
                    error="Something unexpected stopped this upload. Restart to try again.",
                )
            except Exception:  # noqa: BLE001
                logger.exception("Could not mark document %s failed", doc.get("id"))
    logger.info("Worker %s stopped", WORKER_ID)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run_forever()
