"""
Stages 3-5 — the validation/repair layers, with observability.

  ... -> [Pydantic: ChemicalBrochure.model_validate]   (stage 3)
      -> [bundle splitting: split_bundled_product]     (stage 4)
      -> [chemical validation: formula/CAS demotion]   (stage 5)

`validate_and_repair` is the per-product orchestrator lifted from the reference
`pipeline_schema_validation.py`, wrapped here so that every repair emits a log
line. The task calls these out as *accuracy signals worth tracking over time*,
not silent fixes — a rising rate of "bundle split" or "cas checksum failed"
means either a supplier's brochure style or an upstream stage regressed.

Why this lives apart from `schema.py`: the pure predicates (`is_valid_cas`,
`looks_like_valid_formula`, `split_bundled_product`) have no side effects and
are unit-tested in isolation; the logging + brochure-level assembly belong to
this layer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.pipeline.schema import (
    ChemicalBrochure,
    Product,
    is_valid_cas,
    looks_like_valid_formula,
    split_bundled_product,
)

logger = logging.getLogger(__name__)


@dataclass
class RepairStats:
    """Counters for the repairs applied while validating one brochure.

    Returned alongside the validated brochure so callers (the orchestrator, a
    future metrics sink, tests) can assert on / track what the guard layers
    actually did, instead of the repairs being invisible.
    """

    bundles_split: int = 0
    products_added_by_split: int = 0  # net new products created by splitting
    formulas_demoted: int = 0
    cas_checksum_failures: int = 0
    products_dropped: int = 0  # records that couldn't be salvaged even after repair
    drop_reasons: list[str] = field(default_factory=list)

    @property
    def any_repair(self) -> bool:
        return bool(
            self.bundles_split
            or self.formulas_demoted
            or self.cas_checksum_failures
            or self.products_dropped
        )


def validate_and_repair(
    raw_product: dict, stats: RepairStats | None = None
) -> list[Product]:
    """Full chemical-specific validation pass for one extracted product dict.

    Returns a list because a bundle repair can turn one dict into several. When
    `stats` is provided, every repair is counted there AND logged. Behaviour of
    the underlying transforms is unchanged from the reference; the additions are
    purely the counting/logging around them.
    """
    name = raw_product.get("name_raw") or raw_product.get("name_en") or "<unnamed>"

    split = split_bundled_product(raw_product)
    if len(split) > 1:
        if stats is not None:
            stats.bundles_split += 1
            stats.products_added_by_split += len(split) - 1
        logger.info(
            "REPAIR bundle-split: %r -> %d products (%s)",
            name,
            len(split),
            ", ".join(p["name_raw"] for p in split),
        )

    repaired: list[Product] = []
    for candidate in split:
        cand_name = candidate.get("name_raw", "<unnamed>")

        # Stage 5a: auto-correct a formula-shaped grade code back into
        # details.grade. A code like "SM827" is formula-charset-valid (so it
        # passes the JSON-schema pattern) but is not made of real element
        # symbols, so `looks_like_valid_formula` rejects it.
        formula = candidate.get("formula")
        if formula and not looks_like_valid_formula(formula):
            details = candidate.setdefault("details", {})
            details["grade"] = details.get("grade", formula)
            candidate["formula"] = None
            if stats is not None:
                stats.formulas_demoted += 1
            logger.info(
                "REPAIR formula-demoted: %r had formula=%r (not a real formula) "
                "-> moved to details.grade, formula set null",
                cand_name,
                formula,
            )

        # Stage 5b: flag (don't silently drop) a CAS that fails the checksum —
        # usually an OCR/transcription slip worth a human glance.
        cas = candidate.get("cas_number")
        if cas and not is_valid_cas(cas):
            candidate.setdefault("details", {})["cas_checksum_failed"] = cas
            candidate["cas_number"] = None
            if stats is not None:
                stats.cas_checksum_failures += 1
            logger.info(
                "REPAIR cas-checksum-failed: %r had cas_number=%r (bad check "
                "digit) -> flagged details.cas_checksum_failed, cas set null",
                cand_name,
                cas,
            )

        # Stage 3 (re-run per candidate): Pydantic is the final gate. A record
        # that still can't validate after repair is dropped and reported rather
        # than crashing the whole brochure — one malformed product must not lose
        # the other 40 good ones.
        try:
            repaired.append(Product.model_validate(candidate))
        except Exception as exc:  # pydantic ValidationError and friends
            if stats is not None:
                stats.products_dropped += 1
                stats.drop_reasons.append(f"{cand_name}: {exc}")
            logger.warning(
                "DROP product %r — failed validation even after repair: %s",
                cand_name,
                exc,
            )

    return repaired


def validate_brochure(raw: dict) -> tuple[ChemicalBrochure, RepairStats]:
    """Validate a raw stage-2 JSON dict into a `ChemicalBrochure`.

    The company-level fields go through plain Pydantic (stage 3); every product
    goes through `validate_and_repair` (stages 4-5). Returns the validated
    brochure plus a `RepairStats` summarising what the guard layers did, and
    logs a one-line summary when anything was repaired.
    """
    stats = RepairStats()

    products_in = raw.get("products") or []
    validated: list[Product] = []
    for raw_product in products_in:
        if not isinstance(raw_product, dict):
            stats.products_dropped += 1
            stats.drop_reasons.append(f"non-object product entry: {raw_product!r}")
            logger.warning("DROP product — not an object: %r", raw_product)
            continue
        validated.extend(validate_and_repair(raw_product, stats))

    # Build the brochure from company fields + the repaired product list. The
    # company scalars still pass through Pydantic (stage 3) for type/shape.
    brochure = ChemicalBrochure(
        company_name=raw.get("company_name") or "",
        company_name_en=raw.get("company_name_en") or raw.get("company_name") or "",
        company_website=raw.get("company_website"),
        products=validated,
    )

    logger.info(
        "Brochure validated: %d raw product(s) -> %d final; "
        "bundles_split=%d (+%d products), formulas_demoted=%d, "
        "cas_checksum_failures=%d, dropped=%d",
        len(products_in),
        len(validated),
        stats.bundles_split,
        stats.products_added_by_split,
        stats.formulas_demoted,
        stats.cas_checksum_failures,
        stats.products_dropped,
    )
    return brochure, stats
