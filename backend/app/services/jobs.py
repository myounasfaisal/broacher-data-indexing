"""
In-memory upload job queue with per-job controls.

PDFs are enqueued by the upload router and processed sequentially by one
background worker, so extraction never hammers the AI provider and per-file
progress is trivially ordered. Job state lives on the SERVER — that is what
lets the frontend restore the queue (and live progress) after a page reload,
and what makes pause / resume / cancel / restart / remove work per file.

Lifecycle:  queued → processing → done
                 ↘ paused ↗            ↘ failed
                                        ↘ cancelled

Controls (see apply_action):
  - pause   : a QUEUED file → paused (worker won't pick it up)
  - resume  : a PAUSED file → queued
  - cancel  : queued/paused/processing → cancelled. A processing file's AI call
              can't be interrupted (it finishes in the background), but its
              result is dropped and no further products are saved.
  - restart : a FAILED/CANCELLED file → queued again (its PDF bytes are kept
              for exactly this reason; a re-run is idempotent thanks to the
              listing dedup key).
  - remove  : drop the job from the list entirely (cancels first if running).

Memory model: PDF bytes are held while a job is queued/paused/processing, and
also kept for failed/cancelled jobs so they can be restarted; they are dropped
on success (a re-upload would be skipped by the document-hash guard anyway) and
on removal. Finished records are pruned after _RETENTION_SECONDS. Everything is
lost on backend restart — acceptable for this internal tool.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.services import database, dedup
from app.services.extraction import ExtractionError, extract_brochure

logger = logging.getLogger(__name__)

_RETENTION_SECONDS = 6 * 60 * 60  # keep finished jobs visible for 6 hours
_MAX_PENDING_BYTES = 512 * 1024 * 1024  # refuse new uploads past ~512MB queued

# Statuses that still hold work (count toward the pending-bytes cap).
_PENDING = ("queued", "paused", "processing")
# Statuses a job can be removed/cleared from once finished.
_FINISHED = ("done", "failed", "cancelled")


class QueueFullError(Exception):
    """Raised when the pending-bytes cap would be exceeded."""


class JobCancelled(Exception):
    """Internal signal: processing was cancelled by the user mid-flight."""


@dataclass
class UploadJob:
    id: str
    user_id: str
    filename: str
    status: str = "queued"  # queued|processing|paused|done|failed|cancelled
    stage: str = "Waiting in queue"
    company_name: str | None = None
    products_found: int = 0
    listings_inserted: int = 0
    needs_review: int = 0
    duplicate: bool = False  # true when skipped as an already-processed PDF
    content_hash: str | None = None
    company_id: int | None = None  # resolved supplier id (for the document ledger)
    listing_ids: list[str] = field(default_factory=list)  # ids this run produced
    error: str | None = None
    cancel_requested: bool = False
    remove_when_done: bool = False  # set when 'remove' hits a processing job
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    pdf_bytes: bytes | None = None

    def touch(self) -> None:
        self.updated_at = time.time()

    def set_stage(self, message: str) -> None:
        self.stage = message
        self.touch()

    # --- which controls are valid right now (drives the UI buttons) ---
    @property
    def can_pause(self) -> bool:
        return self.status == "queued"

    @property
    def can_resume(self) -> bool:
        return self.status == "paused"

    @property
    def can_cancel(self) -> bool:
        return self.status in ("queued", "paused", "processing")

    @property
    def can_restart(self) -> bool:
        return self.status in ("failed", "cancelled") and self.pdf_bytes is not None

    @property
    def can_remove(self) -> bool:
        return True  # always removable (cancels first if it is running)

    def to_dict(self) -> dict[str, Any]:
        """Serializable view for the API (never includes the PDF bytes)."""
        return {
            "id": self.id,
            "filename": self.filename,
            "status": self.status,
            "stage": self.stage,
            "company_name": self.company_name,
            "products_found": self.products_found,
            "listings_inserted": self.listings_inserted,
            "needs_review": self.needs_review,
            "duplicate": self.duplicate,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "can_pause": self.can_pause,
            "can_resume": self.can_resume,
            "can_cancel": self.can_cancel,
            "can_restart": self.can_restart,
            "can_remove": self.can_remove,
        }


_jobs: dict[str, UploadJob] = {}
_worker_task: asyncio.Task | None = None
_wake: asyncio.Event | None = None
# PDF hashes currently pending in THIS run — guards against two identical files
# in the same batch both processing before the first records its document row
# (the DB ledger only exists after a job finishes).
_inflight_hashes: set[str] = set()


def _get_wake() -> asyncio.Event:
    global _wake
    if _wake is None:
        _wake = asyncio.Event()
    return _wake


def _ensure_worker() -> None:
    """Start the single background worker lazily, restarting if it died."""
    global _worker_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No event loop (e.g. called from a sync context); a subsequent
        # enqueue from within a request will start the worker.
        return
    if _worker_task is None or _worker_task.done():
        _worker_task = loop.create_task(_worker())


def _nudge_worker() -> None:
    """Wake the worker to re-scan for the next actionable job."""
    _get_wake().set()
    _ensure_worker()


async def enqueue(user_id: str, filename: str, pdf_bytes: bytes) -> UploadJob:
    """
    Queue one validated PDF for extraction; returns the created job.

    Deduplicates by PDF content hash: if this exact file was processed before
    (any filename), or is already pending in this batch, the job is returned
    already marked done — no AI call, no dedup, no inserts.
    """
    content_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # Already processed in a previous run? (DB ledger)
    existing = await asyncio.to_thread(database.find_document, content_hash)
    if existing is not None or content_hash in _inflight_hashes:
        job = UploadJob(
            id=uuid.uuid4().hex,
            user_id=user_id,
            filename=filename,
            status="done",
            duplicate=True,
            content_hash=content_hash,
        )
        when = existing.get("created_at") if existing else None
        job.set_stage(
            "Duplicate — this exact PDF was already processed"
            + (f" (first seen {str(when)[:10]})" if when else " in this batch")
            + "; skipped."
        )
        _jobs[job.id] = job
        return job

    pending = sum(len(j.pdf_bytes or b"") for j in _jobs.values() if j.status in _PENDING)
    if pending + len(pdf_bytes) > _MAX_PENDING_BYTES:
        raise QueueFullError(
            "Upload queue is full — wait for current files to finish."
        )

    job = UploadJob(
        id=uuid.uuid4().hex,
        user_id=user_id,
        filename=filename,
        content_hash=content_hash,
        pdf_bytes=pdf_bytes,
    )
    _jobs[job.id] = job
    _inflight_hashes.add(content_hash)
    _nudge_worker()
    return job


def jobs_for_user(user_id: str) -> list[UploadJob]:
    """All of a user's jobs, oldest first (prunes stale finished jobs)."""
    _prune()
    return sorted(
        (j for j in _jobs.values() if j.user_id == user_id),
        key=lambda j: j.created_at,
    )


