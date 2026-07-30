"""
Pydantic request/response models.

These also validate the JSON Claude returns before it touches the database —
malformed extractions are rejected/logged rather than inserted. Fully defined
in Phase 4; the shapes below are the target.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ExtractedProduct(BaseModel):
    """One product row extracted from a brochure."""

    name_raw: str  # exactly as printed, in the brochure's own language/script
    name_en: str  # English translation, always present for search/dedup
    cas_number: str | None = None
    price: float | None = None
    currency: str | None = None
    purity: str | None = None
    # Anything ELSE the brochure prints for this product (flash point, hazard
    # class, storage, MOQ, ...). Keys vary per brochure; absent keys are
    # omitted by the prompt rather than null-filled.
    details: dict[str, Any] | None = None


class ExtractionResult(BaseModel):
    """Full result for one brochure: a company plus its products."""

    company_name: str  # supplier name exactly as printed (any language/script)
    company_name_en: str | None = None  # English translation of the supplier name
    # Website URL if one is printed on the brochure (the company's general
    # site — never a guessed/constructed product link).
    company_website: str | None = None
    # Contact details ONLY if printed on the brochure (never guessed) — they
    # feed the suppliers directory via resolve_company.
    company_email: str | None = None
    company_phone: str | None = None
    products: list[ExtractedProduct]


class ListingOut(BaseModel):
    """One listing row returned by the search endpoint (viewer-safe fields)."""

    id: str
    chemical_id: str | None = None
    company_id: int | None = None
    company_name: str = ""
    company_name_en: str = ""
    name_raw: str
    name_en: str
    cas_number: str | None = None
    price: float | None = None
    currency: str | None = None
    # Cross-currency comparison: price normalized to USD (stored), plus a
    # PKR display value computed from the current exchange rate at read time.
    price_usd: float | None = None
    price_pkr: float | None = None
    purity: str | None = None
    needs_review: bool = False
    created_at: str
    # Present on the single-listing detail endpoint; the search list omits
    # these columns, so they default to None there.
    details: dict[str, Any] | None = None
    company_website: str | None = None


class SearchResponse(BaseModel):
    """Envelope for search results (server-side paginated)."""

    count: int  # total matching rows across ALL pages
    page: int
    page_size: int
    total_pages: int
    results: list[ListingOut]


class Suggestion(BaseModel):
    """One typeahead suggestion for the search box."""

    type: Literal["chemical", "supplier"]
    label: str  # what to display and drop into the search box when picked
    cas_number: str | None = None  # set for chemical suggestions when known
    count: int = 0  # how many listings back this suggestion


class SuggestResponse(BaseModel):
    """Envelope for the search typeahead suggestions."""

    suggestions: list[Suggestion]


_ALLOWED_SORTS = {"price_asc", "price_desc", "name_asc", "name_desc"}


class InterpretedFilters(BaseModel):
    """
    Structured filters the NL search agent extracted from a user's sentence.

    This is the ONLY thing the model produces — the result rows always come
    from database.search_listings (the same trusted query path as the manual
    filter search), never from the model itself.
    """

    name_query: str | None = None
    cas_number: str | None = None
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    min_purity: float | None = Field(default=None, ge=0, le=100)
    max_purity: float | None = Field(default=None, ge=0, le=100)
    # Free-text match against the flexible listings.details JSONB (color,
    # hazard class, storage, ...) — best-effort, not a precision filter.
    details_query: str | None = None
    sort: str = "price_asc"

    @field_validator("name_query", "cas_number", "details_query", mode="before")
    @classmethod
    def _clean_text(cls, v: Any) -> str | None:
        if v is None:
            return None
        text = str(v).strip()
        return text[:100] or None

    @field_validator("sort", mode="before")
    @classmethod
    def _clean_sort(cls, v: Any) -> str:
        # A model that emits an unknown sort falls back to the default rather
        # than failing the whole request.
        return v if v in _ALLOWED_SORTS else "price_asc"


class AISearchRequest(BaseModel):
    """Body for POST /search/ai."""

    query: str = Field(min_length=1, max_length=300)


class AISearchResponse(SearchResponse):
    """AI search reply: what was understood + rows from the normal search path."""

    interpreted_filters: InterpretedFilters


class ListingUpdate(BaseModel):
    """
    Body for PATCH /listings/{id} (admin data-fix). All fields optional —
    only fields present in the request are changed; an explicit null clears
    a nullable field.
    """

    name_raw: str | None = None
    name_en: str | None = None
    cas_number: str | None = None
    price: float | None = Field(default=None, ge=0)
    currency: str | None = None
    purity: str | None = None
    needs_review: bool | None = None
    # Full replacement of the flexible technical-details object (the edit
    # form sends the whole edited object; the PubChem reference block is
    # preserved client-side). Does not affect the dedup key.
    details: dict[str, Any] | None = None
    # Reassign to an existing supplier (its id, from the suppliers directory).
    # Manual fix for when extraction found no supplier or the wrong one.
    company_id: int | None = None
    # Create a brand-new supplier with this name and assign it, when the
    # right one isn't in the directory yet. Mutually exclusive with
    # company_id in intent (the router prefers company_id if both are sent).
    new_company_name: str | None = None

    @field_validator("name_raw", "name_en")
    @classmethod
    def _names_non_empty(cls, v: str | None) -> str | None:
        # Names are required columns — an explicit null/blank would break rows.
        if v is not None and not v.strip():
            raise ValueError("must not be empty")
        return v.strip() if isinstance(v, str) else v

    @field_validator("new_company_name")
    @classmethod
    def _new_company_name_non_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("must not be empty")
        return v.strip() if isinstance(v, str) else v


class BulkDeleteRequest(BaseModel):
    """Body for POST /listings/bulk-delete (admin bulk action)."""

    # Bounded so a runaway client can't ask for an unbounded delete; the UI
    # selects at most a page (15) at a time, so 200 is comfortable headroom.
    ids: list[str] = Field(min_length=1, max_length=200)


class BulkDeleteResult(BaseModel):
    """Result of POST /listings/bulk-delete."""

    deleted: int  # rows actually removed (stale/unknown ids are skipped)


class SupplierOut(BaseModel):
    """One supplier in the directory (GET /suppliers) — every extracted
    company detail plus derived listing count / printed websites."""

    id: int
    company_name: str = ""
    company_name_en: str | None = None
    email: str | None = None
    contact_number: str | None = None
    websites: list[str] = []  # distinct printed sites from this supplier's listings
    listing_count: int = 0
    created_at: str = ""  # first time a brochure introduced this supplier


class SuppliersResponse(BaseModel):
    """Envelope for the suppliers directory (server-side paginated)."""

    items: list[SupplierOut]
    count: int  # total suppliers across ALL pages
    page: int
    page_size: int
    total_pages: int


class ReviewItemOut(ListingOut):
    """A flagged listing in the review queue, annotated with the upload that
    produced it (null for uploads predating the listing_ids ledger column)."""

    source_content_hash: str | None = None
    source_filename: str | None = None


class ReviewQueueResponse(BaseModel):
    """Envelope for the needs-review queue (server-side paginated)."""

    items: list[ReviewItemOut]
    count: int  # total flagged listings across ALL pages
    page: int
    page_size: int
    total_pages: int


class AuditEntryOut(BaseModel):
    """One activity-log entry: who did what, when (GET /admin/audit)."""

    id: int
    actor: str | None = None  # user id
    actor_email: str | None = None  # resolved at read time via the Admin API
    action: str  # upload | update_listing | delete_listing | bulk_delete_listings | undo_upload
    details: dict[str, Any] = {}
    created_at: str


class AuditLogResponse(BaseModel):
    """Envelope for the activity log (server-side paginated)."""

    items: list[AuditEntryOut]
    count: int
    page: int
    page_size: int
    total_pages: int


class UndoUploadResult(BaseModel):
    """Result of DELETE /uploads/{content_hash} (undo one upload)."""

    deleted_listings: int
    # Listings kept because another upload also produced them (shared ids).
    kept_shared: int


class UploadJobOut(BaseModel):
    """One server-side upload job, as shown in the upload progress UI."""

    id: str
    filename: str
    status: Literal["queued", "processing", "paused", "done", "failed", "cancelled"]
    stage: str  # human-readable description of what is happening right now
    company_name: str | None = None
    products_found: int = 0
    listings_inserted: int = 0
    needs_review: int = 0
    duplicate: bool = False  # true when skipped as an already-processed PDF
    error: str | None = None
    created_at: float
    updated_at: float
    # Which controls are valid right now (drives the per-file buttons).
    can_pause: bool = False
    can_resume: bool = False
    can_cancel: bool = False
    can_restart: bool = False
    can_remove: bool = True


class UploadJobsResponse(BaseModel):
    """Envelope for the caller's upload jobs."""

    jobs: list[UploadJobOut]


