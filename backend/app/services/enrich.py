"""
Deterministic reference enrichment from PubChem (by CAS number).

This is NOT an LLM step and never invents data: given a product's CAS number,
it queries PubChem's public REST API for authoritative reference properties
(IUPAC name, molecular formula, molecular weight, …) and attaches them to the
product's `details` under a clearly-labelled key so the UI can show that this
information came from PubChem and was NOT printed on the brochure.

Important scope limits (this is why re-introducing PubChem is safe this time):
  - Enrichment ONLY adds reference fields to `details`. It never touches
    chemical identity/dedup (chemical_id resolution stays CAS/name based in
    dedup.py) — so it cannot cause the over-merging that got the old PubChem
    integration removed.
  - Best-effort: any network/lookup failure is swallowed and the product is
    left exactly as extracted from the brochure.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor

import httpx
from rapidfuzz import fuzz

from app.config import eff_bool, settings
from app.schemas.chemical import ExtractionResult

logger = logging.getLogger(__name__)

_PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

_CAS_RE = re.compile(r"^\d{2,7}-\d{2}-\d$")

# Confidence gate for a name→CAS lookup: the cleaned query name must fuzzy-match
# PubChem's canonical Title at least this well. This is what stops a generic
# label like "Primer" (which PubChem happily resolves to some unrelated CID)
# from getting a bogus CAS — that match scores ~19, real chemicals score ~100.
_NAME_MATCH_MIN = 80

# Markers after which the text is a spec/qualifier, not part of the chemical
# name ("Sulfamic acid Content 99.5%" → look up "Sulfamic acid").
_NAME_CUT_MARKERS = (
    "Content", "Purity", "Specification", "Grade", "Model", "National",
    "Industrial", "Application", "Premium", "Superior", "Standard", "Assay",
    # ECHEMI-style market-list suffixes ("Urea China Domestic Price" → "Urea").
    "China", "Domestic", "Regional", "International", "Enterprise", "Market",
    "Price", "East China", "South", "North", "Europe",
    "≥", "≤", "(",
)

# Key under which reference data is attached to a product's details. The label
# itself states the provenance so it reads clearly on the product page.
REFERENCE_KEY = "reference_data"

_SOURCE_NOTE = "From PubChem by CAS — NOT printed on this brochure"


def enrich_by_cas(cas: str) -> dict | None:
    """
    Look up authoritative reference properties for a CAS number on PubChem.

    Returns a dict of reference fields (always including a `source` note), or
    None when the CAS isn't found or the lookup fails. Purely deterministic —
    the values come straight from PubChem, never from a language model.
    """
    cas = (cas or "").strip()
    if not cas:
        return None

    try:
        with httpx.Client(timeout=10.0) as client:
            # CAS number → PubChem CID (PubChem indexes CAS as a name synonym).
            cid_resp = client.get(
                f"{_PUBCHEM}/compound/name/{cas}/cids/JSON"
            )
            if cid_resp.status_code != 200:
                return None
            cids = (
                cid_resp.json().get("IdentifierList", {}).get("CID", [])
            )
            if not cids:
                return None
            cid = cids[0]

            # CID → authoritative properties.
            prop_resp = client.get(
                f"{_PUBCHEM}/compound/cid/{cid}/property/"
                "IUPACName,MolecularFormula,MolecularWeight,Title/JSON"
            )
            if prop_resp.status_code != 200:
                return None
            props = (
                prop_resp.json()
                .get("PropertyTable", {})
                .get("Properties", [{}])[0]
            )
    except Exception as exc:  # network / JSON / timeout — best-effort only
        logger.warning("PubChem lookup failed for CAS %s: %s", cas, exc)
        return None

    ref: dict[str, str] = {"source": _SOURCE_NOTE}
    if props.get("Title"):
        ref["pubchem_name"] = str(props["Title"])
    if props.get("IUPACName"):
        ref["iupac_name"] = str(props["IUPACName"])
    if props.get("MolecularFormula"):
        ref["molecular_formula"] = str(props["MolecularFormula"])
    if props.get("MolecularWeight"):
        ref["molecular_weight"] = str(props["MolecularWeight"])
    ref["pubchem_cid"] = str(cid)

    # Only meaningful if we actually got a property beyond the source note.
    return ref if len(ref) > 2 else None


_CAS_LOOKUP_NOTE = "Resolved from the chemical name via PubChem — NOT printed on this brochure"


def _clean_chemical_name(name: str) -> str:
    """Reduce a noisy product name to just its chemical-name portion for lookup.

    "Sulfamic acid Content 99.5%, mainly used…" → "Sulfamic acid". Keeps the
    lookup accurate and avoids matching on packaging / grade / marketing text.
    """
    n = name or ""
    for marker in _NAME_CUT_MARKERS:
        i = n.find(marker)
        if i > 0:
            n = n[:i]
    n = re.split(r"\s\d", n)[0]          # cut before a standalone number/grade
    n = n.split(",")[0]                   # drop trailing clauses
    return n.strip(" ,-")


def lookup_cas_by_name(name: str) -> dict | None:
    """Resolve a chemical NAME to a CAS number via PubChem, with a confidence gate.

    Returns {cas, cid, pubchem_name, ...reference props} or None. Only returns a
    CAS when the cleaned name fuzzy-matches PubChem's canonical title (so generic
    labels like "Primer" don't get a bogus CAS). Deterministic; best-effort.
    """
    query = _clean_chemical_name(name)
    if len(query) < 3:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            cid_resp = client.get(f"{_PUBCHEM}/compound/name/{query}/cids/JSON")
            if cid_resp.status_code != 200:
                return None
            cids = cid_resp.json().get("IdentifierList", {}).get("CID", [])
            if not cids:
                return None
            cid = cids[0]

            prop_resp = client.get(
                f"{_PUBCHEM}/compound/cid/{cid}/property/"
                "IUPACName,MolecularFormula,MolecularWeight,Title/JSON"
            )
            props = (
                prop_resp.json().get("PropertyTable", {}).get("Properties", [{}])[0]
                if prop_resp.status_code == 200 else {}
            )
            title = str(props.get("Title") or "")
            # Confidence gate — reject weak/ambiguous matches.
            if fuzz.token_set_ratio(query.lower(), title.lower()) < _NAME_MATCH_MIN:
                return None

            syn_resp = client.get(f"{_PUBCHEM}/compound/cid/{cid}/synonyms/JSON")
            synonyms = (
                syn_resp.json().get("InformationList", {})
                .get("Information", [{}])[0].get("Synonym", [])
                if syn_resp.status_code == 200 else []
            )
    except Exception as exc:  # network / JSON / timeout — best-effort only
        logger.warning("PubChem name→CAS lookup failed for %r: %s", name, exc)
        return None

    cas_hits = [s for s in synonyms if _CAS_RE.match(s)]
    if not cas_hits:
        return None

    ref: dict[str, str] = {"source": _CAS_LOOKUP_NOTE, "cas_number": cas_hits[0], "pubchem_cid": str(cid)}
    if title:
        ref["pubchem_name"] = title
    if props.get("IUPACName"):
        ref["iupac_name"] = str(props["IUPACName"])
    if props.get("MolecularFormula"):
        ref["molecular_formula"] = str(props["MolecularFormula"])
    if props.get("MolecularWeight"):
        ref["molecular_weight"] = str(props["MolecularWeight"])
    return ref


def enrich_result(result: ExtractionResult) -> None:
    """
    Enrich extracted products from PubChem, in place. Controlled by
    settings.pubchem_enrichment. Never raises — failures leave the
    brochure-extracted data untouched.

    Two paths, per product:
      - CAS already printed → attach authoritative reference data (formula,
        IUPAC name, …) under details.reference_data.
      - No CAS printed but a recognizable chemical name → resolve the CAS from
        the name (settings.pubchem_cas_lookup), populate cas_number, and record
        the provenance so it's clear the CAS was looked up, not printed.
    Lookups run concurrently (bounded) to keep upload time reasonable.
    """
    if not eff_bool("pubchem_enrichment"):
        return

    def _one(product) -> None:
        cas = (product.cas_number or "").strip()
        if cas:
            ref = enrich_by_cas(cas)
            if ref:
                details = dict(product.details or {})
                details[REFERENCE_KEY] = ref
                product.details = details
                logger.info("Enriched CAS %s from PubChem (CID %s)", cas, ref.get("pubchem_cid"))
            return
        # No printed CAS → try to resolve one from the name.
        if not eff_bool("pubchem_cas_lookup"):
            return
        ref = lookup_cas_by_name(product.name_en or product.name_raw or "")
        if not ref:
            return
        product.cas_number = ref["cas_number"]
        details = dict(product.details or {})
        details["cas_source"] = "pubchem_name_lookup"
        details[REFERENCE_KEY] = ref
        product.details = details
        logger.info(
            "Resolved CAS %s for %r via PubChem name lookup (CID %s)",
            ref["cas_number"], product.name_en, ref.get("pubchem_cid"),
        )

    # PubChem asks for <=5 requests/sec; a small pool keeps well under that
    # while cutting wall-clock for brochures with many products.
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(_one, result.products))
