"""
Integration test: the full pipeline (stages 2-5) against the Bostech Polymer
brochure fixture.

We drive it from the stage-1 transcription fixture and mock ONLY the stage-2
model call — replacing the live Qwen3 8B request with a crafted raw JSON that
deliberately still contains the failure modes (unsplit bundles, a grade code
placed in `formula`). This is deliberate: the LLM's judgment can't be asserted
deterministically offline, but the *guard layers* (schema → bundle split →
chemical validation) can, and they are exactly what must catch a stage-2 slip.
So the test proves the deterministic safety net holds even when stage 2 misses.

Asserts, per the task's integration-test contract:
  * no product name is an unsplit bundle,
  * no catalog code survives as a `formula`,
  * all CAS / price / currency fields are null (none are printed in Bostech),
  * one company for the whole document.
"""

import json
from pathlib import Path

import pytest

from app.pipeline import extraction
from app.pipeline.orchestrator import run_pipeline_from_markdown
from app.pipeline.schema import looks_like_valid_formula, split_bundled_product

FIXTURES = Path(__file__).parent / "fixtures"


# What a stage-2 model MIGHT emit for the Bostech page — intentionally
# imperfect: four bundles left unsplit and the PDMS grade code shoved into
# `formula`. Everything else mirrors the brochure (no CAS, no prices).
_RAW_STAGE2 = {
    "company_name": "Bostech Polymer Co., Ltd.",
    "company_name_en": "Bostech Polymer Co., Ltd.",
    "company_website": None,
    "products": [
        {"name_raw": "Silane: A171, A110, A170, A187",
         "name_en": "Silane: A171, A110, A170, A187",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": None, "details": {"category": "Silane Coupling Agents"}},
        {"name_raw": "Polyamine: REH205, REH7301, REH206",
         "name_en": "Polyamine: REH205, REH7301, REH206",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": None, "details": {}},
        {"name_raw": "PU Sealant: PS-40, PS-50, PS-60",
         "name_en": "PU Sealant: PS-40, PS-50, PS-60",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": None, "details": {}},
        {"name_raw": "Plasticizers: DINP, DIDP, DBP, DOP",
         "name_en": "Plasticizers: DINP, DIDP, DBP, DOP",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": None, "details": {}},
        {"name_raw": "Silicone OH Polymer (80k CST)",
         "name_en": "Silicone OH Polymer (80k CST)",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": None, "details": {"viscosity": "80k CST"}},
        # Grade code mistakenly emitted as a molecular formula -> stage 5 demotes
        {"name_raw": "PDMS 350", "name_en": "PDMS 350",
         "formula": "PDMS350", "cas_number": None, "price": None,
         "currency": None, "purity": None, "details": {}},
        # A genuine formula that MUST survive the demotion guard
        {"name_raw": "Oleic Acid (75%)", "name_en": "Oleic Acid (75%)",
         "formula": "C18H34O2", "cas_number": None, "price": None,
         "currency": None, "purity": "75%", "details": {}},
        {"name_raw": "Mold Release (60%)", "name_en": "Mold Release (60%)",
         "formula": None, "cas_number": None, "price": None, "currency": None,
         "purity": "60%", "details": {}},
    ],
}


@pytest.fixture
def bostech_markdown() -> str:
    return (FIXTURES / "bostech_transcription.md").read_text(encoding="utf-8")


@pytest.fixture
def patched_stage2(monkeypatch):
    """Replace the live stage-2 model call with the crafted raw JSON above."""
    monkeypatch.setattr(
        extraction, "_call_extraction",
        lambda markdown, schema: json.dumps(_RAW_STAGE2),
    )


def test_full_pipeline_on_bostech(bostech_markdown, patched_stage2):
    brochure, stats = run_pipeline_from_markdown(bostech_markdown)

    # One company for the whole document.
    assert brochure.company_name == "Bostech Polymer Co., Ltd."

    # Bundles expanded: 4 + 3 + 3 + 4 singletons = 14 + 4 non-bundle = 18.
    assert len(brochure.products) == 18
    assert stats.bundles_split == 4

    for p in brochure.products:
        # (1) No product name is still an unsplit bundle: re-splitting a final
        #     product must yield exactly itself.
        as_dict = {"name_raw": p.name_raw, "name_en": p.name_en, "details": {}}
        assert len(split_bundled_product(as_dict)) == 1, p.name_raw

        # (2) No catalog code survives as a formula.
        assert p.formula is None or looks_like_valid_formula(p.formula), p.name_raw

        # (3) No CAS / price / currency invented (none printed in Bostech).
        assert p.cas_number is None
        assert p.price is None
        assert p.currency is None


def test_pdms_grade_code_demoted_and_real_formula_kept(bostech_markdown, patched_stage2):
    brochure, stats = run_pipeline_from_markdown(bostech_markdown)
    by_name = {p.name_en: p for p in brochure.products}

    # The grade code "PDMS350" was demoted out of `formula` into details.grade.
    pdms = by_name["PDMS 350"]
    assert pdms.formula is None
    assert pdms.details.get("grade") == "PDMS350"
    assert stats.formulas_demoted == 1

    # The genuine formula on Oleic Acid survived, and its inline purity is kept.
    oleic = by_name["Oleic Acid (75%)"]
    assert oleic.formula == "C18H34O2"
    assert oleic.purity == "75%"


def test_split_products_carry_category_and_grade(bostech_markdown, patched_stage2):
    brochure, _ = run_pipeline_from_markdown(bostech_markdown)
    silanes = [p for p in brochure.products if p.name_en.startswith("Silane ")]
    assert {p.name_en for p in silanes} == {
        "Silane A171", "Silane A110", "Silane A170", "Silane A187",
    }
    assert all(p.details.get("grade") for p in silanes)
