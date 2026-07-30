"""
Reconciler — the pipeline's self-healing loop (IMPLEMENTATION_BRIEF.md §7).

Run as a SINGLE standalone process (one instance, unlike the workers):

    python -m app.reconciler

Every ~30s it sweeps the DB and fixes work that can't fix itself:
  1. Dead-letter pages that have failed too many times (surfaced in review,
     not retried forever).
  2. Finish documents whose every page is now terminal (done/dead) but which
     never got finalized — mark 'done' and delete the retained source PDF.
  3. Retry failed documents that still have retriable pages — reset to a
     claimable status so a worker resumes at the first non-done page.
     Skipped for documents the worker stopped for a fatal reason (bad key,
     no credit, unknown model, see documents.fatal) — retrying would just
     fail identically; only a manual Restart clears that flag.
  4. Reset documents stuck 'extracting' past the staleness timeout with no page
     heartbeat (their worker died) — back to claimable for another worker.

All state lives in Postgres; the reconciler holds nothing in memory. It never
deletes extracted listings or resolved suppliers — only status/page transitions
and the (already-superseded) source PDF.
"""

from __future__ import annotations

import logging
import signal
import time
from datetime import datetime, timezone
from typing import Any

from app.config import eff_int
from app.services import pipeline_db
from app.services.database import get_client

logger = logging.getLogger(__name__)

_TERMINAL_PAGE = ("done", "dead")
_RETRIABLE_PAGE = ("pending", "failed")

_stop = False


def _handle_stop(signum: int, _frame: Any) -> None:
    global _stop
    _stop = True
    logger.info("Reconciler received signal %s — exiting after this sweep", signum)


def _is_stale(claimed_at: str | None, stale_seconds: int) -> bool:
    """True if claimed_at is missing or older than the staleness window."""
    if not claimed_at:
        return True
    try:
        ts = datetime.fromisoformat(claimed_at)
    except ValueError:
        return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() > stale_seconds


def _claimable_status_for(pages: list[dict[str, Any]]) -> str:
    return "split" if pages else "pending"


def dead_letter_pages(max_attempts: int) -> int:
    """Mark pages that have failed >= max_attempts times as 'dead'. Returns the
    count dead-lettered."""
    resp = (
        get_client()
        .table("pages")
        .update({"status": "dead"})
        .eq("status", "failed")
        .gte("attempts", max_attempts)
        .execute()
    )
    n = len(resp.data or [])
    if n:
        logger.info("Dead-lettered %d page(s) over the retry limit", n)
    return n


def reconcile_documents(stale_seconds: int) -> dict[str, int]:
    """One pass over non-terminal documents: finish, retry, or reset each as
    appropriate. Returns a small tally for logging."""
    client = get_client()
    docs = (
        client.table("documents")
        .select("id, status, claimed_at, page_count, fatal")
        .in_("status", ["extracting", "failed"])
        .execute()
        .data
        or []
    )
    tally = {
        "finished": 0, "retried": 0, "reset_stalled": 0,
        "reset_nopages": 0, "unrecoverable": 0,
    }

    for doc in docs:
        doc_id = doc["id"]
        status = doc["status"]
        pages = pipeline_db.list_pages(doc_id)

        # No pages: crashed before/while splitting. Re-queue (worker re-splits
        # from the retained PDF) ONLY if the PDF is still retained — otherwise
        # it's unrecoverable and we leave it 'failed' rather than loop forever.
        if not pages:
            recoverable = pipeline_db.source_pdf_exists(doc_id)
            if recoverable and (
                status == "failed" or _is_stale(doc.get("claimed_at"), stale_seconds)
            ):
                pipeline_db.set_document(
                    doc_id, status="pending", claimed_by=None, claimed_at=None
                )
                tally["reset_nopages"] += 1
            elif not recoverable and status != "failed":
                pipeline_db.set_document(doc_id, status="failed")
                tally["unrecoverable"] += 1
            continue

        # Every page terminal → the document is genuinely finished, even if it
        # was left mid-flight. Finalize + drop the retained PDF.
        if all(p["status"] in _TERMINAL_PAGE for p in pages):
            pipeline_db.set_document(doc_id, status="done")
            pipeline_db.delete_source_pdf(doc_id)
            tally["finished"] += 1
            continue

        has_retriable = any(p["status"] in _RETRIABLE_PAGE for p in pages)

        # A document the worker deliberately stopped (bad key, no credit, an
        # unknown model) has "retriable" pages only because they were never
        # attempted — retrying would just fail the same way again. Leave it
        # failed until a human restarts it (which clears the flag).
        if doc.get("fatal"):
            continue

        # A failed document with pages still worth retrying → re-queue.
        if status == "failed" and has_retriable:
            pipeline_db.set_document(
                doc_id,
                status=_claimable_status_for(pages),
                claimed_by=None,
                claimed_at=None,
                cancel_requested=False,
            )
            tally["retried"] += 1
            continue

        # A claimed document whose worker went silent past the timeout → reset.
        if status == "extracting" and _is_stale(doc.get("claimed_at"), stale_seconds):
            pipeline_db.set_document(
                doc_id,
                status=_claimable_status_for(pages),
                claimed_by=None,
                claimed_at=None,
            )
            tally["reset_stalled"] += 1

    return tally


def reconcile_once() -> None:
    """A single reconciliation sweep."""
    try:
        dead_letter_pages(eff_int("max_page_attempts"))
        tally = reconcile_documents(eff_int("document_stale_seconds"))
        if any(tally.values()):
            logger.info("Reconcile sweep: %s", tally)
    except Exception:  # noqa: BLE001 — a bad sweep must never kill the loop
        logger.exception("Reconciliation sweep failed")


def run_forever(interval: float | None = None) -> None:
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    interval = interval or eff_int("reconciler_interval_seconds")
    logger.info(
        "Reconciler started (interval=%ss, stale=%ss, max_attempts=%s)",
        interval, eff_int("document_stale_seconds"), eff_int("max_page_attempts"),
    )
    while not _stop:
        reconcile_once()
        # Sleep in short slices so a stop signal is honored promptly.
        waited = 0.0
        while waited < interval and not _stop:
            time.sleep(min(2.0, interval - waited))
            waited += 2.0
    logger.info("Reconciler stopped")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run_forever()
