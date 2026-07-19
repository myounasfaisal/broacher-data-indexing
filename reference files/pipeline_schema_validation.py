"""
Schema + validation layers for the pipeline:

  Qwen VLM -> Qwen3 8B -> [JSON Schema constrained decoding] -> [Pydantic]
  -> [Chemical-specific validation]

Design principle: don't rely on the LLM prompt for anything that can be
mechanically guaranteed instead. The Pydantic model below is the single
source of truth — feed `ChemicalBrochure.model_json_schema()` straight into
your constrained-decoding call (vLLM guided_json / outlines / lm-format-
enforcer all accept a JSON Schema dict directly), so the schema and the
validators never drift apart.

Field-level `pattern=` constraints here are deliberately conservative: they
reject only shapes that are essentially never valid (a CAS number missing
its dashes, a "formula" containing a colon or comma) rather than trying to
fully validate chemistry via regex — that's what the chemical-specific
validation functions at the bottom are for, since they need real reference
data (the periodic table, a checksum algorithm) that a JSON Schema pattern
can't express.
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
# category label or bundled list, never a real formula.
FORMULA_CHARSET_PATTERN = r"^[A-Za-z0-9()\u00b7.+-]*$"
CURRENCY_PATTERN = r"^([A-Z]{3}|[$€¥£])$"


class Product(BaseModel):
    name_raw: str = Field(..., min_length=1, description="Exactly as printed")
    name_en: str = Field(..., min_length=1, description="English translation")
    formula: Optional[str] = Field(
        None, pattern=FORMULA_CHARSET_PATTERN,
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
        # Coarse trip-wire only: a colon immediately followed by 2+
        # comma-separated short tokens is almost always an unsplit bundle
        # ("Silane: A171, A110, A170, A187"). We don't hard-reject here
        # (Pydantic errors would just fail the whole record) — we flag via
        # the repair function below instead, which is safer than raising.
        return v


class ChemicalBrochure(BaseModel):
    company_name: str
    company_name_en: str
    company_website: Optional[str] = None
    products: list[Product] = Field(default_factory=list)


# Feed this into your constrained-decoding call:
#   schema = ChemicalBrochure.model_json_schema()
#   llm.generate(prompt, guided_json=schema)   # e.g. vLLM


# ---------------------------------------------------------------------------
# Chemical-specific validation (post-Pydantic, domain logic)
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

    Algorithm: strip the dashes, take all digits except the last (check)
    digit, weight them by their distance from the check digit (rightmost
    non-check digit = weight 1, next = 2, ...), sum, mod 10 must equal the
    check digit. E.g. 64-17-5 -> digits 6,4,1,7 weighted 4,3,2,1 = 24+12+2+7
    = 45 -> 45 % 10 == 5 == check digit. Valid.
    """
    if not re.match(CAS_PATTERN, cas):
        return False
    digits = cas.replace("-", "")
    *body, check = digits
    total = sum(int(d) * (len(body) - i) for i, d in enumerate(body))
    return total % 10 == int(check)


def looks_like_valid_formula(formula: str) -> bool:
    """Tokenize against the real periodic table rather than a generic
    letter-case regex. This matters: a generic "[A-Z][a-z]?\\d*" pattern
    would happily accept "SM827" as two pseudo-elements "S" + "M827", since
    it doesn't know "M" isn't a real element on its own. Checking against
    the actual symbol set catches that.
    """
    if not formula or not re.match(FORMULA_CHARSET_PATTERN, formula):
        return False
    # Strip digits, parens, hydrate dot, charge signs — keep letter runs.
    letters_only = re.sub(r"[0-9()\u00b7.+-]", "", formula)
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


_BUNDLE_RE = re.compile(r"^\s*(?P<category>[^:]{2,40}):\s*(?P<items>.+)$")


def split_bundled_product(product: dict) -> list[dict]:
    """Safety-net repair: if name_raw slipped through as an unsplit bundle
    ("Silane: A171, A110, A170, A187") despite the prompt instructions, split
    it here mechanically rather than losing data or failing the record.

    This is intentionally conservative — it only fires on the
    "Category: item, item, item" shape, not on any comma anywhere, so real
    comma-bearing chemical names (e.g. "1,2-Dichloroethane") are left alone.
    """
    m = _BUNDLE_RE.match(product.get("name_raw", ""))
    if not m:
        return [product]
    items = [x.strip() for x in re.split(r",|/|&|\band\b", m.group("items")) if x.strip()]
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
        # formula/cas_number/price rarely apply to the whole bundle — if
        # present on the bundled record, they're ambiguous per-item, so
        # flag rather than silently duplicate them across all splits.
        for ambiguous_field in ("formula", "cas_number", "price", "currency"):
            if product.get(ambiguous_field) is not None:
                new_details.setdefault("needs_review", True)
        split_products.append(new_product)
    return split_products


def validate_and_repair(raw_product: dict) -> list[Product]:
    """Full chemical-specific validation pass for one extracted product dict.
    Returns a list because a bundle repair can turn one dict into several.
    """
    repaired: list[Product] = []
    for candidate in split_bundled_product(raw_product):
        # Auto-correct a formula-shaped grade code back into details.grade.
        formula = candidate.get("formula")
        if formula and not looks_like_valid_formula(formula):
            candidate.setdefault("details", {})["grade"] = candidate["details"].get("grade", formula)
            candidate["formula"] = None

        # Flag (don't silently drop) a CAS number that fails the checksum —
        # likely an OCR/transcription error worth a human glance.
        cas = candidate.get("cas_number")
        if cas and not is_valid_cas(cas):
            candidate.setdefault("details", {})["cas_checksum_failed"] = cas
            candidate["cas_number"] = None

        repaired.append(Product.model_validate(candidate))
    return repaired
