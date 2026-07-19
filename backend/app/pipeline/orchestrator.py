r"""
Chemical-brochure extraction pipeline — end-to-end orchestration.

===========================================================================
THE FIVE STAGES  (and which layer guards which failure mode)
===========================================================================

    brochure file (PDF / image)
        │
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ STAGE 1  Qwen VLM transcription            pipeline/vlm.py            │
  │   Each page image → faithful structured markdown (headers, bullets,   │
  │   tables preserved). GUARDS: keeps the "Silane: A171, A110, …" line   │
  │   intact and page-region context, so later stages can split/anchor.   │
  └──────────────────────────────────────────────────────────────────────┘
        │  merged markdown (one document, one company)
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ STAGE 2  Qwen3 8B structured extraction    pipeline/extraction.py     │
  │   markdown → JSON, constrained-decoded against                        │
  │   ChemicalBrochure.model_json_schema(). GUARDS (prompt judgment):     │
  │   splitting bundles, formula-vs-grade, context-anchor (footer/cert    │
  │   noise excluded), purity-in-parentheses.                             │
  └──────────────────────────────────────────────────────────────────────┘
        │  raw JSON dict
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ STAGE 3  Pydantic validation               pipeline/schema.py         │
  │   ChemicalBrochure / Product model_validate. GUARDS: types, required  │
  │   fields, regex patterns (CAS shape, formula charset, currency).      │
  └──────────────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ STAGE 4  Bundle splitting (safety net)     pipeline/schema.py +       │
  │   split_bundled_product — if an unsplit "Category: a, b, c" name      │
  │   slipped past stage 2, split it mechanically. GUARDS: bundled grade  │
  │   lists; deliberately leaves real comma names ("1,2-Dichloroethane"). │
  └──────────────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ STAGE 5  Chemical-specific validation      pipeline/validation.py     │
  │   looks_like_valid_formula → demote catalog codes (SM827, A171) out   │
  │   of `formula`; is_valid_cas → flag checksum failures, null the CAS.  │
  │   Every repair is logged + counted (RepairStats) as an accuracy       │
  │   signal, never silently applied.                                     │
  └──────────────────────────────────────────────────────────────────────┘
        │
        ▼
    validated ChemicalBrochure  (+ RepairStats)

Stages 4 & 5 are orchestrated per-product by `validation.validate_and_repair`;
`validation.validate_brochure` runs stage 3 around them and assembles the
company-level object.

RELATIONSHIP TO THE PRODUCTION UPLOAD PATH: the live app
(`services/jobs.py` → `services/extraction.py` → DB) is a separate, single-shot
multi-provider extractor whose persisted schema
(`schemas.chemical.ExtractedProduct`) has no `formula` column. This package is
the reference-faithful two-model pipeline with the richer `Product` shape; it is
intentionally decoupled so building it can't destabilise the running app. To
feed it into the DB path, map `Product.model_dump()` onto the insert dict in
jobs.py (dropping/relocating `formula`). See README note at the bottom.

USAGE (CLI):
    python -m app.pipeline path/to/brochure.pdf [--out out.json]
    python -m app.pipeline page1.png page2.png --out out.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from app.pipeline import extraction, vlm
from app.pipeline.schema import ChemicalBrochure
from app.pipeline.validation import RepairStats, validate_brochure

logger = logging.getLogger(__name__)

# File extensions we treat as already-rendered page images (skip PDF render).
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


class PipelineError(Exception):
    """Raised when the pipeline cannot produce a validated brochure."""


def run_pipeline_from_markdown(
    markdown: str,
) -> tuple[ChemicalBrochure, RepairStats]:
    """Stages 2-5 only, from an already-transcribed markdown document.

    Exposed separately so tests (and re-processing flows) can drive the
    deterministic guard layers without a live VLM call.
    """
    raw = extraction.extract_structured(markdown)  # stage 2
    return validate_brochure(raw)                   # stages 3-5


def run_pipeline_from_images(
    page_images: list[bytes],
) -> tuple[ChemicalBrochure, RepairStats]:
    """Full pipeline from a list of page-image PNG/JPEG bytes."""
    markdown = vlm.transcribe_pages(page_images)     # stage 1
    if not markdown.strip():
        raise PipelineError("Stage 1 produced no transcription from the images.")
    return run_pipeline_from_markdown(markdown)


def run_pipeline(source: str | Path | bytes) -> tuple[ChemicalBrochure, RepairStats]:
    """Full 5-stage pipeline from a brochure file path or raw PDF bytes.

    - A `.pdf` path (or raw PDF bytes) is rendered to page images then
      transcribed page-by-page (stage 1 per page, merged before stage 2).
    - An image path is transcribed directly.
    Returns the validated `ChemicalBrochure` and the `RepairStats` describing
    what the guard layers repaired.
    """
    if isinstance(source, bytes):
        markdown = vlm.transcribe_pdf(source)
        if not markdown.strip():
            raise PipelineError("Stage 1 produced no transcription from the PDF.")
        return run_pipeline_from_markdown(markdown)

    path = Path(source)
    if not path.exists():
        raise PipelineError(f"Brochure file not found: {path}")

    if path.suffix.lower() in _IMAGE_EXTS:
        return run_pipeline_from_images([path.read_bytes()])
    # Default: treat as a PDF.
    markdown = vlm.transcribe_pdf(path.read_bytes())
    if not markdown.strip():
        raise PipelineError(f"Stage 1 produced no transcription from {path}.")
    return run_pipeline_from_markdown(markdown)


# ── CLI ──────────────────────────────────────────────────────────────────

def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m app.pipeline",
        description="Run the 5-stage chemical-brochure extraction pipeline.",
    )
    p.add_argument(
        "inputs",
        nargs="+",
        help="One PDF path, or one or more page-image paths.",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Write the validated JSON here (default: stdout).",
    )
    p.add_argument(
        "-v", "--verbose", action="store_true", help="Log every stage/repair."
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    paths = [Path(p) for p in args.inputs]
    try:
        if len(paths) == 1 and paths[0].suffix.lower() not in _IMAGE_EXTS:
            brochure, stats = run_pipeline(paths[0])           # single PDF
        else:
            images = [p.read_bytes() for p in paths]           # image page(s)
            brochure, stats = run_pipeline_from_images(images)
    except (PipelineError, extraction.Stage2Error) as exc:
        print(f"Pipeline failed: {exc}", file=sys.stderr)
        return 1

    payload = brochure.model_dump()
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(
            f"Wrote {len(brochure.products)} product(s) to {args.out} "
            f"(repairs: bundles_split={stats.bundles_split}, "
            f"formulas_demoted={stats.formulas_demoted}, "
            f"cas_checksum_failures={stats.cas_checksum_failures}, "
            f"dropped={stats.products_dropped})",
            file=sys.stderr,
        )
    else:
        print(text)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
