"""
Upload endpoints — admin/manager brochure extraction via a server-side queue.

POST /upload-jobs           enqueue one validated PDF (returns the job)
GET  /upload-jobs           list the caller's jobs (drives the progress UI;
                            also how a reloaded page restores its queue)
POST /upload-jobs/clear-finished   remove the caller's done/failed jobs

The PDF is validated here (type, size, magic bytes), read fully into memory
(never to disk) and handed to the job queue, which processes files one at a
time in the background. See services/jobs.py.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)

from app.config import settings
from app.dependencies import require_admin, require_uploader
from app.rate_limit import limiter
from app.schemas.chemical import (
    DocumentListingsResponse,
    JobActionRequest,
    ListingOut,
    UndoUploadResult,
    UploadHistoryItem,
    UploadHistoryResponse,
    UploadJobOut,
    UploadJobsResponse,
)
from app.services import database, jobs

logger = logging.getLogger(__name__)

router = APIRouter(tags=["upload"])

# %PDF magic bytes — the real signature, not just a .pdf extension.
_PDF_MAGIC = b"%PDF-"


@router.post(
    "/upload-jobs",
    response_model=UploadJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("120/minute")  # enqueueing is cheap; the worker paces AI calls
async def enqueue_brochure(
    request: Request,  # required by slowapi's limiter
    file: UploadFile = File(...),
    uploader_id: str = Depends(require_uploader),
) -> UploadJobOut:
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
    if len(pdf_bytes) > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {settings.max_upload_size_mb}MB limit.",
        )

    # --- Validate magic bytes ---
    if not pdf_bytes.startswith(_PDF_MAGIC):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File does not look like a valid PDF.",
        )

    try:
        job = await jobs.enqueue(
            user_id=uploader_id,
            filename=file.filename or "unknown.pdf",
            pdf_bytes=pdf_bytes,
        )
    except jobs.QueueFullError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return UploadJobOut(**job.to_dict())


@router.get("/upload-jobs", response_model=UploadJobsResponse)
async def list_upload_jobs(
    uploader_id: str = Depends(require_uploader),
) -> UploadJobsResponse:
    return UploadJobsResponse(
        jobs=[UploadJobOut(**j.to_dict()) for j in jobs.jobs_for_user(uploader_id)]
    )


@router.post("/upload-jobs/clear-finished")
async def clear_finished_jobs(
    uploader_id: str = Depends(require_uploader),
) -> dict[str, int]:
    return {"removed": jobs.clear_finished(uploader_id)}


@router.post("/upload-jobs/{job_id}/action")
async def job_action(
    job_id: str,
    body: JobActionRequest,
    uploader_id: str = Depends(require_uploader),
) -> dict[str, object]:
    """
    Apply a control action (pause/resume/cancel/restart/remove) to one of the
    caller's upload jobs. Returns the updated job, or {"removed": true}.
    """
    try:
        job = jobs.apply_action(uploader_id, job_id, body.action)
    except jobs.ActionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if job is None:
        return {"removed": True}
    return {"job": UploadJobOut(**job.to_dict()).model_dump()}


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
