"""
Tests for the stage 3-5 orchestrator `validate_and_repair` / `validate_brochure`
and the `RepairStats` observability counters — the layer that turns the pure
guards into logged, countable repairs.
"""

from app.pipeline.validation import (
    RepairStats,
    validate_and_repair,
    validate_brochure,
)


def test_bad_cas_checksum_flagged_and_nulled():
    stats = RepairStats()
    products = validate_and_repair(
        {"name_raw": "Ethanol", "name_en": "Ethanol", "cas_number": "64-17-6"},
        stats,
    )
    assert len(products) == 1
    p = products[0]
    assert p.cas_number is None
    assert p.details["cas_checksum_failed"] == "64-17-6"
    assert stats.cas_checksum_failures == 1


def test_valid_cas_is_kept():
    stats = RepairStats()
    products = validate_and_repair(
        {"name_raw": "Ethanol", "name_en": "Ethanol", "cas_number": "64-17-5"},
        stats,
    )
    assert products[0].cas_number == "64-17-5"
    assert stats.cas_checksum_failures == 0


def test_formula_shaped_grade_code_demoted():
    stats = RepairStats()
    products = validate_and_repair(
        {"name_raw": "Primer SM827", "name_en": "Primer SM827",
         "formula": "SM827"},
        stats,
    )
    p = products[0]
    assert p.formula is None
    assert p.details["grade"] == "SM827"
    assert stats.formulas_demoted == 1


def test_bundle_split_counts_products_added():
    stats = RepairStats()
    products = validate_and_repair(
        {"name_raw": "Silane: A171, A110, A170, A187",
         "name_en": "Silane: A171, A110, A170, A187"},
        stats,
    )
    assert len(products) == 4
    assert stats.bundles_split == 1
    assert stats.products_added_by_split == 3


def test_validate_brochure_assembles_company_and_products():
    raw = {
        "company_name": "Acme Chem",
        "company_name_en": "Acme Chem",
        "products": [
            {"name_raw": "NaOH", "name_en": "Sodium Hydroxide",
             "formula": "NaOH", "cas_number": "1310-73-2"},
            {"name_raw": "Silane: A171, A110", "name_en": "Silane: A171, A110"},
        ],
    }
    brochure, stats = validate_brochure(raw)
    assert brochure.company_name == "Acme Chem"
    # 1 plain product + 2 from the split bundle = 3
    assert len(brochure.products) == 3
    assert stats.bundles_split == 1
    assert stats.any_repair is True
    # The real formula + valid CAS survived untouched.
    naoh = next(p for p in brochure.products if p.name_en == "Sodium Hydroxide")
    assert naoh.formula == "NaOH"
    assert naoh.cas_number == "1310-73-2"


def test_unsalvageable_product_dropped_not_crashing():
    # An empty name can't satisfy min_length=1 even after repair -> dropped,
    # counted, and the good product still comes through.
    raw = {
        "company_name": "Acme",
        "company_name_en": "Acme",
        "products": [
            {"name_raw": "", "name_en": ""},
            {"name_raw": "Toluene", "name_en": "Toluene"},
        ],
    }
    brochure, stats = validate_brochure(raw)
    assert [p.name_en for p in brochure.products] == ["Toluene"]
    assert stats.products_dropped == 1
