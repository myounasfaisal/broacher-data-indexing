"""
Upload endpoints — admin/manager brochure extraction via the DB-worker pipeline.

POST /upload-jobs         accept one validated PDF: create a `documents` row and
                          retain the PDF, leaving it 'staged' — durable but NOT
                          claimable, so uploading costs nothing.
POST /upload-jobs/start   release the caller's staged uploads ('staged' ->
                          'pending'). THIS is where processing — and spending —
                          begins; the worker (app.worker) takes it from here.
GET  /upload-jobs         the caller's recent documents with live status/progress
                          (drives the progress UI; survives reloads — state is in
                          the DB).

The PDF is validated here (type, size, magic bytes) and read fully into memory
(never to disk). Splitting runs in a background task; extraction is the worker's
job. There is no in-memory queue any more — all state lives in Postgres.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)

from app.config import eff_int
from app.dependencies import require_admin, require_uploader
from app.rate_limit import limiter
from app.schemas.chemical import (
    DocumentListingsResponse,
    DocumentStatusListResponse,
    DocumentStatusOut,
    ListingOut,
    StartProcessingRequest,
    StartProcessingResult,
    UndoUploadResult,
    UploadHistoryItem,
    UploadHistoryResponse,
)
from app.services import database, pipeline_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["upload"])

# %PDF magic bytes — the real signature, not just a .pdf extension.
_PDF_MAGIC = b"%PDF-"


def _retain_and_ready(doc_id: str, pdf_bytes: bytes) -> None:
    """Store the source PDF, then flip the document to 'staged'.

    'staged' means uploaded and durable but NOT claimable: the user uploads a
    whole batch, sees it listed, and only then presses "Start processing"
    (POST /upload-jobs/start) to release it. Nothing costs an AI call before
    that. Done in the background so the request returns fast; the status flips
    only AFTER the PDF is retained, so a released document always has its PDF.
    On failure it's marked 'failed'."""
    try:
        pipeline_db.upload_source_pdf(doc_id, pdf_bytes)
        pipeline_db.set_document(doc_id, status="staged")
    except Exception:  # noqa: BLE001
        logger.exception("Failed to retain source PDF for document %s", doc_id)
        try:
            pipeline_db.set_document(doc_id, status="failed")
        except Exception:  # noqa: BLE001
            logger.exception("Could not mark document %s failed", doc_id)


def _status_from_doc(doc: dict, *, duplicate: bool = False) -> DocumentStatusOut:
    status_val = doc.get("status") or "pending"
    return DocumentStatusOut(
        id=str(doc.get("id") or ""),
        content_hash=doc.get("content_hash") or "",
        filename=doc.get("filename") or "",
        status=status_val,
        page_count=doc.get("page_count") or 0,
        pages_done=doc.get("pages_done")
        if doc.get("pages_done") is not None
        else (doc.get("page_count") or 0 if status_val == "done" else 0),
        product_count=doc.get("product_count") or 0,
        company_name=doc.get("company_name"),
        duplicate=duplicate,
        error=doc.get("error"),
        created_at=str(doc.get("created_at") or ""),
    )


