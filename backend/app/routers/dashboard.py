"""
Admin/manager dashboard.

GET /admin/dashboard/summary  → aggregate stat-card counts (total listings,
distinct suppliers, uploads in the last 7 days, listings flagged for review).
GET /admin/review             → paginated review queue: listings flagged
needs_review (the app's one review flag), each annotated with the upload
that produced it.
GET /admin/audit              → paginated activity log (who uploaded /
edited / deleted what) — ADMIN only.

Summary + review are guarded by require_uploader (admin OR manager), matching
the dashboard's audience; the audit log is admin-only. Follows the same
role-check pattern as the other protected routers (see dependencies.py).
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query

from app.dependencies import require_admin, require_uploader
from app.schemas.chemical import (
    AuditEntryOut,
    AuditLogResponse,
    DashboardSummary,
    ReviewItemOut,
    ReviewQueueResponse,
)
from app.services import database

router = APIRouter(prefix="/admin", tags=["dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummary)
async def dashboard_summary(
    _uploader_id: str = Depends(require_uploader),
) -> DashboardSummary:
    """Return the dashboard's headline counts. Admin + manager only."""
    return DashboardSummary(**database.dashboard_summary())


@router.get("/review", response_model=ReviewQueueResponse)
async def review_queue(
    _uploader_id: str = Depends(require_uploader),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=15, ge=1, le=50),
) -> ReviewQueueResponse:
    """
    The needs-review queue (admin + manager): flagged listings newest first,
    each with the source upload so a whole bad file can be undone from the
    queue. Built on the EXISTING needs_review flag — resolving = clearing it
    via PATCH /listings/{id}, correcting the listing, or deleting it / its
    source upload; there is no second flagging system.
    """
    rows, total = database.list_review_listings(page=page, page_size=page_size)
    return ReviewQueueResponse(
        items=[ReviewItemOut(**r) for r in rows],
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/audit", response_model=AuditLogResponse)
async def audit_log(
    _admin_id: str = Depends(require_admin),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
) -> AuditLogResponse:
    """
    Activity log (admin only): who uploaded / edited / deleted what, newest
    first. Actor emails are resolved at read time via the Admin Auth API
    (same pattern as the org-wide upload history).
    """
    rows, total = database.list_audit(page=page, page_size=page_size)
    emails = database.get_user_emails(
        {r["actor"] for r in rows if r.get("actor")}
    )
    return AuditLogResponse(
        items=[
            AuditEntryOut(**r, actor_email=emails.get(r["actor"] or ""))
            for r in rows
        ],
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
    )
