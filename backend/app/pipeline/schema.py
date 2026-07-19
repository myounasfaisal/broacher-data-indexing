"""
Stage 3 schema + the pure chemical-validation predicates that feed stages 4/5.

  Qwen VLM -> Qwen3 8B -> [JSON Schema constrained decoding] -> [Pydantic]
  -> [chemical-specific validation]

The Pydantic models here are the single source of truth: feed
`ChemicalBrochure.model_json_schema()` straight into the stage-2
constrained-decoding call (see ``pipeline/extraction.py``) so the schema the
model is decoded against and the schema Pydantic re-validates against can never
drift apart.

This module holds ONLY the models plus the *pure* domain predicates/transforms
(`is_valid_cas`, `looks_like_valid_formula`, `split_bundled_product`). The
`validate_and_repair` orchestrator that stitches them together and *logs* every
repair lives in ``pipeline/validation.py`` — kept separate so this module stays
free of logging/config side effects and is trivial to unit-test.

Adapted from the reference `pipeline_schema_validation.py`. The algorithms
(CAS checksum, periodic-table tokenizer, bundle regex) are preserved verbatim
because they encode real failure modes seen in production output; where this
project's conventions differ from the reference, the deviation is commented.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Pydantic models == JSON Schema source of truth
# ---------------------------------------------------------------------------

CAS_PATTERN = r"^\d{2,7}-\d{2}-\d$"
# Loose charset filter for formula: letters, digits, parens, hydrate dot,
# ionic charge signs. No colons/commas/spaces — those always indicate a
# category label or a bundled list, never a real formula.
FORMULA_CHARSET_PATTERN = r"^[A-Za-z0-9()·.+-]*$"
CURRENCY_PATTERN = r"^([A-Z]{3}|[$€¥£])$"


class Product(BaseModel):
    """One chemical product extracted from a brochure.

    NOTE — relationship to ``app.schemas.chemical.ExtractedProduct``: that model
    is the shape the *production* upload path (jobs.py → database) persists and
    deliberately has no ``formula`` column. This ``Product`` is the pipeline's
    richer intermediate representation and DOES carry ``formula`` because the
    whole formula-vs-grade-code guard (stage 5) operates on it. Convert with
    ``.model_dump()`` at the seam if/when the pipeline feeds the DB path.
    """

    name_raw: str = Field(..., min_length=1, description="Exactly as printed")
    name_en: str = Field(..., min_length=1, description="English translation")
    formula: Optional[str] = Field(
        None,
        pattern=FORMULA_CHARSET_PATTERN,
        description="Real molecular formula only, never a grade/catalog code",
    )
    cas_number: Optional[str] = Field(None, pattern=CAS_PATTERN)
    price: Optional[float] = Field(None, ge=0)
    currency: Optional[str] = Field(None, pattern=CURRENCY_PATTERN)
    purity: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name_raw", "name_en")
    @classmethod
    def no_bundled_list_marker(cls, v: str) -> str:
        # Coarse trip-wire only: an unsplit bundle ("Silane: A171, A110, ...")
        # is NOT hard-rejected here — a Pydantic error would fail the whole
        # record and lose data. `split_bundled_product` (stage 4) repairs it
        # instead, which is strictly safer than raising.
        return v


class ChemicalBrochure(BaseModel):
    """A whole brochure/document: one company plus its products.

    One `company_name` for the entire document — multi-page brochures merge
    their per-page transcriptions before stage 2 so there is a single company
    identity, per the pipeline design.
    """

    company_name: str
    company_name_en: str
    company_website: Optional[str] = None
    products: list[Product] = Field(default_factory=list)


# Feed this into the stage-2 constrained-decoding call:
#   schema = ChemicalBrochure.model_json_schema()
#   client.chat.completions.create(..., extra_body={"guided_json": schema})


# ---------------------------------------------------------------------------
# Chemical-specific validation — PURE domain logic (no I/O, no logging)
# ---------------------------------------------------------------------------

ELEMENT_SYMBOLS = {
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al",
    "Si", "P", "S", "Cl", "Ar", "K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe",
    "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr",
    "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Pm", "Sm",
    "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W",
    "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn",
    "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf",
    "Es", "Fm", "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
    "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
}


def is_valid_cas(cas: str) -> bool:
    """Verify the CAS Registry Number check digit.

    Algorithm (unchanged from the reference): strip the dashes, take all digits
    except the last (check) digit, weight them by distance from the check digit
    (rightmost non-check digit = weight 1, next = 2, ...), sum, mod 10 must
    equal the check digit. E.g. 64-17-5 -> body digits 6,4,1,7 weighted
    4,3,2,1 = 24+12+2+7 = 45 -> 45 % 10 == 5 == check digit -> valid.
    """
    if not re.match(CAS_PATTERN, cas):
        return False
    digits = cas.replace("-", "")
    *body, check = digits
    total = sum(int(d) * (len(body) - i) for i, d in enumerate(body))
    return total % 10 == int(check)


def looks_like_valid_formula(formula: str) -> bool:
    """Tokenize against the real periodic table rather than a generic
    letter-case regex.

    This matters: a generic ``[A-Z][a-z]?\\d*`` pattern would happily accept
    "SM827" as two pseudo-elements "S" + "M827", since it doesn't know "M"
    isn't a real element on its own. Checking against the actual symbol set
    catches that (algorithm unchanged from the reference).
    """
    if not formula or not re.match(FORMULA_CHARSET_PATTERN, formula):
        return False
    # Strip digits, parens, hydrate dot, charge signs — keep letter runs.
    letters_only = re.sub(r"[0-9()·.+-]", "", formula)
    i, n = 0, len(letters_only)
    while i < n:
        two, one = letters_only[i:i + 2], letters_only[i:i + 1]
        if two in ELEMENT_SYMBOLS:
            i += 2
        elif one in ELEMENT_SYMBOLS:
            i += 1
        elif one == "n":  # polymer repeat-unit notation, e.g. (C2H4)n
            i += 1
        else:
            return False
    return True


# "Category: item, item, item" — the ONLY shape treated as a bundle. Requires a
# colon after a 2–40 char category label, so a bare comma in a real name (e.g.
# "1,2-Dichloroethane") never trips it.
_BUNDLE_RE = re.compile(r"^\s*(?P<category>[^:]{2,40}):\s*(?P<items>.+)$")


def split_bundled_product(product: dict) -> list[dict]:
    """Safety-net repair: if `name_raw` slipped through as an unsplit bundle
    ("Silane: A171, A110, A170, A187") despite the stage-2 prompt, split it
    mechanically here rather than losing data or failing the record.

    Intentionally conservative — it only fires on the "Category: item, item,
    item" shape (>=2 items), not on any comma anywhere, so real comma-bearing
    chemical names ("1,2-Dichloroethane", "Sodium citrate, dihydrate") are left
    alone. Unchanged from the reference.
    """
    m = _BUNDLE_RE.match(product.get("name_raw", ""))
    if not m:
        return [product]
    items = [
        x.strip()
        for x in re.split(r",|/|&|\band\b", m.group("items"))
        if x.strip()
    ]
    if len(items) < 2:
        return [product]

    category = m.group("category").strip()
    split_products = []
    for item in items:
        new_product = dict(product)
        new_product["name_raw"] = f"{category} {item}"
        new_product["name_en"] = f"{category} {item}"
        new_details = dict(product.get("details", {}))
        new_details.setdefault("category", category)
        new_details.setdefault("grade", item)
        new_product["details"] = new_details
        # formula/cas/price rarely apply to the whole bundle — if present on
        # the bundled record they're ambiguous per-item, so flag for review
        # rather than silently copying them across every split.
        for ambiguous_field in ("formula", "cas_number", "price", "currency"):
            if product.get(ambiguous_field) is not None:
                new_details.setdefault("needs_review", True)
        split_products.append(new_product)
    return split_products