@router.post(
    "/upload-jobs",
    response_model=DocumentStatusOut,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("120/minute")  # accepting is cheap; the worker paces AI calls
async def enqueue_brochure(
    request: Request,  # required by slowapi's limiter
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusOut:
    # --- Validate content type (don't trust the extension alone) ---
    if file.content_type not in ("application/pdf", "application/x-pdf"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF files are accepted.",
        )

    # --- Read into memory (never to disk) ---
    pdf_bytes = await file.read()

    # --- Validate size server-side (don't trust the client) ---
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    max_mb = eff_int("max_upload_size_mb")
    if len(pdf_bytes) > max_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {max_mb}MB limit.",
        )

    # --- Validate magic bytes ---
    if not pdf_bytes.startswith(_PDF_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File does not look like a valid PDF.",
        )

    import hashlib

    content_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # Dedup: an identical PDF already in the ledger is a no-op (no split, no AI).
    existing = database.find_document(content_hash)
    if existing is not None:
        return _status_from_doc(
            {**existing, "status": "done", "content_hash": content_hash},
            duplicate=True,
        )

    # Create the work-queue row, then retain the PDF + flip to 'pending' in the
    # background so the request returns immediately. The worker splits + extracts
    # it once it becomes claimable.
    doc = pipeline_db.create_document(
        content_hash, file.filename or "unknown.pdf", uploader_id
    )
    background_tasks.add_task(_retain_and_ready, str(doc["id"]), pdf_bytes)
    return _status_from_doc(doc)


@router.get("/upload-jobs", response_model=DocumentStatusListResponse)
async def list_upload_jobs(
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusListResponse:
    rows = pipeline_db.list_documents_status(uploader_id)
    return DocumentStatusListResponse(documents=[_status_from_doc(r) for r in rows])


def _owned_doc_or_403(doc_id: str, uploader_id: str) -> dict:
    """Fetch a document the caller may act on (its own, or any if admin)."""
    doc = pipeline_db.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    owner = str(doc["uploaded_by"]) if doc.get("uploaded_by") else None
    if owner != uploader_id and database.get_user_role(uploader_id) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only act on your own uploads.",
        )
    return doc


@router.post("/upload-jobs/start", response_model=StartProcessingResult)
async def start_processing(
    body: StartProcessingRequest | None = None,
    uploader_id: str = Depends(require_uploader),
) -> StartProcessingResult:
    """Release the caller's staged uploads for processing ('staged' -> 'pending').

    This is the "Start processing" button: uploading is free and durable, and
    this is the point where the batch starts costing AI calls. Scoped to the
    caller's own documents. With no body, every staged document is released;
    pass `document_ids` to release a subset.
    """
    doc_ids = body.document_ids if body else None
    rows = pipeline_db.start_documents(uploader_id, doc_ids)
    return StartProcessingResult(
        started=len(rows),
        documents=[_status_from_doc(r) for r in rows],
    )


@router.post("/upload-jobs/{doc_id}/discard", status_code=status.HTTP_204_NO_CONTENT)
async def discard_document(
    doc_id: str,
    uploader_id: str = Depends(require_uploader),
) -> None:
    """Delete a staged upload the user decided not to process. Only valid while
    the document is still 'staged' (nothing extracted yet) — once processing has
    started, use cancel, and undo-upload to remove the data it produced."""
    _owned_doc_or_403(doc_id, uploader_id)
    if not pipeline_db.discard_document(doc_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a staged upload can be discarded. Cancel it instead.",
        )


@router.post("/upload-jobs/{doc_id}/pause", response_model=DocumentStatusOut)
async def pause_document(
    doc_id: str,
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusOut:
    """Pause a document so the worker won't claim it. An in-flight page finishes
    first; no page is reprocessed on resume."""
    _owned_doc_or_403(doc_id, uploader_id)
    updated = pipeline_db.request_pause(doc_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return _status_from_doc(updated)


@router.post("/upload-jobs/{doc_id}/resume", response_model=DocumentStatusOut)
async def resume_document(
    doc_id: str,
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusOut:
    """Resume a paused document; the worker picks it up again at its first
    incomplete page."""
    _owned_doc_or_403(doc_id, uploader_id)
    updated = pipeline_db.resume_document(doc_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return _status_from_doc(updated)


@router.post("/upload-jobs/{doc_id}/cancel", response_model=DocumentStatusOut)
async def cancel_document(
    doc_id: str,
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusOut:
    """Request cancellation of a document still preparing/queued/extracting/paused.
    The worker stops at the next page boundary — anything already extracted is kept."""
    _owned_doc_or_403(doc_id, uploader_id)
    updated = pipeline_db.request_cancel(doc_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return _status_from_doc(updated)


@router.post("/upload-jobs/{doc_id}/restart", response_model=DocumentStatusOut)
async def restart_document(
    doc_id: str,
    uploader_id: str = Depends(require_uploader),
) -> DocumentStatusOut:
    """Re-queue a failed/cancelled document; the worker resumes at its first
    incomplete page (pages already done are not reprocessed)."""
    _owned_doc_or_403(doc_id, uploader_id)
    updated = pipeline_db.restart_document(doc_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return _status_from_doc(updated)


# ---------------------------------------------------------------------
# Upload history (persistent — survives backend restarts, unlike the queue)
# ---------------------------------------------------------------------
# Date-range filter → how far back to include. "all" = no cutoff.
DateRange = Literal["week", "month", "year", "all"]
_RANGE_DAYS: dict[str, int] = {"week": 7, "month": 30, "year": 365}


def _range_since(date_range: str) -> datetime | None:
    """Map a range label to a cutoff instant (None for 'all')."""
    days = _RANGE_DAYS.get(date_range)
    if days is None:
        return None
    return datetime.now(timezone.utc) - timedelta(days=days)


def _to_history_item(row: dict, email: str | None = None) -> UploadHistoryItem:
    return UploadHistoryItem(
        content_hash=row.get("content_hash", ""),
        filename=row.get("filename") or "",
        company_name=row.get("company_name") or "",
        company_name_en=row.get("company_name_en") or "",
        product_count=row.get("product_count") or 0,
        uploaded_by=str(row["uploaded_by"]) if row.get("uploaded_by") else None,
        uploaded_by_email=email,
        created_at=str(row.get("created_at") or ""),
    )


@router.get("/uploads/history", response_model=UploadHistoryResponse)
async def upload_history(
    date_range: DateRange = Query("all", alias="range"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    uploader_id: str = Depends(require_uploader),
) -> UploadHistoryResponse:
    """
    The caller's own past uploads (filename, company, count, date), filtered by
    date range (week/month/year/all) and server-paginated.
    """
    rows, total = database.list_documents(
        uploaded_by=uploader_id,
        since=_range_since(date_range),
        page=page,
        page_size=page_size,
    )
    return UploadHistoryResponse(
        items=[_to_history_item(r) for r in rows],
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/uploads/history/all", response_model=UploadHistoryResponse)
async def all_upload_history(
    date_range: DateRange = Query("all", alias="range"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    _admin_id: str = Depends(require_admin),
) -> UploadHistoryResponse:
    """
    Admin audit: every upload with who uploaded it, when, and how many rows —
    filtered by date range and server-paginated. Only the current page's rows
    are fetched, so the ledger can grow to thousands without a heavy query.
    """
    rows, total = database.list_documents(
        since=_range_since(date_range),
        page=page,
        page_size=page_size,
    )
    ids = {str(r["uploaded_by"]) for r in rows if r.get("uploaded_by")}
    emails = database.get_user_emails(ids)
    return UploadHistoryResponse(
        items=[
            _to_history_item(r, emails.get(str(r.get("uploaded_by"))))
            for r in rows
        ],
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
    )


@router.get(
    "/uploads/{content_hash}/listings",
    response_model=DocumentListingsResponse,
)
async def document_listings(
    content_hash: str,
    uploader_id: str = Depends(require_uploader),
) -> DocumentListingsResponse:
    """
    The listings a single upload produced ("which ones were added"). Admins can
    view any upload; a manager can view only their own.
    """
    doc = database.get_document(content_hash)
    if doc is None:
        raise HTTPException(status_code=404, detail="Upload record not found.")

    owner = str(doc["uploaded_by"]) if doc.get("uploaded_by") else None
    if owner != uploader_id and database.get_user_role(uploader_id) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view listings from your own uploads.",
        )

    rows = database.get_listings_by_ids(doc.get("listing_ids") or [])
    return DocumentListingsResponse(
        content_hash=content_hash,
        filename=doc.get("filename") or "",
        listings=[ListingOut(**r) for r in rows],
    )


@router.delete("/uploads/{content_hash}", response_model=UndoUploadResult)
async def undo_upload(
    content_hash: str,
    uploader_id: str = Depends(require_uploader),
) -> UndoUploadResult:
    """
    Undo one upload: delete the listings it produced and its ledger row, so
    the same PDF can be re-uploaded and processed fresh. Admins can undo any
    upload; a manager only their own. Listings that another upload also
    produced are kept (deleting them would corrupt that upload's data).
    """
    doc = database.get_document(content_hash)
    if doc is None:
        raise HTTPException(status_code=404, detail="Upload record not found.")

    owner = str(doc["uploaded_by"]) if doc.get("uploaded_by") else None
    if owner != uploader_id and database.get_user_role(uploader_id) != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only undo your own uploads.",
        )

    deleted, kept = database.delete_document_and_listings(
        content_hash, [str(i) for i in (doc.get("listing_ids") or [])]
    )
    logger.info(
        "Upload %s undone by %s: %d listings deleted, %d kept (shared)",
        content_hash[:12],
        uploader_id,
        deleted,
        kept,
    )
    database.audit(
        uploader_id,
        "undo_upload",
        {
            "content_hash": content_hash,
            "filename": doc.get("filename"),
            "deleted_listings": deleted,
            "kept_shared": kept,
        },
    )
    return UndoUploadResult(deleted_listings=deleted, kept_shared=kept)
