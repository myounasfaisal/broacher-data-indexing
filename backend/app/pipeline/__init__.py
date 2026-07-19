"""
Chemical-brochure extraction pipeline (reference-faithful, 5-stage):

    Qwen VLM → Qwen3 8B → JSON-schema constrained decoding
             → Pydantic validation → chemical-specific validation

See ``orchestrator.py`` for the stage-by-stage map of which layer guards which
failure mode, and for the public entry points.
"""

from app.pipeline.orchestrator import (
    PipelineError,
    run_pipeline,
    run_pipeline_from_images,
    run_pipeline_from_markdown,
)
from app.pipeline.schema import (
    ChemicalBrochure,
    Product,
    is_valid_cas,
    looks_like_valid_formula,
    split_bundled_product,
)
from app.pipeline.validation import RepairStats, validate_and_repair, validate_brochure

__all__ = [
    "ChemicalBrochure",
    "Product",
    "PipelineError",
    "RepairStats",
    "is_valid_cas",
    "looks_like_valid_formula",
    "split_bundled_product",
    "validate_and_repair",
    "validate_brochure",
    "run_pipeline",
    "run_pipeline_from_images",
    "run_pipeline_from_markdown",
]
