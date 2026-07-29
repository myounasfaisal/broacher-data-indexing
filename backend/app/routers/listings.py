"""
Listing endpoints.

GET    /listings/{id}          full detail for one listing (product page) —
                               any authenticated user (same audience as /search)
PATCH  /listings/{id}          admin/manager data-fix: correct extraction
                               mistakes in-app (name, CAS, price, currency,
                               purity, review flag)
DELETE /listings/{id}          admin/manager: remove a bad listing entirely
POST   /listings/bulk-delete   admin/manager: remove a selected set of
                               listings in one call (drives the bulk-select UI)

Write access was widened from admin-only to admin+manager on 2026-07-19 (the
review queue's "resolve" audience — user's explicit choice, see CHANGES.md
part 15).

Edits recompute dedup_key and price_usd server-side (see
database.update_listing); a collision with an existing identical listing
returns 409 via the DuplicateListingError handler in main.py.
"""

# NOTE: no `from __future__ import annotations` in routers — see the slowapi
# gotcha documented in CHANGES.md part 10.
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_uploader, require_user
from app.schemas.chemical import (
    BulkDeleteRequest,
    BulkDeleteResult,
    ListingOut,
    ListingUpdate,
)
from app.services import database

router = APIRouter(tags=["listings"])


def _require_uuid(listing_id: str) -> None:
    try:
        uuid.UUID(listing_id)
    except ValueError:
        # Not a UUID at all — 404 without a DB round-trip.
        raise HTTPException(status_code=404, detail="Listing not found.")


@router.get("/listings/{listing_id}", response_model=ListingOut)
async def listing_detail(
    listing_id: str,
    _user_id: str = Depends(require_user),
) -> ListingOut:
    """Full detail for one listing (product page) — any authenticated user."""
    _require_uuid(listing_id)
    row = database.get_listing(listing_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Listing not found.")
    return ListingOut(**row)


@router.patch("/listings/{listing_id}", response_model=ListingOut)
async def update_listing(
    listing_id: str,
    body: ListingUpdate,
    uploader_id: str = Depends(require_uploader),
) -> ListingOut:
    """
    Admin/manager data-fix for extraction mistakes. Only the fields present in
    the request change; dedup_key and price_usd are recomputed server-side.

    `new_company_name` is a convenience over `company_id`: when the right
    supplier isn't in the directory yet, this creates it (name-only, no
    website/email — those are learned automatically from future brochures)
    and assigns the new id. If both are sent, `company_id` wins.
    """
    _require_uuid(listing_id)
    changes = body.model_dump(exclude_unset=True)
    new_company_name = changes.pop("new_company_name", None)
    if new_company_name and not changes.get("company_id"):
        company = database.create_company(new_company_name)
        changes["company_id"] = company["id"]
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update.")
    # company_website is denormalized onto the listing (read by ProductDetail
    # and the suppliers directory) — keep it in step whenever the supplier
    # changes, rather than leaving the old supplier's website behind.
    if "company_id" in changes:
        company = (
            database.get_company(changes["company_id"])
            if changes["company_id"] is not None
            else None
        )
        changes["company_website"] = company.get("website") if company else None
    row = database.update_listing(listing_id, changes)
    if row is None:
        raise HTTPException(status_code=404, detail="Listing not found.")
    database.audit(
        uploader_id,
        "update_listing",
        {
            "listing_id": listing_id,
            "name_en": row.get("name_en"),
            "fields": sorted(changes.keys()),
        },
    )
    return ListingOut(**row)


@router.delete("/listings/{listing_id}")
async def delete_listing(
    listing_id: str,
    uploader_id: str = Depends(require_uploader),
) -> dict[str, bool]:
    """Admin/manager: permanently remove one listing."""
    _require_uuid(listing_id)
    # Capture what is being deleted BEFORE it's gone, so the audit log can
    # answer "what was deleted", not just "something was".
    row = database.get_listing(listing_id)
    if not database.delete_listing(listing_id):
        raise HTTPException(status_code=404, detail="Listing not found.")
    database.audit(
        uploader_id,
        "delete_listing",
        {
            "listing_id": listing_id,
            "name_en": (row or {}).get("name_en"),
            "company": (row or {}).get("company_name_en")
            or (row or {}).get("company_name"),
        },
    )
    return {"deleted": True}


@router.post("/listings/bulk-delete", response_model=BulkDeleteResult)
async def bulk_delete_listings(
    body: BulkDeleteRequest,
    uploader_id: str = Depends(require_uploader),
) -> BulkDeleteResult:
    """
    Admin/manager: permanently remove a selected set of listings in one call
    (the bulk-select "Delete selected" action). Ids that don't exist any more
    are skipped rather than failing the batch; the count of rows actually
    deleted is returned so the UI can report it honestly.
    """
    for listing_id in body.ids:
        try:
            uuid.UUID(listing_id)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid listing id: {listing_id!r}"
            )
    # Names captured before deletion so the audit log can say WHAT went.
    names = [
        r.get("name_en") or r.get("name_raw") or r["id"]
        for r in database.get_listings_by_ids(body.ids)
    ]
    deleted = database.bulk_delete_listings(body.ids)
    database.audit(
        uploader_id,
        "bulk_delete_listings",
        {"count": deleted, "names": names[:25]},
    )
    return BulkDeleteResult(deleted=deleted)