def clear_finished(user_id: str) -> int:
    """Remove a user's done/failed/cancelled jobs; returns how many removed."""
    finished = [
        jid
        for jid, j in _jobs.items()
        if j.user_id == user_id and j.status in _FINISHED
    ]
    for jid in finished:
        _drop(jid)
    return len(finished)


class ActionError(Exception):
    """Raised when a control action is invalid for the job's current state."""


def apply_action(user_id: str, job_id: str, action: str) -> UploadJob | None:
    """
    Apply a control action to one of the caller's jobs. Returns the updated job,
    or None when the job was removed. Raises ActionError on an invalid action /
    KeyError-like (via ActionError) when the job isn't the caller's.
    """
    job = _jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise ActionError("Job not found.")

    if action == "pause":
        if not job.can_pause:
            raise ActionError("Only a queued file can be paused.")
        job.status = "paused"
        job.set_stage("Paused")

    elif action == "resume":
        if not job.can_resume:
            raise ActionError("Only a paused file can be resumed.")
        job.status = "queued"
        job.set_stage("Waiting in queue")
        _nudge_worker()

    elif action == "cancel":
        if not job.can_cancel:
            raise ActionError("This file can no longer be cancelled.")
        if job.status == "processing":
            # Can't interrupt the in-flight AI call; flag it so the worker
            # drops the result and stops saving further products.
            job.cancel_requested = True
            job.set_stage("Cancelling…")
        else:
            job.status = "cancelled"
            job.set_stage("Cancelled")
            if job.content_hash:
                _inflight_hashes.discard(job.content_hash)

    elif action == "restart":
        if not job.can_restart:
            raise ActionError("Only a failed or cancelled file can be restarted.")
        job.status = "queued"
        job.stage = "Waiting in queue"
        job.error = None
        job.cancel_requested = False
        job.listings_inserted = 0
        job.needs_review = 0
        job.products_found = 0
        job.listing_ids = []
        job.touch()
        if job.content_hash:
            _inflight_hashes.add(job.content_hash)
        _nudge_worker()

    elif action == "remove":
        if job.status == "processing":
            # Let the worker finish/abandon; mark cancelled + remove after.
            job.cancel_requested = True
            job.remove_when_done = True
            job.set_stage("Removing…")
            return job
        _drop(job_id)
        return None

    else:
        raise ActionError(f"Unknown action: {action}")

    return job


def _drop(job_id: str) -> None:
    """Remove a job entirely and release any resources it held."""
    job = _jobs.pop(job_id, None)
    if job is None:
        return
    job.pdf_bytes = None
    if job.content_hash and job.status not in ("done",):
        _inflight_hashes.discard(job.content_hash)


def _prune() -> None:
    now = time.time()
    stale = [
        jid
        for jid, j in _jobs.items()
        if j.status in _FINISHED and now - j.updated_at > _RETENTION_SECONDS
    ]
    for jid in stale:
        _drop(jid)