class DocumentStatusOut(BaseModel):
    """One document in the new DB-worker pipeline, as shown in the upload
    progress UI. Progress is derived from the documents/pages status machine —
    there is no in-memory job any more."""

    id: str
    content_hash: str = ""
    filename: str = ""
    # splitting | split | extracting | done | failed (pending is transient).
    status: str
    page_count: int = 0
    pages_done: int = 0
    product_count: int = 0
    company_name: str | None = None
    duplicate: bool = False  # true when skipped as an already-processed PDF
    error: str | None = None
    created_at: str = ""


class DocumentStatusListResponse(BaseModel):
    """Envelope for the caller's recent pipeline documents (upload progress)."""

    documents: list[DocumentStatusOut]


class StartProcessingRequest(BaseModel):
    """Body for POST /upload-jobs/start. Omit `document_ids` (or the whole body)
    to release every staged upload the caller owns."""

    document_ids: list[str] | None = None


class StartProcessingResult(BaseModel):
    """How many staged uploads were released, and their updated status rows."""

    started: int
    documents: list[DocumentStatusOut]


class JobActionRequest(BaseModel):
    """Body for POST /upload-jobs/{id}/action."""

    action: Literal["pause", "resume", "cancel", "restart", "remove"]


class UploadHistoryItem(BaseModel):
    """One processed-upload record for the upload history / admin audit."""

    content_hash: str
    filename: str = ""
    company_name: str = ""
    company_name_en: str = ""
    product_count: int = 0
    uploaded_by: str | None = None
    uploaded_by_email: str | None = None  # populated only in the admin-wide view
    created_at: str


