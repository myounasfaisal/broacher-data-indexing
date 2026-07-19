"""
Chemical deduplication ("same chemical, different name").

Resolution flow — deliberately simple and predictable:

    Has a CAS number?
      YES → match on CAS ONLY.
              exact CAS hit   → reuse that chemical
              no CAS hit      → create a new canonical chemical
            The name is NOT consulted when a CAS is present: CAS is
            authoritative, so a CAS-bearing product never fuzzy-merges onto a
            differently-named chemical.
      NO  → resolve by English name.
              exact (case-insensitive) name hit → reuse (confident)
              fuzzy similarity >= FUZZY_THRESHOLD → reuse, flagged needs_review
              otherwise → create a new canonical chemical

Returns (chemical_id, needs_review). needs_review is True only for an uncertain
fuzzy merge a human should confirm.
"""

from __future__ import annotations

import logging

from rapidfuzz import fuzz, process

from app.services import database

logger = logging.getLogger(__name__)

# rapidfuzz similarity (0-100) at/above which two English names are treated as
# the same chemical when NO CAS is available. High to avoid false merges.
FUZZY_THRESHOLD = 97


def _resolve_or_create(name_en: str, cas_number: str | None) -> tuple[str, bool]:
    """
    Given a (possibly None) CAS and an English name, return (chemical_id,
    needs_review). Creates a new canonical chemical if nothing matches.
    """
    # --- CAS present → match on CAS only (authoritative) ---
    if cas_number:
        existing = database.find_chemical_by_cas(cas_number)
        if existing:
            return existing["id"], False
        created = database.create_chemical(name_en=name_en, cas_number=cas_number)
        return created["id"], False

    # --- No CAS → resolve by English name ---
    # Exact (case-insensitive) name match is a confident hit, no review needed.
    existing = database.find_chemical_by_name_en(name_en)
    if existing:
        return existing["id"], False

    # Fuzzy match against known English names; an uncertain merge is flagged.
    chemicals = database.list_chemicals()
    if chemicals:
        names = [c["name_en"] for c in chemicals]
        match = process.extractOne(name_en, names, scorer=fuzz.token_sort_ratio)
        if match and match[1] >= FUZZY_THRESHOLD:
            matched_chemical = chemicals[match[2]]
            logger.info(
                "Fuzzy-matched %r -> %r (score %.0f >= %d); flagging needs_review",
                name_en,
                matched_chemical["name_en"],
                match[1],
                FUZZY_THRESHOLD,
            )
            return matched_chemical["id"], True

    # Nothing matched — create a brand new canonical chemical.
    created = database.create_chemical(name_en=name_en, cas_number=None)
    return created["id"], False


def resolve_chemical(name_en: str, cas_number: str | None) -> tuple[str, bool]:
    """
    Public entry point. Returns (chemical_id, needs_review).

    needs_review is True only when the chemical was matched by fuzzy similarity
    (an uncertain merge a human should confirm).
    """
    return _resolve_or_create(name_en=name_en, cas_number=cas_number)