def _next_queued_job() -> UploadJob | None:
    """Oldest job that is ready to run (queued, not paused/cancelled)."""
    ready = [j for j in _jobs.values() if j.status == "queued"]
    ready.sort(key=lambda j: j.created_at)
    return ready[0] if ready else None


async def _worker() -> None:
    """Process ready jobs one at a time, forever; sleep when idle."""
    while True:
        job = _next_queued_job()
        if job is None:
            wake = _get_wake()
            wake.clear()
            # Re-check in case a job was queued between the scan and clear.
            if _next_queued_job() is None:
                await wake.wait()
            continue
        await _run_job(job)


async def _run_job(job: UploadJob) -> None:
    job.status = "processing"
    job.set_stage("Starting extraction…")
    try:
        if job.cancel_requested:
            raise JobCancelled()
        # Synchronous extraction/DB code runs off the event loop so status
        # polling stays responsive while a PDF processes.
        await asyncio.to_thread(_process, job)
        job.status = "done"
        job.set_stage(
            f"Done — {job.listings_inserted} listing(s) saved"
            + (f", {job.needs_review} flagged for review" if job.needs_review else "")
        )
    except JobCancelled:
        job.status = "cancelled"
        saved = job.listings_inserted
        job.set_stage(
            "Cancelled"
            + (f" — {saved} product(s) were already saved" if saved else "")
        )
    except ExtractionError as exc:
        logger.warning("Extraction failed for %s: %s", job.filename, exc)
        job.status = "failed"
        job.error = f"Could not extract data from this brochure: {exc}"
        job.set_stage("Failed")
    except Exception as exc:  # noqa: BLE001 — worker must never die
        logger.exception("Upload job %s crashed", job.id)
        job.status = "failed"
        job.error = str(exc)
        job.set_stage("Failed")
    finally:
        _finalize(job)


def _finalize(job: UploadJob) -> None:
    """Post-run bookkeeping: document ledger, in-flight hash, memory, removal."""
    # If the job was removed while processing, drop it now.
    if job.remove_when_done:
        _drop(job.id)
        return

    if job.content_hash:
        # Keep the hash reserved only while the file may still run again
        # (failed/cancelled can be restarted). Release otherwise.
        if job.status not in ("failed", "cancelled"):
            _inflight_hashes.discard(job.content_hash)
        if job.status == "done":
            try:
                database.record_document(
                    content_hash=job.content_hash,
                    filename=job.filename,
                    company_id=job.company_id,
                    product_count=job.listings_inserted,
                    uploaded_by=job.user_id,
                    listing_ids=job.listing_ids,
                )
            except Exception:  # noqa: BLE001 — ledger is best-effort
                logger.exception("Failed to record document hash for job %s", job.id)
            database.audit(
                job.user_id,
                "upload",
                {
                    "filename": job.filename,
                    "content_hash": job.content_hash,
                    "company": job.company_name,
                    "listings": job.listings_inserted,
                },
            )

    # Free PDF memory on success; keep it for failed/cancelled so they can be
    # restarted without a re-upload.
    if job.status not in ("failed", "cancelled"):
        job.pdf_bytes = None
    job.touch()


def _check_cancel(job: UploadJob) -> None:
    if job.cancel_requested:
        raise JobCancelled()


def _process(job: UploadJob) -> None:
    """Extract + dedup + persist one brochure, updating the job's stage."""
    assert job.pdf_bytes is not None

    _check_cancel(job)
    job.set_stage("Extracting products with the AI model…")
    result = extract_brochure(job.pdf_bytes)
    _check_cancel(job)  # cancel arrived during the (uninterruptible) AI call

    job.company_name = result.company_name_en or result.company_name
    job.products_found = len(result.products)
    job.set_stage(
        f"Found {job.products_found} product(s) from {job.company_name} — "
        "resolving company…"
    )
    company_id = database.resolve_company(
        result.company_name,
        result.company_name_en,
        email=result.company_email,
        contact_number=result.company_phone,
    )
    job.company_id = company_id

    total = len(result.products)
    for i, product in enumerate(result.products, start=1):
        _check_cancel(job)
        job.set_stage(f"Saving product {i}/{total}: {product.name_en}")
        chemical_id, review = dedup.resolve_chemical(
            name_en=product.name_en,
            cas_number=product.cas_number,
        )
        if review:
            job.needs_review += 1
        row = database.insert_listing(
            {
                "chemical_id": chemical_id,
                "company_id": company_id,
                "name_raw": product.name_raw,
                "name_en": product.name_en,
                "cas_number": product.cas_number,
                "price": product.price,
                "currency": product.currency,
                "purity": product.purity,
                "details": product.details or None,
                "company_website": result.company_website,
                "needs_review": review,
                "uploaded_by": job.user_id,
            }
        )
        if row.get("id"):
            job.listing_ids.append(str(row["id"]))
        job.listings_inserted += 1
