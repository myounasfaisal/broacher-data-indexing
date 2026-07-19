"""
Search endpoints — viewer-facing (all three roles).

GET  /search           filter-based chemical search (paginated, max 15/page)
GET  /suggest          typeahead suggestions for the search box
POST /search/ai        natural-language search: an LLM converts the sentence
                       into structured filters, then the SAME search function
                       as GET /search runs the query — the model never
                       produces chemical data itself

Listing detail/edit/delete endpoints live in routers/listings.py.
"""

# NOTE: no `from __future__ import annotations` here — postponed (string)
# annotations break FastAPI's parameter analysis on endpoints wrapped by
# slowapi's decorator (the body model degrades to a query param). Same class
# of gotcha as the UploadFile one documented in CHANGES.md part 1.
import asyncio
import math

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.dependencies import require_user
from app.rate_limit import limiter
from app.schemas.chemical import (
    AISearchRequest,
    AISearchResponse,
    SearchResponse,
    SuggestResponse,
)
from app.services import nl_search
from app.services.database import search_listings, suggest

router = APIRouter(tags=["search"])

MAX_PAGE_SIZE = 15  # hard cap: never more than 15 products per page


@router.get("/search", response_model=SearchResponse)
async def search(
    # Any logged-in user may search; require_user enforces a valid JWT.
    _user_id: str = Depends(require_user),
    q: str | None = Query(
        default=None,
        description=(
            "Free text: product name, CAS number, supplier name, or any text "
            "inside the listing's details/description"
        ),
    ),
    cas: str | None = Query(
        default=None, max_length=50, description="CAS number substring"
    ),
    min_price: float | None = Query(
        default=None, ge=0, description="Lower price bound in USD (normalized)"
    ),
    max_price: float | None = Query(
        default=None, ge=0, description="Upper price bound in USD (normalized)"
    ),
    priced_only: bool = Query(
        default=False, description="Only listings with a printed price"
    ),
    min_purity: float | None = Query(
        default=None, ge=0, le=100, description="Minimum purity percentage"
    ),
    max_purity: float | None = Query(
        default=None, ge=0, le=100, description="Maximum purity percentage"
    ),
    details_q: str | None = Query(
        default=None,
        max_length=100,
        description="Loose match against the flexible per-listing details",
    ),
    sort: str = Query(
        default="price_asc",
        pattern="^(price|name|price_asc|price_desc|name_asc|name_desc)$",
        description="Sort order (legacy 'price'/'name' map to *_asc)",
    ),
    letter: str | None = Query(
        default=None,
        pattern="^[a-zA-Z]$",
        description="Restrict to chemicals whose English name starts with this letter",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=MAX_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> SearchResponse:
    rows, total = search_listings(
        q=q,
        cas_number=cas,
        min_price=min_price,
        max_price=max_price,
        min_purity=min_purity,
        max_purity=max_purity,
        details_query=details_q,
        priced_only=priced_only,
        sort=sort,
        letter=letter,
        page=page,
        page_size=page_size,
    )
    return SearchResponse(
        count=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, math.ceil(total / page_size)),
        results=rows,
    )


@router.post("/search/ai", response_model=AISearchResponse)
@limiter.limit("20/minute")  # every call hits the external LLM API — same
# budget-protection pattern as the upload endpoint
async def ai_search(
    request: Request,  # required by slowapi's limiter
    body: AISearchRequest,
    _user_id: str = Depends(require_user),
) -> AISearchResponse:
    """
    Natural-language search, usable by all three roles (same audience as
    GET /search). The model ONLY converts the sentence into structured
    filters; the rows come from search_listings — the identical trusted query
    path as the manual filter search, so the response can never contain
    model-generated chemical data.
    """
    try:
        # The LLM call is blocking network I/O — run it off the event loop.
        filters = await asyncio.to_thread(nl_search.parse_query, body.query)
    except nl_search.NLSearchError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not interpret the query: {exc}",
        ) from exc

    rows, total = search_listings(
        q=filters.name_query,
        cas_number=filters.cas_number,
        min_price=filters.min_price,
        max_price=filters.max_price,
        min_purity=filters.min_purity,
        max_purity=filters.max_purity,
        details_query=filters.details_query,
        sort=filters.sort,
        page=1,
        page_size=MAX_PAGE_SIZE,
    )
    return AISearchResponse(
        interpreted_filters=filters,
        count=total,
        page=1,
        page_size=MAX_PAGE_SIZE,
        total_pages=max(1, math.ceil(total / MAX_PAGE_SIZE)),
        results=rows,
    )


@router.get("/suggest", response_model=SuggestResponse)
async def suggest_endpoint(
    # Any logged-in user may fetch suggestions (same audience as /search).
    _user_id: str = Depends(require_user),
    q: str = Query(min_length=1, max_length=100, description="Partial text typed so far"),
    limit: int = Query(default=8, ge=1, le=15, description="Max chemical suggestions"),
) -> SuggestResponse:
    """Typeahead suggestions for the search box (chemical names / CAS / suppliers)."""
    return SuggestResponse(suggestions=suggest(q=q, limit=limit))


