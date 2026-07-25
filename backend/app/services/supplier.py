"""
Supplier (company) resolution with domain-first dedup (IMPLEMENTATION_BRIEF.md §4).

Company names are formatted inconsistently across brochures; a website domain
rarely is — so the dedup lookup is ordered by signal reliability:
  1. website domain, exact match on companies.website_domain
  2. email domain, exact match (only when no website resolved)
  3. fuzzy name match (rapidfuzz), fallback only — ambiguous matches create a new
     row rather than risk a false merge (a duplicate is correctable; a wrong
     merge silently corrupts two companies' data together).

The companies table is a small dimension table (tens of rows), so it is fetched
and matched in Python — the same robust approach services.database.resolve_company
already uses (supplier names contain commas/parens that break PostgREST filters).
"""

from __future__ import annotations

import logging
import re
from typing import Any

from rapidfuzz import fuzz

from app.services.database import _db_op, get_client

logger = logging.getLogger(__name__)

# rapidfuzz token_sort_ratio (0-100) at/above which two names are the same
# supplier. ~0.6 similarity in the brief; kept conservative — below this we
# create a new row rather than risk a false merge.
_NAME_MATCH_THRESHOLD = 82


def normalize_domain(value: str | None) -> str | None:
    """Reduce a URL or email to its bare registrable-ish domain: no scheme, no
    www., no path/query, lower-cased. Returns None if nothing usable."""
    if not value:
        return None
    v = value.strip().lower()
    if not v:
        return None
    # Email → take the part after @.
    if "@" in v and "/" not in v:
        v = v.split("@", 1)[1]
    v = re.sub(r"^[a-z][a-z0-9+.\-]*://", "", v)  # strip scheme
    v = v.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]  # strip path/query/frag
    v = re.sub(r"^www\.", "", v)
    v = v.strip().strip(".")
    return v or None


def _email_domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return normalize_domain(email)


@_db_op
def _all_companies() -> list[dict[str, Any]]:
    resp = (
        get_client()
        .table("companies")
        .select("id, company_name, company_name_en, website, website_domain, email, contact_number")
        .execute()
    )
    return resp.data or []


@_db_op
def _backfill(company_id: int, fields: dict[str, Any]) -> None:
    if fields:
        get_client().table("companies").update(fields).eq("id", company_id).execute()


@_db_op
def _insert_company(fields: dict[str, Any]) -> int:
    resp = get_client().table("companies").insert(fields).execute()
    return resp.data[0]["id"]


def resolve_company(identity: dict[str, Any]) -> int:
    """
    Resolve a supplier identity to a companies.id, creating it if new.

    `identity` keys (any may be absent/None): company_name, company_name_en,
    company_website, company_email, company_phone.

    Applies the domain → email-domain → fuzzy-name lookup order, backfilling
    newly-learned details onto a matched row (first printed value wins), and
    returns the resolved company id.
    """
    name = (identity.get("company_name") or "").strip()
    name_en = (identity.get("company_name_en") or "").strip() or None
    website = (identity.get("company_website") or "").strip() or None
    email = (identity.get("company_email") or "").strip() or None
    phone = (identity.get("company_phone") or "").strip() or None
    domain = normalize_domain(website)
    edomain = _email_domain(email)

    companies = _all_companies()

    def _new_row_fields() -> dict[str, Any]:
        return {
            "company_name": name or (name_en or "Unknown supplier"),
            "company_name_en": name_en,
            "website": website,
            "website_domain": domain,
            "email": email,
            "contact_number": phone,
        }

    def _backfill_for(row: dict[str, Any]) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        if name_en and not row.get("company_name_en"):
            patch["company_name_en"] = name_en
        if website and not row.get("website"):
            patch["website"] = website
        if domain and not row.get("website_domain"):
            patch["website_domain"] = domain
        if email and not row.get("email"):
            patch["email"] = email
        if phone and not row.get("contact_number"):
            patch["contact_number"] = phone
        return patch

    # 1. Website domain, exact match — most reliable signal.
    if domain:
        for row in companies:
            if (row.get("website_domain") or "").strip().lower() == domain:
                _backfill(row["id"], _backfill_for(row))
                return row["id"]

    # 2. Email domain, exact match — only when no website was resolved.
    if not domain and edomain:
        for row in companies:
            if _email_domain(row.get("email")) == edomain:
                _backfill(row["id"], _backfill_for(row))
                return row["id"]

    # 3. Fuzzy name fallback. Conservative — ambiguous → create new.
    if name or name_en:
        targets = [t for t in (name, name_en) if t]
        best_id, best_score = None, 0
        for row in companies:
            for cand in (row.get("company_name"), row.get("company_name_en")):
                if not cand:
                    continue
                for t in targets:
                    score = fuzz.token_sort_ratio(t, cand)
                    if score > best_score:
                        best_score, best_id = score, row["id"]
        if best_id is not None and best_score >= _NAME_MATCH_THRESHOLD:
            logger.info("Supplier fuzzy-matched (score=%d) → company %s", best_score, best_id)
            match = next(r for r in companies if r["id"] == best_id)
            _backfill(best_id, _backfill_for(match))
            return best_id

    # No match — create a new supplier.
    return _insert_company(_new_row_fields())