class UploadHistoryResponse(BaseModel):
    """Envelope for the upload history list (server-paginated)."""

    items: list[UploadHistoryItem]
    count: int = 0  # total matching uploads across ALL pages
    page: int = 1
    page_size: int = 10
    total_pages: int = 1


class DocumentListingsResponse(BaseModel):
    """The listings a single upload produced ("which ones were added")."""

    content_hash: str
    filename: str = ""
    listings: list[ListingOut]


class StatusDistribution(BaseModel):
    """The listing catalog split into three disjoint quality states, summing to
    total_listings. A listing flagged for review counts as needs_review even if
    it also lacks a price, so the three slices never double-count."""

    complete: int = 0
    needs_review: int = 0
    missing_price: int = 0


class SupplierListingCount(BaseModel):
    """One bar in the dashboard's 'Top suppliers by listings' panel."""

    company_id: int
    name: str
    count: int


class DashboardSummary(BaseModel):
    """Aggregate stat-card counts for the admin/manager dashboard."""

    total_listings: int = 0
    total_suppliers: int = 0
    uploads_last_7d: int = 0
    needs_review: int = 0
    status_distribution: StatusDistribution = StatusDistribution()
    top_suppliers: list[SupplierListingCount] = []


class ManagedUser(BaseModel):
    """One row on the admin user-management page."""

    id: str
    email: str | None = None
    role: str
    created_at: str | None = None
    last_sign_in_at: str | None = None


class UsersResponse(BaseModel):
    """Envelope for the admin user list."""

    users: list[ManagedUser]


class RoleUpdate(BaseModel):
    """Body for PATCH /users/{id}/role."""

    role: Literal["admin", "manager", "viewer"]
