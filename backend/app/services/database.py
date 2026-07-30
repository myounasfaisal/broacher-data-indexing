"""
Supabase (Postgres) access helpers.

Wraps a single Supabase client initialized with the SERVICE ROLE key. The
service key bypasses Row Level Security, so this module is the only place the
backend touches the database — routers and services call these helpers rather
than constructing raw client queries inline.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache, wraps
from typing import Any, Callable, TypeVar

import httpx
from supabase import Client, create_client

from app.config import settings
from app.services import rates

logger = logging.getLogger(__name__)

# Transient connection failures worth one automatic retry. Supabase (behind
# Cloudflare) closes idle keep-alive connections; the next request reusing that
# pooled socket then fails with "Server disconnected" (RemoteProtocolError) or a
# connect/read error, even though the DB is perfectly healthy. Retrying re-opens
# a fresh connection and almost always succeeds — this was the cause of
# intermittent 503 "database temporarily unavailable" responses.
_DB_CONN_ERRORS = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.PoolTimeout,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
)
_DB_RETRIES = 2  # extra attempts after the first (so up to 3 total)


class DatabaseError(Exception):
    """
    Raised when a database operation fails (network, PostgREST, auth-admin, or
    the Supabase edge). Routers let it bubble to the global handler in main.py,
    which turns it into a clean 503 instead of a raw 500; the upload worker
    already catches it (it's an Exception) and marks the job failed.
    """


class DuplicateListingError(DatabaseError):
    """
    An admin edit would collide with an existing identical listing (same
    dedup_key). Mapped to a 409 by its own handler in main.py — registered
    separately so it doesn't fall into the generic 503.
    """


_F = TypeVar("_F", bound=Callable[..., Any])


def _db_op(fn: _F) -> _F:
    """
    Wrap a data-access helper so any underlying client exception (postgrest
    APIError, httpx network error, gotrue auth error, the Cloudflare 1101 edge
    bug, …) is logged once and re-raised as a single, predictable DatabaseError.
    Keeps every DB failure funnelling through one type instead of leaking the
    provider's exception zoo to callers.
    """

    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        for attempt in range(_DB_RETRIES + 1):
            try:
                return fn(*args, **kwargs)
            except DatabaseError:
                raise
            except _DB_CONN_ERRORS as exc:
                # Stale-connection drop — retry with a fresh connection.
                if attempt < _DB_RETRIES:
                    logger.warning(
                        "Database %s hit a transient connection error (%s); "
                        "retry %d/%d",
                        fn.__name__, type(exc).__name__, attempt + 1, _DB_RETRIES,
                    )
                    time.sleep(0.3 * (attempt + 1))
                    continue
                logger.exception("Database operation %s failed", fn.__name__)
                raise DatabaseError(str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 — funnel all DB failures
                # "Server disconnected" can also surface wrapped in a non-httpx
                # type depending on the stack — catch by message as a fallback.
                if "Server disconnected" in str(exc) and attempt < _DB_RETRIES:
                    logger.warning(
                        "Database %s: server disconnected; retry %d/%d",
                        fn.__name__, attempt + 1, _DB_RETRIES,
                    )
                    time.sleep(0.3 * (attempt + 1))
                    continue
                logger.exception("Database operation %s failed", fn.__name__)
                raise DatabaseError(str(exc)) from exc

    return wrapper  # type: ignore[return-value]


@lru_cache
def get_client() -> Client:
    """Return a cached service-role Supabase client (created once)."""
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ---------------------------------------------------------------------
# Auth / roles
# ---------------------------------------------------------------------
@_db_op
def get_user_role(user_id: str) -> str | None:
    """Look up a user's role from `profiles`. Returns None if no profile row."""
    resp = (
        get_client()
        .table("profiles")
        .select("role")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if resp.data:
        return resp.data[0]["role"]
    return None


@_db_op
def list_users_with_roles() -> list[dict[str, Any]]:
    """
    Return all auth users merged with their profile role, for the admin
    user-management page. Uses the service-role Admin Auth API for emails.
    """
    client = get_client()
    users = client.auth.admin.list_users(page=1, per_page=500)

    roles_resp = client.table("profiles").select("id, role").execute()
    roles = {row["id"]: row["role"] for row in (roles_resp.data or [])}

    out: list[dict[str, Any]] = []
    for u in users:
        uid = str(u.id)
        out.append(
            {
                "id": uid,
                "email": u.email,
                "role": roles.get(uid, "viewer"),
                "created_at": str(u.created_at) if u.created_at else None,
                "last_sign_in_at": (
                    str(u.last_sign_in_at) if u.last_sign_in_at else None
                ),
            }
        )
    out.sort(key=lambda x: x["email"] or "")
    return out


@_db_op
def set_user_role(user_id: str, role: str) -> None:
    """Set a user's role, creating the profile row if it doesn't exist yet."""
    client = get_client()
    resp = (
        client.table("profiles")
        .update({"role": role})
        .eq("id", user_id)
        .execute()
    )
    if not resp.data:
        client.table("profiles").insert({"id": user_id, "role": role}).execute()


# ---------------------------------------------------------------------
# Admin dashboard aggregates
# ---------------------------------------------------------------------
@_db_op
def dashboard_summary() -> dict[str, Any]:
    """
    Aggregate counts for the admin/manager dashboard, built from the existing
    tables via PostgREST exact-count queries (count reflects ALL matching rows;
    the limit(1) only bounds the returned rows). No new tables or columns.
    """
    client = get_client()

    def _count(table: str, column: str, apply: Callable[[Any], Any] | None = None) -> int:
        query = client.table(table).select(column, count="exact").limit(1)
        if apply is not None:
            query = apply(query)
        return query.execute().count or 0

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    total_listings = _count("listings", "id")
    needs_review = _count("listings", "id", lambda q: q.eq("needs_review", True))

    # Three DISJOINT quality slices that sum to total_listings. needs_review
    # wins over missing-price so a flagged listing is counted once; missing
    # price is then the priced-null remainder, and complete is whatever's left.
    missing_price = _count(
        "listings",
        "id",
        lambda q: q.eq("needs_review", False).is_("price", "null"),
    )
    complete = max(total_listings - needs_review - missing_price, 0)

    return {
        "total_listings": total_listings,
        "total_suppliers": _count("companies", "id"),
        "uploads_last_7d": _count(
            "documents", "content_hash", lambda q: q.gte("created_at", cutoff)
        ),
        "needs_review": needs_review,
        "status_distribution": {
            "complete": complete,
            "needs_review": needs_review,
            "missing_price": missing_price,
        },
        "top_suppliers": _top_suppliers_by_listings(client, limit=4),
    }


def _top_suppliers_by_listings(client: Any, limit: int = 4) -> list[dict[str, Any]]:
    """
    The suppliers with the most listings, for the dashboard bar panel.

    PostgREST has no GROUP BY, so — exactly as list_suppliers() does for its
    per-page counts — we pull the single company_id column for every listing
    and tally in Python. It's one narrow column and the result is admin-only
    and client-cached, so the cost is acceptable at catalog scale. Names are
    resolved in one follow-up query bounded to just the top `limit` companies.
    """
    resp = client.table("listings").select("company_id").execute()
    tally: dict[int, int] = {}
    for row in resp.data or []:
        cid = row.get("company_id")
        if cid is not None:
            tally[cid] = tally.get(cid, 0) + 1
    if not tally:
        return []

    top = sorted(tally.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    top_ids = [cid for cid, _ in top]

    name_resp = (
        client.table("companies")
        .select("id, company_name, company_name_en")
        .in_("id", top_ids)
        .execute()
    )
    names: dict[int, str] = {}
    for c in name_resp.data or []:
        names[c["id"]] = (
            (c.get("company_name_en") or "").strip()
            or (c.get("company_name") or "").strip()
            or "Unknown supplier"
        )

    return [
        {"company_id": cid, "name": names.get(cid, "Unknown supplier"), "count": count}
        for cid, count in top
    ]


# ---------------------------------------------------------------------
# Chemicals (canonical identities) — used by the dedup + upload flow
# ---------------------------------------------------------------------
@_db_op
def find_chemical_by_cas(cas_number: str) -> dict[str, Any] | None:
    """Return the canonical chemical row with this CAS number, or None."""
    resp = (
        get_client()
        .table("chemicals")
        .select("id, cas_number, name_en")
        .eq("cas_number", cas_number)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def find_chemical_by_name_en(name_en: str) -> dict[str, Any] | None:
    """Return a canonical chemical whose English name matches (case-insensitive), or None."""
    resp = (
        get_client()
        .table("chemicals")
        .select("id, cas_number, name_en")
        .ilike("name_en", name_en)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def list_chemicals() -> list[dict[str, Any]]:
    """Return all canonical chemicals (id, cas_number, name_en) for fuzzy matching."""
    resp = get_client().table("chemicals").select("id, cas_number, name_en").execute()
    return resp.data or []


@_db_op
def create_chemical(name_en: str, cas_number: str | None) -> dict[str, Any]:
    """Insert a new canonical chemical and return the created row."""
    resp = (
        get_client()
        .table("chemicals")
        .insert({"name_en": name_en, "cas_number": cas_number})
        .execute()
    )
    return resp.data[0]


@_db_op
def resolve_company(
    company_name: str,
    company_name_en: str | None = None,
    email: str | None = None,
    contact_number: str | None = None,
) -> int:
    """
    Resolve a supplier to its id, creating it if new. Stores both the
    original-language name (company_name, as printed) and an English name
    (company_name_en) so native-script and romanized brochures can be matched
    and displayed consistently. Printed contact details (email / phone) are
    stored on creation and backfilled onto an existing supplier when missing —
    never overwritten (the first printed value wins; suppliers directory shows
    them).

    Matching is intentionally conservative to avoid merging genuinely different
    suppliers: an existing company is reused only on an exact (case-insensitive)
    match of EITHER the original name OR the English name. When reused, a missing
    English name is backfilled.
    """
    client = get_client()
    name = (company_name or "").strip()
    name_en = (company_name_en or "").strip() or None
    email = (email or "").strip() or None
    contact_number = (contact_number or "").strip() or None

    # Match in Python rather than a PostgREST filter: supplier names routinely
    # contain commas / parentheses ("Co., Ltd."), which are structural chars in
    # a PostgREST filter string. Companies is a small dimension table, so
    # fetching it to compare case-insensitively is cheap and fully robust.
    targets = {t.casefold() for t in (name, name_en) if t}
    resp = (
        client.table("companies")
        .select("id, company_name, company_name_en, email, contact_number")
        .execute()
    )
    for row in resp.data or []:
        candidates = {
            (row.get("company_name") or "").strip().casefold(),
            (row.get("company_name_en") or "").strip().casefold(),
        }
        candidates.discard("")
        if targets & candidates:
            # Backfill anything we now know that the row is missing.
            backfill: dict[str, Any] = {}
            if name_en and not row.get("company_name_en"):
                backfill["company_name_en"] = name_en
            if email and not row.get("email"):
                backfill["email"] = email
            if contact_number and not row.get("contact_number"):
                backfill["contact_number"] = contact_number
            if backfill:
                client.table("companies").update(backfill).eq(
                    "id", row["id"]
                ).execute()
            return row["id"]

    resp = (
        client.table("companies")
        .insert(
            {
                "company_name": name,
                "company_name_en": name_en,
                "email": email,
                "contact_number": contact_number,
            }
        )
        .execute()
    )
    return resp.data[0]["id"]


@_db_op
def list_suppliers(
    page: int = 1,
    page_size: int = 10,
    q: str | None = None,
    direction: str = "asc",
) -> tuple[list[dict[str, Any]], int]:
    """
    Suppliers directory: one row per company with every extracted detail we
    hold (names, email, phone) plus derived fields — listing count and the
    distinct printed websites aggregated from that supplier's listings
    (website is stored per-listing, since that's where extraction sees it).
    Server-paginated; ordered by English name then original name, ascending or
    descending per `direction`.

    Suppliers with no English name are pinned last in BOTH directions
    (`nullsfirst=False`). Postgres would otherwise float them to the top on
    DESC, so flipping the sort would open the directory on a block of rows
    that look blank — a sort toggle shouldn't change *which* rows lead, only
    their order.

    `q` filters on either name or the email — the fields a user has in hand
    when looking a supplier up. Filtering is server-side because the directory
    is paginated: narrowing only the current page would search 10 rows out of
    the whole set and quietly hide every other match.
    """
    client = get_client()
    offset = (page - 1) * page_size
    query = client.table("companies").select(
        "id, company_name, company_name_en, email, contact_number, created_at",
        count="exact",
    )
    if q:
        # Same sanitizer as /search: , ( ) are structural in a PostgREST or()
        # string and % _ are ilike wildcards, so raw input could otherwise
        # change the filter's meaning.
        safe = _sanitize_filter_value(q)
        if safe:
            query = query.or_(
                f"company_name.ilike.*{safe}*,"
                f"company_name_en.ilike.*{safe}*,"
                f"email.ilike.*{safe}*"
            )
    desc = direction == "desc"
    resp = (
        query.order("company_name_en", desc=desc, nullsfirst=False)
        .order("company_name", desc=desc, nullsfirst=False)
        .range(offset, offset + page_size - 1)
        .execute()
    )
    rows = resp.data or []
    ids = [r["id"] for r in rows]
    counts: dict[int, int] = {i: 0 for i in ids}
    websites: dict[int, list[str]] = {i: [] for i in ids}
    if ids:
        # One bounded query: only the page's suppliers' listings.
        lresp = (
            client.table("listings")
            .select("company_id, company_website")
            .in_("company_id", ids)
            .execute()
        )
        for listing in lresp.data or []:
            cid = listing.get("company_id")
            if cid not in counts:
                continue
            counts[cid] += 1
            site = (listing.get("company_website") or "").strip()
            if site and site not in websites[cid]:
                websites[cid].append(site)
    for r in rows:
        r["listing_count"] = counts.get(r["id"], 0)
        r["websites"] = websites.get(r["id"], [])
        r["created_at"] = str(r.get("created_at") or "")
    return rows, (resp.count or 0)


@_db_op
def list_review_listings(
    page: int = 1, page_size: int = 15
) -> tuple[list[dict[str, Any]], int]:
    """
    Review queue: listings flagged needs_review (the ONE review flag the live
    app has — set by the fuzzy chemical match at insert time, cleared via the
    admin/manager edit), newest first, server-paginated. Each row is annotated
    with the upload that produced it (source_content_hash / source_filename),
    recovered from the documents ledger's listing_ids — the ledger is one row
    per processed PDF, so fetching it whole and inverting in Python beats a
    per-listing array-contains query. Listings from uploads that predate the
    listing_ids column get null source fields (the UI shows them unsourced).
    """
    client = get_client()
    offset = (page - 1) * page_size
    resp = (
        client.table("listings")
        .select(SEARCH_COLUMNS, count="exact")
        .eq("needs_review", True)
        .order("created_at", desc=True)
        .order("id", desc=False)
        .range(offset, offset + page_size - 1)
        .execute()
    )
    rows = [_flatten_company(r) for r in (resp.data or [])]

    docs = (
        client.table("documents")
        .select("content_hash, filename, listing_ids")
        .execute()
    )
    source: dict[str, tuple[str, str]] = {}
    for d in docs.data or []:
        for lid in d.get("listing_ids") or []:
            source.setdefault(
                str(lid), (d["content_hash"], d.get("filename") or "")
            )
    for r in rows:
        content_hash, filename = source.get(str(r["id"]), (None, None))
        r["source_content_hash"] = content_hash
        r["source_filename"] = filename
    return rows, (resp.count or 0)


def _normalize_price(price: Any) -> str:
    """
    Canonical string form of a price for the dedup key. Must match the SQL
    backfill in migration 'dedup_documents_and_bilingual_company': trailing
    zeros/point stripped (55.0 -> '55', 99.5 -> '99.5'), None -> ''.
    """
    if price is None:
        return ""
    return format(float(price), "g")


def make_dedup_key(listing: dict[str, Any]) -> str:
    """
    Build the normalized listing dedup key:
        company_id | name_raw(lower,trim) | price | currency | purity

    Keyed on the product AS PRINTED (name_raw), NOT chemical_id — the fuzzy
    matcher collapses distinct product grades onto one chemical_id, so keying on
    it would drop real products. company_id is included, so the same chemical
    from different suppliers is preserved as separate listings.
    """
    return "|".join(
        [
            str(listing.get("company_id", "")),
            (listing.get("name_raw") or "").strip().lower(),
            _normalize_price(listing.get("price")),
            (listing.get("currency") or "").strip().lower(),
            (listing.get("purity") or "").strip().lower(),
        ]
    )


@_db_op
def insert_listing(listing: dict[str, Any]) -> dict[str, Any]:
    """
    Upsert one supplier listing, keyed on dedup_key. A genuinely identical offer
    from the same company (same printed name + price + currency + purity) updates
    the existing row instead of creating a duplicate. Returns the row.

    price_usd is computed here (from the current exchange-rate snapshot) so
    cross-currency sorting/filtering has one normalized column to work with.
    """
    # A price of 0 (or negative) is never a real quote — it's a placeholder for
    # "price not shown" (e.g. ECHEMI hides prices behind login, so they render
    # as 0.0 in the exported PDF). Store it as no-price so the UI shows "—"
    # instead of a misleading "0 Yuan/ton".
    price = listing.get("price")
    if price is not None:
        try:
            if float(price) <= 0:
                listing = {**listing, "price": None, "currency": None}
        except (TypeError, ValueError):
            pass

    row = {
        **listing,
        "dedup_key": make_dedup_key(listing),
        "price_usd": rates.to_usd(listing.get("price"), listing.get("currency")),
    }
    resp = (
        get_client()
        .table("listings")
        .upsert(row, on_conflict="dedup_key")
        .execute()
    )
    return resp.data[0]


# Fields an admin may change via PATCH /listings/{id}. Identity/price fields
# trigger a dedup_key + price_usd recompute in update_listing.
EDITABLE_LISTING_FIELDS = (
    "name_raw",
    "name_en",
    "cas_number",
    "price",
    "currency",
    "purity",
    "needs_review",
    "company_id",
    "company_website",
)


@_db_op
def update_listing(
    listing_id: str, changes: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Apply an admin data-fix to a listing. Recomputes dedup_key and price_usd
    from the merged values so the unique index and currency normalization stay
    consistent. Returns the fresh full row, or None if the listing doesn't
    exist. Raises DuplicateListingError when the edit would make this listing
    identical to another one (dedup_key collision).
    """
    client = get_client()
    resp = (
        client.table("listings")
        .select(
            "id, company_id, name_raw, name_en, cas_number, price, currency, "
            "purity, needs_review"
        )
        .eq("id", listing_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None

    merged = {**resp.data[0], **changes}
    new_key = make_dedup_key(merged)

    # Pre-check the collision so the caller gets a 409 with a clear message
    # instead of a raw unique-violation 503. (Tiny race window is acceptable
    # for an admin-only data-fix path.)
    dup = (
        client.table("listings")
        .select("id")
        .eq("dedup_key", new_key)
        .neq("id", listing_id)
        .limit(1)
        .execute()
    )
    if dup.data:
        raise DuplicateListingError(
            "An identical listing already exists (same supplier, printed "
            "name, price, currency and purity)."
        )

    client.table("listings").update(
        {
            **changes,
            "dedup_key": new_key,
            "price_usd": rates.to_usd(merged.get("price"), merged.get("currency")),
        }
    ).eq("id", listing_id).execute()
    return get_listing(listing_id)


@_db_op
def get_company(company_id: int) -> dict[str, Any] | None:
    """One supplier row by id — used to denormalize its website onto a
    listing when an admin manually reassigns the supplier."""
    resp = (
        get_client()
        .table("companies")
        .select("id, company_name, company_name_en, website, email, contact_number")
        .eq("id", company_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def create_company(name: str) -> dict[str, Any]:
    """Create a brand-new supplier with just a name — the manual-assign path
    for when the right supplier isn't in the directory yet (no website/email
    known, unlike the automatic extraction-time resolve_company)."""
    resp = (
        get_client()
        .table("companies")
        .insert({"company_name": name})
        .execute()
    )
    return resp.data[0]


@_db_op
def delete_listing(listing_id: str) -> bool:
    """Delete one listing; returns False when it didn't exist."""
    resp = get_client().table("listings").delete().eq("id", listing_id).execute()
    return bool(resp.data)


@_db_op
def bulk_delete_listings(listing_ids: list[str]) -> int:
    """
    Delete many listings in one call (admin bulk action). Returns how many
    rows were actually deleted — ids that no longer exist are skipped, not an
    error, so a stale selection can't fail the whole batch. documents ledger
    rows keep their listing_ids; get_listings_by_ids already drops deleted
    ids, the same behaviour as single-listing deletes.
    """
    if not listing_ids:
        return 0
    resp = (
        get_client().table("listings").delete().in_("id", listing_ids).execute()
    )
    return len(resp.data or [])


@_db_op
def delete_document_and_listings(
    content_hash: str, listing_ids: list[str]
) -> tuple[int, int]:
    """
    Undo one upload: delete the listings it produced and its ledger row (so
    the same PDF can be re-uploaded and processed again). Listings that ALSO
    appear in another upload's listing_ids are kept — they were produced by a
    different document too, and deleting them would corrupt that upload's
    data. Returns (deleted_count, kept_shared_count).
    """
    client = get_client()
    shared: set[str] = set()
    if listing_ids:
        arr = "{" + ",".join(listing_ids) + "}"
        resp = (
            client.table("documents")
            .select("listing_ids")
            .neq("content_hash", content_hash)
            .filter("listing_ids", "ov", arr)  # 'ov' = PostgREST array overlap
            .execute()
        )
        for row in resp.data or []:
            shared.update(str(i) for i in (row.get("listing_ids") or []))

    to_delete = [i for i in listing_ids if i not in shared]
    if to_delete:
        client.table("listings").delete().in_("id", to_delete).execute()
    client.table("documents").delete().eq("content_hash", content_hash).execute()
    return len(to_delete), len(listing_ids) - len(to_delete)


# ---------------------------------------------------------------------
# Audit log — who uploaded / edited / deleted what
# ---------------------------------------------------------------------
@_db_op
def record_audit(actor: str | None, action: str, details: dict[str, Any]) -> None:
    """Append one activity entry. Call sites wrap this in try/except — an
    audit failure must never break the operation being audited."""
    get_client().table("audit_log").insert(
        {"actor": actor, "action": action, "details": details}
    ).execute()


def audit(actor: str | None, action: str, details: dict[str, Any]) -> None:
    """record_audit that never raises (logs the failure instead)."""
    try:
        record_audit(actor, action, details)
    except Exception:  # noqa: BLE001 — auditing is strictly best-effort
        logger.exception("Audit write failed for action %s", action)


@_db_op
def list_audit(page: int = 1, page_size: int = 20) -> tuple[list[dict[str, Any]], int]:
    """Audit entries newest first, server-paginated (admin activity view)."""
    offset = (page - 1) * page_size
    resp = (
        get_client()
        .table("audit_log")
        .select("id, actor, action, details, created_at", count="exact")
        .order("created_at", desc=True)
        .order("id", desc=True)
        .range(offset, offset + page_size - 1)
        .execute()
    )
    rows = resp.data or []
    for r in rows:
        r["actor"] = str(r["actor"]) if r.get("actor") else None
        r["created_at"] = str(r.get("created_at") or "")
    return rows, (resp.count or 0)


# ---------------------------------------------------------------------
# Documents (PDF content-hash ledger) — powers upload-time dedup
# ---------------------------------------------------------------------
@_db_op
def find_document(content_hash: str) -> dict[str, Any] | None:
    """Return the ledger row for this PDF hash, or None if never processed.

    Includes status/error/fatal so the caller can tell a genuinely finished
    duplicate from one that previously failed — a failed row must never be
    reported as a successful duplicate (see routers/upload.py)."""
    resp = (
        get_client()
        .table("documents")
        .select(
            "id, content_hash, filename, status, error, fatal, "
            "page_count, product_count, created_at"
        )
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def record_document(
    *,
    content_hash: str,
    filename: str,
    company_id: int | None,
    product_count: int,
    uploaded_by: str | None,
    listing_ids: list[str] | None = None,
) -> None:
    """Record a processed PDF so an identical re-upload is skipped next time.

    listing_ids captures exactly which listing rows this upload produced, so the
    upload history / admin audit can show "which ones" were added.
    """
    get_client().table("documents").upsert(
        {
            "content_hash": content_hash,
            "filename": filename,
            "company_id": company_id,
            "product_count": product_count,
            "uploaded_by": uploaded_by,
            "listing_ids": listing_ids or [],
        },
        on_conflict="content_hash",
    ).execute()


# ---------------------------------------------------------------------
# Upload history / audit (documents ledger, viewer-owned or admin-wide)
# ---------------------------------------------------------------------
# Columns exposed by the history endpoints (uploaded_by IS included here — this
# is the admin/owner audit view, whose whole purpose is "who uploaded what").
_HISTORY_COLUMNS = (
    "content_hash, filename, product_count, uploaded_by, created_at, "
    "listing_ids, companies(company_name, company_name_en)"
)


@_db_op
def list_documents(
    uploaded_by: str | None = None,
    since: datetime | None = None,
    page: int = 1,
    page_size: int = 10,
) -> tuple[list[dict[str, Any]], int]:
    """
    Return processed-upload records newest first, for the upload history view —
    server-paginated. Returns (rows, total_count) so the UI can render numbered
    pages without ever fetching the whole ledger (which grows unbounded).

    - uploaded_by: restrict to one user's own uploads (non-admin history);
      omit for the admin-wide audit.
    - since: keep only uploads on/after this instant (the date-range filter);
      omit for "all time".
    - page / page_size: 1-based server-side pagination (count reflects ALL
      matching rows across pages).
    """
    query = (
        get_client()
        .table("documents")
        .select(_HISTORY_COLUMNS, count="exact")
        .order("created_at", desc=True)
    )
    if uploaded_by is not None:
        query = query.eq("uploaded_by", uploaded_by)
    if since is not None:
        query = query.gte("created_at", since.isoformat())
    offset = (page - 1) * page_size
    resp = query.range(offset, offset + page_size - 1).execute()
    rows = [_flatten_company(r) for r in (resp.data or [])]
    return rows, (resp.count or 0)


@_db_op
def get_document(content_hash: str) -> dict[str, Any] | None:
    """Return one upload record (with flattened company), or None."""
    resp = (
        get_client()
        .table("documents")
        .select(_HISTORY_COLUMNS)
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    return _flatten_company(resp.data[0]) if resp.data else None


@_db_op
def get_listings_by_ids(ids: list[str]) -> list[dict[str, Any]]:
    """Return the viewer-safe listing rows for the given ids (order preserved)."""
    if not ids:
        return []
    resp = (
        get_client()
        .table("listings")
        .select(SEARCH_COLUMNS)
        .in_("id", ids)
        .execute()
    )
    rows = {r["id"]: _flatten_company(r) for r in (resp.data or [])}
    # Preserve the upload's original order; drop any listing since deleted.
    return [rows[i] for i in ids if i in rows]


@_db_op
def get_user_emails(user_ids: set[str]) -> dict[str, str]:
    """Map user ids → email via the Admin Auth API (for the admin audit view)."""
    if not user_ids:
        return {}
    users = get_client().auth.admin.list_users(page=1, per_page=500)
    return {str(u.id): u.email for u in users if str(u.id) in user_ids and u.email}


# ---------------------------------------------------------------------
# Search (viewer)
# ---------------------------------------------------------------------
# Columns exposed to viewers. Note: uploaded_by is intentionally excluded so
# the search API never leaks which admin uploaded a listing (spec section 5).
SEARCH_COLUMNS = (
    "id, chemical_id, company_id, "
    "companies(company_name, company_name_en), "
    "name_raw, name_en, cas_number, "
    "price, currency, price_usd, purity, needs_review, created_at"
)

# Full listing view for the product detail page: the viewer-safe search
# columns plus the flexible details blob and the printed supplier website.
DETAIL_COLUMNS = SEARCH_COLUMNS + ", details, company_website"

# Projection for the chat assistant (services/chat_agent.py).
#
# WHY THIS EXISTS: SEARCH_COLUMNS deliberately omits `details` — the results
# table doesn't render it. But `details` is where every technical attribute
# lives (application, grade, polymer_family, packaging, viscosity...), and most
# brochures print NO price, so `details` — not price — is the only axis the
# assistant can actually rank on. Handing it SEARCH_COLUMNS would give it
# names and mostly-null prices and nothing to reason with.
AGENT_COLUMNS = DETAIL_COLUMNS

# When a (free-text) purity filter is active, rows are fetched then filtered in
# Python BEFORE pagination. This caps how many rows we pull for that pass —
# comfortably above the current table size; raise it if the DB grows very large.
_PURITY_SCAN_CAP = 2000


@_db_op
def get_listing(listing_id: str) -> dict[str, Any] | None:
    """Return one listing with its full details (product page), or None."""
    resp = (
        get_client()
        .table("listings")
        .select(DETAIL_COLUMNS)
        .eq("id", listing_id)
        .limit(1)
        .execute()
    )
    return _flatten_company(resp.data[0]) if resp.data else None


@_db_op
def search_listings(
    *,
    q: str | None = None,
    supplier: str | None = None,
    cas_number: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_purity: float | None = None,
    max_purity: float | None = None,
    details_query: str | None = None,
    priced_only: bool = False,
    sort: str = "price_asc",
    letter: str | None = None,
    page: int = 1,
    page_size: int = 15,
    columns: str = SEARCH_COLUMNS,
) -> tuple[list[dict[str, Any]], int]:
    """
    Filter listings for the viewer search page. Returns (rows, total_count),
    where total_count is the number of matching rows across ALL pages so the
    frontend can render numbered pagination. Both the manual filter search and
    the AI search agent go through this one function — there is no second
    query path.

    - q: case-insensitive match against name_en, name_raw, or cas_number.
    - supplier: case-insensitive substring match against the supplier's
      bilingual names ONLY. `q` already folds supplier names into its broad
      search_text surface, so on its own it cannot express "this product, from
      this supplier" — that needs a separate axis. Resolved as
      companies -> ids -> `company_id IN (...)` rather than a PostgREST
      embedded-resource filter, because `.in_("company_id", ...)` is a pattern
      this module already uses and it needs no `!inner` rewrite of
      SEARCH_COLUMNS. No supplier match short-circuits to an empty page.
    - cas_number: case-insensitive substring match against cas_number only.
    - min_price / max_price: bounds in USD, compared against the normalized
      price_usd column so mixed-currency listings are comparable. Rows whose
      price can't be normalized (no price, or unrecognized currency) are
      excluded when either bound is set.
    - priced_only: drop listings that have no printed price at all.
    - min_purity / max_purity: keep rows whose numeric purity is within the
      bound. Purity is stored as free text (e.g. '99.5%'), so this is a
      best-effort filter applied in Python AFTER pagination — a page may show
      slightly fewer rows than page_size (see _purity_to_number).
    - details_query: loose case-insensitive match against the flexible
      `details` JSONB via the details_text computed field (migration
      'add_listing_details_and_website') — server-side, so counts stay right.
    - sort: 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc'
      (legacy 'name' == name_asc, 'price' == price_asc).
    - columns: the PostgREST projection. Defaults to the viewer-safe
      SEARCH_COLUMNS; the chat assistant passes AGENT_COLUMNS to also get the
      `details` blob. This widens the SELECT only — every filter, sort and
      pagination rule above is shared, so there is still exactly one query
      path (ARCHITECTURE.md §10).
    - letter: single A-Z character — restrict to chemicals whose English name
      starts with that letter (drives the alphabet pagination tabs).
    - page / page_size: server-side pagination (page is 1-based).
    """
    query = get_client().table("listings").select(columns, count="exact")

    if q:
        # ONE broad match surface: search_text is a PostgREST computed field
        # (migration 'add_listings_search_text') concatenating name_raw,
        # name_en, cas_number, the flattened details JSONB AND the supplier's
        # bilingual names — so a supplier name or a chemical mentioned only in
        # a product's description ("titanium dioxide" for grade HR990) still
        # surfaces the listing. Server-side, so pagination counts stay right.
        # Sanitized first: commas/parens/backslashes are structural in
        # PostgREST filters, and '*' is the wildcard alias (a literal '%' in a
        # bare ilike param trips the Cloudflare 1101 edge bug).
        safe = _sanitize_filter_value(q)
        if safe:
            query = query.ilike("search_text", f"*{safe}*")

    if supplier:
        safe_sup = _sanitize_filter_value(supplier)
        if safe_sup:
            # Resolve the name to company ids first, then constrain listings by
            # company_id. Two round-trips, but it keeps the listings query on
            # patterns already proven against this Supabase edge (see the
            # Cloudflare 1101 note above) instead of introducing an embedded
            # `companies!inner(...)` filter.
            comp = (
                get_client()
                .table("companies")
                .select("id")
                .or_(
                    f"company_name.ilike.*{safe_sup}*,"
                    f"company_name_en.ilike.*{safe_sup}*"
                )
                .execute()
            )
            company_ids = [c["id"] for c in (comp.data or [])]
            if not company_ids:
                # No supplier matched: the result set is empty by definition.
                # Return early rather than issuing an unconstrained query.
                return [], 0
            query = query.in_("company_id", company_ids)

    if cas_number:
        safe_cas = _sanitize_filter_value(cas_number)
        if safe_cas:
            # '*' is PostgREST's wildcard alias — see the letter-filter note.
            query = query.ilike("cas_number", f"*{safe_cas}*")

    if min_price is not None:
        query = query.not_.is_("price_usd", "null").gte("price_usd", min_price)

    if max_price is not None:
        query = query.not_.is_("price_usd", "null").lte("price_usd", max_price)

    if priced_only:
        query = query.not_.is_("price", "null")

    if details_query:
        safe_details = _sanitize_filter_value(details_query)
        if safe_details:
            # details_text is a PostgREST computed field exposing
            # details::text, so this loose match runs server-side with
            # correct pagination counts (not post-filtered in Python).
            query = query.ilike("details_text", f"*{safe_details}*")

    if letter:
        # Single alphabet tab: only names starting with that letter
        # (case-insensitive). The letter is validated by the router
        # (pattern ^[a-zA-Z]$), so it can't inject filter syntax.
        # NOTE: '*' is PostgREST's wildcard alias for '%'. A literal '%'
        # in a bare ilike param makes this project's Supabase edge throw
        # a Cloudflare Worker exception (error 1101), so use '*' here.
        query = query.ilike("name_en", f"{letter}*")

    if sort in ("name", "name_asc"):
        query = query.order("name_en", desc=False)
    elif sort == "name_desc":
        query = query.order("name_en", desc=True)
    elif sort == "price_desc":
        # Most expensive first, by the USD-normalized price so mixed
        # currencies rank correctly; unpriced/unconvertible rows go last.
        _order_nulls_last(query, "price_usd", desc=True)
    else:  # 'price' / 'price_asc' — cheapest first (USD), nulls last.
        _order_nulls_last(query, "price_usd", desc=False)

    # Stable tiebreaker so pagination never shows a row twice across pages.
    query = query.order("id", desc=False)

    # Purity is stored as free text (e.g. '99.5%', '>= 98%'), so it can't be
    # filtered in SQL. When a purity bound is active we fetch the matching rows
    # (all OTHER filters already applied), filter by parsed purity in Python,
    # then paginate the RESULT — so the count is correct AND rows without a
    # parseable purity are excluded (not silently kept, which used to make a
    # "min purity" filter return everything, priced/unpriced alike).
    if min_purity is not None or max_purity is not None:
        resp = query.limit(_PURITY_SCAN_CAP).execute()
        matched = [
            _flatten_company(r)
            for r in (resp.data or [])
            if _purity_in_range(r.get("purity"), min_purity, max_purity)
        ]
        total = len(matched)
        offset = (page - 1) * page_size
        return matched[offset : offset + page_size], total

    offset = (page - 1) * page_size
    resp = query.range(offset, offset + page_size - 1).execute()
    rows = [_flatten_company(r) for r in (resp.data or [])]
    return rows, (resp.count or 0)


def _completeness_rank(row: dict[str, Any]) -> tuple[int, int, int, str]:
    """
    Sort key for supplier comparison: most *usable* offer first.

    Deliberately NOT price-ordered. Most brochures print no price at all, so
    ranking by price would sort the catalog by which supplier happened to
    publish a number — an artefact of the source document, not a property of
    the offer. Instead: flagged rows sink, then richer rows float.
    Tuple is ascending, so each term is negated where "more is better".
    """
    return (
        1 if row.get("needs_review") else 0,
        -len(row.get("details") or {}),
        -(1 if row.get("purity") else 0) - (1 if row.get("price") else 0),
        (row.get("company_name") or "").lower(),
    )


@_db_op
def compare_suppliers(
    *,
    cas_number: str | None = None,
    chemical_id: str | None = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """
    Every listing for ONE substance, so the assistant can answer "who carries
    this". Matches on chemical_id when known (the canonical identity), else on
    an exact CAS.

    Ordered by data completeness rather than price — see _completeness_rank.
    """
    if not cas_number and not chemical_id:
        return []

    query = get_client().table("listings").select(AGENT_COLUMNS)
    if chemical_id:
        query = query.eq("chemical_id", chemical_id)
    else:
        safe_cas = _sanitize_filter_value(cas_number or "")
        if not safe_cas:
            return []
        # Exact match, not substring: '7647-14-5' must not also pull
        # '17647-14-5'. Substring CAS search is what /search is for.
        query = query.eq("cas_number", safe_cas)

    resp = query.limit(limit).execute()
    rows = [_flatten_company(r) for r in (resp.data or [])]
    rows.sort(key=_completeness_rank)
    return rows


@_db_op
def list_detail_keys(limit: int = 60) -> list[dict[str, Any]]:
    """
    Distinct keys used across listings.details, with how often each appears.

    Brochures label the same concept differently — 'application' in one,
    'uses' or 'recommended_for' in another — because the extraction prompt
    records whatever the page printed. The assistant needs to know the
    vocabulary that actually exists in THIS catalog instead of guessing key
    names that would silently match nothing.

    Counted in Python: `details` is a free-form JSONB blob, so there is no
    index or aggregate to lean on, and the row count here is small.
    """
    resp = (
        get_client()
        .table("listings")
        .select("details")
        .not_.is_("details", "null")
        .limit(_PURITY_SCAN_CAP)
        .execute()
    )
    counts: dict[str, int] = {}
    for row in resp.data or []:
        details = row.get("details")
        if isinstance(details, dict):
            for key in details:
                counts[key] = counts.get(key, 0) + 1

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"key": k, "count": n} for k, n in ranked[:limit]]


@_db_op
def get_listing_provenance(listing_id: str) -> dict[str, Any] | None:
    """
    Where a listing came from: the uploaded brochure and the page within it.

    This is what makes a recommendation checkable — the user can go look at the
    actual printed page rather than taking the assistant's word for it.
    """
    resp = (
        get_client()
        .table("listings")
        .select("id, name_en, document_id, source_page_id")
        .eq("id", listing_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return None
    listing = rows[0]

    out: dict[str, Any] = {
        "listing_id": listing["id"],
        "name_en": listing.get("name_en"),
        "filename": None,
        "content_hash": None,
        "page_number": None,
    }

    if listing.get("document_id"):
        doc = (
            get_client()
            .table("documents")
            .select("content_hash, filename")
            .eq("id", listing["document_id"])
            .limit(1)
            .execute()
        )
        if doc.data:
            out["filename"] = doc.data[0].get("filename")
            out["content_hash"] = doc.data[0].get("content_hash")

    if listing.get("source_page_id"):
        page = (
            get_client()
            .table("pages")
            .select("page_number")
            .eq("id", listing["source_page_id"])
            .limit(1)
            .execute()
        )
        if page.data:
            out["page_number"] = page.data[0].get("page_number")

    return out


@_db_op
def suggest(q: str, limit: int = 8) -> list[dict[str, Any]]:
    """
    Typeahead suggestions for the search box. Returns a small ranked list of
    chemical-name/CAS suggestions plus matching suppliers, each with a listing
    count, so the viewer can jump straight to a known chemical or supplier
    instead of scanning results.

    Chemicals are derived from a bounded sample of matching listings (grouped by
    English name, most-listed first). Suppliers are matched by name against the
    small companies dimension table (in Python — supplier names contain commas /
    parentheses that would break a PostgREST filter string, same reasoning as
    resolve_company).
    """
    safe = _sanitize_filter_value(q)
    if not safe:
        return []

    client = get_client()
    needle = safe.casefold()

    # --- Chemical suggestions: distinct English names from matching listings.
    # Matches the same broad search_text surface as search_listings (names,
    # CAS, details text, supplier names), so typing a chemical that only
    # appears in a description still suggests the product that contains it.
    resp = (
        client.table("listings")
        .select("name_en, cas_number")
        .ilike("search_text", f"*{safe}*")
        .limit(500)
        .execute()
    )
    grouped: dict[str, dict[str, Any]] = {}
    for row in resp.data or []:
        name = (row.get("name_en") or "").strip()
        if not name:
            continue
        entry = grouped.setdefault(
            name.casefold(),
            {"type": "chemical", "label": name, "cas_number": None, "count": 0},
        )
        entry["count"] += 1
        if not entry["cas_number"] and row.get("cas_number"):
            entry["cas_number"] = row["cas_number"]

    out: list[dict[str, Any]] = sorted(
        grouped.values(), key=lambda e: (-e["count"], e["label"].casefold())
    )[:limit]

    # --- Supplier suggestions: companies whose name contains the query ---
    comps = (
        client.table("companies")
        .select("id, company_name, company_name_en")
        .execute()
    )
    matched: list[dict[str, Any]] = []
    for c in comps.data or []:
        names = [
            (c.get("company_name") or "").strip(),
            (c.get("company_name_en") or "").strip(),
        ]
        display = next((n for n in names if n), "")
        if display and any(needle in n.casefold() for n in names if n):
            matched.append({"id": c["id"], "label": display})

    # Count listings for each matched supplier. Capped so a broad prefix can't
    # fan out into many count queries.
    for s in matched[:4]:
        cnt = (
            client.table("listings")
            .select("id", count="exact")
            .eq("company_id", s["id"])
            .limit(1)
            .execute()
        )
        out.append(
            {
                "type": "supplier",
                "label": s["label"],
                "cas_number": None,
                "count": cnt.count or 0,
            }
        )

    return out


# ---------------------------------------------------------------------
# Semantic index (P3) — one embedding per canonical chemical
# ---------------------------------------------------------------------
# Read/write side of chemical_embeddings. The vector itself never leaves this
# module in either direction as anything but a list of floats or pgvector's
# text literal; nothing above this layer knows what a vector looks like.


@_db_op
def list_all_chemical_ids() -> list[str]:
    """
    Every chemical id, paginated.

    NOT `list_chemicals()`: that issues one unbounded select, and PostgREST
    caps a request at 1000 rows by default. With 1005 chemicals live, the
    backfill silently never saw the last five — and the symptom was a progress
    counter reading "1000/1000", which looks like success. Page explicitly so
    the count is the truth.
    """
    ids: list[str] = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            get_client()
            .table("chemicals")
            .select("id")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        ids.extend(str(r["id"]) for r in rows)
        if len(rows) < page_size:
            return ids
        offset += page_size


@_db_op
def chemical_ids_for_document(document_id: str) -> list[str]:
    """
    The canonical chemicals a finished document touched.

    Drives the worker's post-upload refresh: only what changed gets
    re-embedded, so a completed brochure costs a handful of embedding calls
    rather than a full re-index.
    """
    resp = (
        get_client()
        .table("listings")
        .select("chemical_id")
        .eq("document_id", document_id)
        .not_.is_("chemical_id", "null")
        .execute()
    )
    return list(dict.fromkeys(str(r["chemical_id"]) for r in (resp.data or [])))


@_db_op
def listings_for_chemicals(chemical_ids: list[str]) -> list[dict[str, Any]]:
    """
    The listing rows behind a set of chemicals, for composing embedding source
    text: trade names as printed plus whatever technical attributes the
    brochures carried.
    """
    ids = [i for i in dict.fromkeys(chemical_ids) if i]
    if not ids:
        return []
    resp = (
        get_client()
        .table("listings")
        .select("chemical_id, name_en, name_raw, cas_number, details")
        .in_("chemical_id", ids)
        .execute()
    )
    return resp.data or []


@_db_op
def get_embedding_source_texts(chemical_ids: list[str]) -> dict[str, str]:
    """
    Map chemical id → the text currently embedded for it.

    The refresh job compares against this and skips anything unchanged, which
    is what makes re-running the backfill over a settled catalog free.
    """
    ids = [i for i in dict.fromkeys(chemical_ids) if i]
    if not ids:
        return {}
    resp = (
        get_client()
        .table("chemical_embeddings")
        .select("chemical_id, source_text")
        .in_("chemical_id", ids)
        .execute()
    )
    return {str(r["chemical_id"]): r.get("source_text") or "" for r in (resp.data or [])}


@_db_op
def upsert_chemical_embeddings(rows: list[dict[str, Any]]) -> int:
    """
    Write embeddings. Each row: {chemical_id, embedding (list[float]),
    source_text}. `updated_at` is set here so a stale-index check has one
    honest source of truth.
    """
    if not rows:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "chemical_id": r["chemical_id"],
            "embedding": r["embedding"],
            "source_text": r["source_text"],
            "updated_at": now,
        }
        for r in rows
    ]
    get_client().table("chemical_embeddings").upsert(
        payload, on_conflict="chemical_id"
    ).execute()
    return len(payload)


@_db_op
def count_chemical_embeddings() -> int:
    """
    How many chemicals are indexed. Used to detect an index that was never
    backfilled — the difference between "no similar chemicals" (a real answer)
    and "similarity search is not available here" (an operational gap).
    """
    resp = (
        get_client()
        .table("chemical_embeddings")
        .select("chemical_id", count="exact")
        .limit(1)
        .execute()
    )
    return resp.count or 0


def to_vector_literal(embedding: list[float]) -> str:
    """
    pgvector's own text form, '[0.1,0.2,…]'.

    Sent as a JSON string and cast inside match_chemicals, rather than relying
    on PostgREST coercing a JSON array into a vector — that behaviour has
    differed across PostgREST versions.
    """
    return "[" + ",".join(repr(float(v)) for v in embedding) + "]"


@_db_op
def match_chemicals(
    embedding: list[float],
    *,
    limit: int = 8,
    exclude_chemical_id: str | None = None,
    min_similarity: float = 0.0,
) -> list[dict[str, Any]]:
    """
    Nearest chemicals by cosine similarity (the match_chemicals RPC).

    Returns [] rather than raising when the index is empty; the caller decides
    whether that means "nothing similar" or "not indexed yet".
    """
    resp = get_client().rpc(
        "match_chemicals",
        {
            "query_embedding": to_vector_literal(embedding),
            "match_count": limit,
            "exclude_id": exclude_chemical_id,
            "min_similarity": min_similarity,
        },
    ).execute()
    return resp.data or []


# ---------------------------------------------------------------------
# House knowledge (P4) — curated substitution + regulatory notes
# ---------------------------------------------------------------------
# BosTech's own judgement, written by managers from the Inspector. Read by the
# chat assistant, which is instructed to treat these as OVERRIDING its own
# chemistry knowledge (docs/AI_SEARCH_ARCHITECTURE.md §5). Everything here is
# keyed by canonical chemical, never by listing: a substitution holds for a
# substance, not for one supplier's packaging of it.


@_db_op
def find_chemicals_by_name(name: str, limit: int = 5) -> list[dict[str, Any]]:
    """
    Canonical chemicals whose English name contains `name`.

    Used to turn the name a user typed ("titanium dioxide") into the ids the
    notes tables are keyed by. Returns several rather than one because a
    substring can legitimately match a family ("epoxy resin", "epoxy resin
    hardener") and the caller wants the notes on all of them.
    """
    safe = _sanitize_filter_value(name)
    if not safe:
        return []
    resp = (
        get_client()
        .table("chemicals")
        .select("id, cas_number, name_en")
        .ilike("name_en", f"%{safe}%")
        .limit(limit)
        .execute()
    )
    return resp.data or []


@_db_op
def get_chemicals_by_ids(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Map chemical id → {name_en, cas_number}, for labelling note rows."""
    unique = [i for i in dict.fromkeys(ids) if i]
    if not unique:
        return {}
    resp = (
        get_client()
        .table("chemicals")
        .select("id, name_en, cas_number")
        .in_("id", unique)
        .execute()
    )
    return {r["id"]: r for r in (resp.data or [])}


def _label_notes(
    rows: list[dict[str, Any]], id_keys: tuple[str, ...]
) -> list[dict[str, Any]]:
    """
    Attach `<key>_name` / `<key>_cas` for every chemical id on a note.

    Done as a second query rather than a PostgREST embed because
    substitution_notes has TWO foreign keys to `chemicals`, which forces
    embeds to be disambiguated by generated constraint name — a string that
    would silently break if the constraint were ever recreated.
    """
    prefixes = {
        "from_chemical_id": "from",
        "to_chemical_id": "to",
        "chemical_id": "chemical",
    }
    wanted = [str(row[k]) for row in rows for k in id_keys if row.get(k)]
    names = get_chemicals_by_ids(wanted)
    for row in rows:
        for key in id_keys:
            chem = names.get(str(row.get(key) or ""))
            prefix = prefixes[key]
            row[f"{prefix}_name"] = chem.get("name_en") if chem else None
            row[f"{prefix}_cas"] = chem.get("cas_number") if chem else None
    return rows


@_db_op
def list_substitution_notes(chemical_ids: list[str]) -> list[dict[str, Any]]:
    """
    Every substitution note touching these chemicals, newest first.

    Matches BOTH directions. A note saying "we used zinc oxide in place of
    titanium dioxide" is relevant when looking at either substance — from the
    zinc oxide side it is the fact that we have already deployed it as a
    replacement, which is exactly the sourcing knowledge worth surfacing.
    """
    ids = [i for i in dict.fromkeys(chemical_ids) if i]
    if not ids:
        return []
    client = get_client()
    columns = (
        "id, from_chemical_id, to_chemical_id, to_name, verdict, context, "
        "author_id, created_at"
    )
    rows: dict[str, dict[str, Any]] = {}
    for column in ("from_chemical_id", "to_chemical_id"):
        resp = (
            client.table("substitution_notes")
            .select(columns)
            .in_(column, ids)
            .order("created_at", desc=True)
            .execute()
        )
        for row in resp.data or []:
            rows[row["id"]] = row
    ordered = sorted(
        rows.values(), key=lambda r: str(r.get("created_at") or ""), reverse=True
    )
    return _label_notes(ordered, ("from_chemical_id", "to_chemical_id"))


@_db_op
def create_substitution_note(
    *,
    from_chemical_id: str,
    to_chemical_id: str | None,
    to_name: str,
    verdict: str,
    context: str,
    author_id: str | None,
) -> dict[str, Any]:
    resp = (
        get_client()
        .table("substitution_notes")
        .insert(
            {
                "from_chemical_id": from_chemical_id,
                "to_chemical_id": to_chemical_id,
                "to_name": to_name,
                "verdict": verdict,
                "context": context,
                "author_id": author_id,
            }
        )
        .execute()
    )
    return _label_notes(list(resp.data or []), ("from_chemical_id", "to_chemical_id"))[0]


@_db_op
def get_substitution_note(note_id: str) -> dict[str, Any] | None:
    resp = (
        get_client()
        .table("substitution_notes")
        .select("id, author_id")
        .eq("id", note_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def delete_substitution_note(note_id: str) -> bool:
    resp = (
        get_client()
        .table("substitution_notes")
        .delete()
        .eq("id", note_id)
        .execute()
    )
    return bool(resp.data)


@_db_op
def list_regulatory_notes(chemical_ids: list[str]) -> list[dict[str, Any]]:
    """Recorded regulatory statuses for these chemicals, newest first."""
    ids = [i for i in dict.fromkeys(chemical_ids) if i]
    if not ids:
        return []
    resp = (
        get_client()
        .table("regulatory_notes")
        .select(
            "id, chemical_id, jurisdiction, status, effective_date, note, "
            "source_url, author_id, created_at"
        )
        .in_("chemical_id", ids)
        .order("created_at", desc=True)
        .execute()
    )
    return _label_notes(list(resp.data or []), ("chemical_id",))


@_db_op
def create_regulatory_note(
    *,
    chemical_id: str,
    jurisdiction: str,
    status: str,
    effective_date: str | None,
    note: str,
    source_url: str | None,
    author_id: str | None,
) -> dict[str, Any]:
    resp = (
        get_client()
        .table("regulatory_notes")
        .insert(
            {
                "chemical_id": chemical_id,
                "jurisdiction": jurisdiction,
                "status": status,
                "effective_date": effective_date,
                "note": note,
                "source_url": source_url,
                "author_id": author_id,
            }
        )
        .execute()
    )
    return _label_notes(list(resp.data or []), ("chemical_id",))[0]


@_db_op
def get_regulatory_note(note_id: str) -> dict[str, Any] | None:
    resp = (
        get_client()
        .table("regulatory_notes")
        .select("id, author_id")
        .eq("id", note_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


@_db_op
def delete_regulatory_note(note_id: str) -> bool:
    resp = (
        get_client().table("regulatory_notes").delete().eq("id", note_id).execute()
    )
    return bool(resp.data)


def _order_nulls_last(query: Any, column: str, *, desc: bool) -> Any:
    """
    Append `column.<dir>.nullslast` to the order parameter EXPLICITLY.

    The pinned postgrest-py version only ever emits `.nullsfirst` (when
    nullsfirst=True) and never `.nullslast` — and Postgres defaults to NULLS
    FIRST for DESC. That is exactly why "most expensive" used to show the
    500+ unpriced listings before any priced one.
    """
    direction = "desc" if desc else "asc"
    value = f"{column}.{direction}.nullslast"
    existing = query.params.get("order")
    if existing:
        query.params = query.params.remove("order")
        value = f"{existing},{value}"
    query.params = query.params.add("order", value)
    return query


def _flatten_company(row: dict[str, Any]) -> dict[str, Any]:
    """
    Lift the embedded `companies(company_name)` object to a top-level
    `company_name` field so the row matches the flat ListingOut schema.

    PostgREST returns the joined company as a nested object (or None when a
    listing has no company_id). We pop it and expose just the name.
    """
    company = row.pop("companies", None)
    if isinstance(company, list):  # PostgREST returns a list for some FK shapes
        company = company[0] if company else None
    company = company or {}
    row["company_name"] = company.get("company_name") or ""
    row["company_name_en"] = company.get("company_name_en") or ""
    # Display conversion: PKR is computed at read time from the current rate
    # (price_usd is stored; PKR would go stale if persisted).
    if isinstance(row.get("price_usd"), (int, float)):
        row["price_pkr"] = rates.convert_usd(row["price_usd"], "PKR")
    return row


def _sanitize_filter_value(value: str) -> str:
    """
    Strip characters that are structural in a PostgREST filter string or that
    are ilike wildcards, so user input can't alter the filter's meaning.
    Removes: , ( ) \\ % _ and surrounding whitespace.
    """
    for ch in (",", "(", ")", "\\", "%", "_"):
        value = value.replace(ch, "")
    return value.strip()


def _purity_to_number(purity: str | None) -> float | None:
    """
    Best-effort parse of a free-text purity string into a percentage number.
    Handles forms like '99.5%', '>= 98', '98.0 %'. Returns None if unparseable.
    """
    if not purity:
        return None
    cleaned = []
    seen_dot = False
    for ch in purity:
        if ch.isdigit():
            cleaned.append(ch)
        elif ch == "." and not seen_dot:
            cleaned.append(ch)
            seen_dot = True
        elif cleaned:
            # Stop at the first non-numeric char after we've started a number.
            break
    try:
        return float("".join(cleaned)) if cleaned else None
    except ValueError:
        return None


def _purity_in_range(
    purity: str | None, minimum: float | None, maximum: float | None
) -> bool:
    """
    True if the row's parsed purity satisfies the active bound(s).

    Rows whose purity is absent or unparseable are EXCLUDED when a purity
    filter is set — asking for "min purity 99" should not return listings that
    have no purity at all (the previous keep-on-unparseable policy made the
    filter look like it did nothing).
    """
    value = _purity_to_number(purity)
    if value is None:
        return False
    if minimum is not None and value < minimum:
        return False
    if maximum is not None and value > maximum:
        return False
    return True
