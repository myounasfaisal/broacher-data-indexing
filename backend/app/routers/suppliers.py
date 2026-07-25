"""
Suppliers directory.

GET /suppliers  → every supplier with the company details extraction has
captured (name, English name, email, phone) plus derived fields (listing
count, distinct printed websites), server-paginated and optionally filtered
by name/email via `q`. Any authenticated user
(same audience as /search) — the page links each supplier through to its
products via the normal search.
"""

# NOTE: no `from __future__ import annotations` in routers — see the slowapi
# gotcha documented in CHANGES.md part 10.
import math

from fastapi import APIRouter, Depends, Query

from app.dependencies import require_user
from app.schemas.chemical import SupplierOut, SuppliersResponse
from app.services import database

router = APIRouter(tags=["suppliers"])


@router.get("/suppliers", response_model=SuppliersResponse)
async def list_suppliers(
    _user_id: str = Depends(require_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    q: str | None = Query(
        default=None,
        max_length=100,
        description="Filter by company name (either script) or email.",
    ),
    direction: str = Query(
        default="asc",
        pattern="^(asc|desc)$",
        description="Sort direction by supplier name.",
    ),
) -> SuppliersResponse:
    """Paginated suppliers directory (all roles), optionally filtered by `q`."""
    rows, total = database.list_suppliers(
        page=page, page_size=page_size, q=q, direction=direction
    )
    return SuppliersResponse(
        items=[SupplierOut(**r) for r in rows],
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
    )
