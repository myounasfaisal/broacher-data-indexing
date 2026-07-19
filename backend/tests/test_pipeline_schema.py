"""
Unit tests for the pure chemical-validation predicates/transforms (stage 4/5
building blocks) — the deterministic guards the pipeline relies on.

These are the failure modes the task calls out explicitly; each is pinned here
so a regression in the CAS checksum, the element-symbol tokenizer, or the
bundle regex fails loudly.
"""

import pytest

from app.pipeline.schema import (
    is_valid_cas,
    looks_like_valid_formula,
    split_bundled_product,
)


# ── is_valid_cas ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "cas",
    [
        "64-17-5",    # ethanol — the worked example
        "7732-18-5",  # water
        "50-00-0",    # formaldehyde
        "1310-73-2",  # sodium hydroxide
    ],
)
def test_is_valid_cas_accepts_real_numbers(cas):
    assert is_valid_cas(cas) is True


@pytest.mark.parametrize(
    "cas",
    [
        "64-17-6",   # correct shape, wrong check digit (5 -> 6)
        "12-34-6",   # checksum mismatch
        "64175",     # no dashes -> fails the shape gate
        "abc-12-3",  # non-numeric
        "",          # empty
    ],
)
def test_is_valid_cas_rejects_bad_numbers(cas):
    assert is_valid_cas(cas) is False


# ── looks_like_valid_formula ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "formula",
    ["NaOH", "C2H5OH", "C6H12O6", "(C2H4)n", "H2O", "CaCO3"],
)
def test_real_formulas_pass(formula):
    assert looks_like_valid_formula(formula) is True


@pytest.mark.parametrize(
    "code",
    ["SM827", "A171", "DA-250", "REH115", "Xy9", "Q"],
)
def test_catalog_codes_are_not_formulas(code):
    # "SM827" is the canonical trap: a naive [A-Z][a-z]?\d* regex reads it as
    # S + M827; the periodic-table tokenizer rejects it because "M" is not an
    # element.
    assert looks_like_valid_formula(code) is False


def test_pdms_350_with_space_is_not_a_formula():
    # A space isn't in the formula charset at all -> rejected before tokenizing.
    assert looks_like_valid_formula("PDMS 350") is False


# ── split_bundled_product ─────────────────────────────────────────────────

def test_splits_silane_bundle_into_four():
    out = split_bundled_product(
        {"name_raw": "Silane: A171, A110, A170, A187",
         "name_en": "Silane: A171, A110, A170, A187", "details": {}}
    )
    assert len(out) == 4
    assert [p["name_raw"] for p in out] == [
        "Silane A171", "Silane A110", "Silane A170", "Silane A187",
    ]
    # category + grade recorded separately for each split product
    assert out[0]["details"]["category"] == "Silane"
    assert out[0]["details"]["grade"] == "A171"


def test_splits_polyamine_bundle():
    out = split_bundled_product(
        {"name_raw": "Polyamine: REH205, REH7301, REH206",
         "name_en": "Polyamine: REH205, REH7301, REH206", "details": {}}
    )
    assert [p["name_raw"] for p in out] == [
        "Polyamine REH205", "Polyamine REH7301", "Polyamine REH206",
    ]


def test_splits_plasticizer_bundle():
    out = split_bundled_product(
        {"name_raw": "Plasticizers: DINP, DIDP, DBP, DOP",
         "name_en": "Plasticizers: DINP, DIDP, DBP, DOP", "details": {}}
    )
    assert len(out) == 4


@pytest.mark.parametrize(
    "name",
    ["1,2-Dichloroethane", "Sodium citrate, dihydrate"],
)
def test_legitimate_comma_names_are_not_split(name):
    # No "category:" prefix -> the regex never fires, the record is returned
    # untouched as a single product.
    out = split_bundled_product({"name_raw": name, "name_en": name, "details": {}})
    assert len(out) == 1
    assert out[0]["name_raw"] == name


def test_single_item_after_colon_is_not_split():
    # "Category: oneitem" is not a list (needs >= 2 items) -> left alone.
    out = split_bundled_product(
        {"name_raw": "Grade: A171", "name_en": "Grade: A171", "details": {}}
    )
    assert len(out) == 1


def test_bundle_split_flags_ambiguous_fields_for_review():
    # A price/cas on the bundle can't be attributed per-item -> needs_review.
    out = split_bundled_product(
        {"name_raw": "Silane: A171, A110", "name_en": "Silane: A171, A110",
         "price": 100.0, "details": {}}
    )
    assert all(p["details"].get("needs_review") for p in out)
