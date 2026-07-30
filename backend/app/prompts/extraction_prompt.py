"""
Brochure-extraction prompts and the stage-2 tool schema.

This module is the single home for every prompt and schema the extraction
pipeline sends to a model. All rule TEXT comes from `app.prompts._rules`, which
holds each rule exactly once; this file only composes those blocks into the
concrete prompts each call site needs, and defines the tool schema.

    ┌─ STAGE 1 ────────────────────────────────────────────────────────────┐
    │ page image ── VLM_TRANSCRIPTION_PROMPT ──> faithful markdown          │
    └──────────────────────────────────────────────────────────────────────┘
    ┌─ STAGE 2 ────────────────────────────────────────────────────────────┐
    │ markdown ── STAGE2_SYSTEM + TOOL_* (forced tool-use) ──> listings     │
    │             STAGE2_SYSTEM + STAGE2_JSON_SHAPE  ──> listings (Qwen)    │
    └──────────────────────────────────────────────────────────────────────┘

Output SHAPE is guaranteed structurally, not by prompt text:
  * Claude  — forced tool-use against TOOL_PARAMETERS, so malformed output is
              impossible by construction.
  * Qwen    — response_format=json_object plus STAGE2_JSON_SHAPE, since
              DashScope does not reliably honour a forced tool_choice.
Both are re-validated by Pydantic downstream. That is why these prompts spend
their words on the JUDGMENT calls a schema cannot enforce — "is this one product
or four?", "is this a formula or a grade code?", "does this row inherit the
family name printed above it?" — rather than on JSON formatting boilerplate.

`EXTRACTION_PROMPT` serves the older whole-document path
(services/extraction.py, pipeline/extraction.py). The worker does NOT call it;
it is kept composing from the same shared rule blocks as STAGE2_SYSTEM so the
two can never drift apart again, which is precisely the bug that motivated this
module (see app/prompts/_rules.py).
"""

from __future__ import annotations

from typing import Any

from app.prompts import _rules

# ---------------------------------------------------------------------------
# STAGE 1 — page image -> faithful structured transcription
# ---------------------------------------------------------------------------
# This stage's ONLY job is lossless transcription that preserves the visual
# structure carrying meaning: which bullets sit under which category header,
# which cells belong to which row, and — critically — which grade rows sit
# under which merged full-width family label. When that structure is flattened
# here, stage 2 cannot recover it, and every downstream "the model reasoned
# badly" symptom traces back to this step.

VLM_TRANSCRIPTION_PROMPT = _rules.compose(
    "You are transcribing one page of a chemical supplier brochure. Produce a "
    "faithful, structure-preserving transcription of everything printed on the "
    "page. Do not summarize, translate, omit, reorder, or interpret.",
    _rules.STAGE1_BLOCKS[0],  # TRANSCRIPTION_FIDELITY
    _rules.STAGE1_BLOCKS[1],  # TABLE_FIDELITY
) + "\n"


# ---------------------------------------------------------------------------
# STAGE 2 — transcription -> structured listings
# ---------------------------------------------------------------------------

_STAGE2_INTRO = (
    "You convert a faithful markdown transcription of ONE chemical-brochure "
    "page into structured product listings by calling the record_page_listings "
    "tool exactly once.\n\n"
    "Work through the steps below in order. Steps 1 and 2 decide whether a row "
    "is a product and what its real identity is; those two decisions determine "
    "whether the catalog is searchable at all, so give them the most care."
)

#: System prompt for the per-page stage-2 call (the live worker path).
STAGE2_SYSTEM = _rules.compose(_STAGE2_INTRO, *_rules.STAGE2_BLOCKS)


# ---------------------------------------------------------------------------
# Tool / function schema (forced tool-calling)
# ---------------------------------------------------------------------------
# The parameter schema is shared; only the envelope differs between the
# Anthropic (Claude) and OpenAI-compatible (Qwen) tool-calling formats. Field
# descriptions here are load-bearing prompt text, which is why the schema lives
# beside the prompts rather than in the service module.

TOOL_NAME = "record_page_listings"

TOOL_DESCRIPTION = (
    "Record every product listing transcribed from this brochure page, plus the "
    "table context to carry to the next page. Call this exactly once."
)

TOOL_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "listings": {
            "type": "array",
            "description": "One entry per product offered on the page.",
            "items": {
                "type": "object",
                "properties": {
                    "name_raw": {
                        "type": "string",
                        "description": (
                            "Product name exactly as printed, in the source "
                            "language/script, INCLUDING any family/category label "
                            "inherited from a heading or merged row above it."
                        ),
                    },
                    "name_en": {
                        "type": "string",
                        "description": (
                            "English translation of the product name, including the "
                            "inherited family/category label."
                        ),
                    },
                    "product_family": {
                        "type": ["string", "null"],
                        "description": (
                            "The category / family / section label this product "
                            "inherits from a heading, merged full-width table row, or "
                            "continuation context — recorded on its own so it stays "
                            "queryable independently of the name. Use the FULL label "
                            "text exactly as printed; never an abbreviation you "
                            "invent. Null only when the product genuinely has no "
                            "such label above it."
                        ),
                    },
                    "cas_number_raw": {
                        "type": ["string", "null"],
                        "description": (
                            "CAS number EXACTLY as it appears on the page. Do NOT "
                            "reformat, correct, or infer missing digits. Null if none "
                            "printed."
                        ),
                    },
                    "price": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "purity": {
                        "type": ["string", "null"],
                        "description": (
                            "Purity / content / assay / concentration exactly as "
                            "printed, including any leading >= or <=, even when it "
                            "was embedded in the product name."
                        ),
                    },
                    "characteristics": {
                        "type": ["object", "null"],
                        "description": (
                            "Every OTHER printed attribute as short snake_case "
                            "key/value pairs (grade, viscosity_cp, "
                            "solid_content_wt_pct, ph, tg_c, mfft_c, "
                            "stabilization_system, application, packaging, storage, "
                            "special_feature, and any non-English form of the family "
                            "label). Omit if none."
                        ),
                    },
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "low"],
                        "description": (
                            "'low' if the source was blurry, the table structure "
                            "ambiguous, or any field had to be inferred rather than read."
                        ),
                    },
                },
                "required": ["name_raw", "name_en", "confidence"],
                "additionalProperties": False,
            },
        },
        "context_for_next_page": {
            "type": ["object", "null"],
            "description": (
                "Context a CONTINUATION table on the next page would need but may "
                "not reprint: the currently-open family/category label and the "
                "column headers. Example: "
                '{"table_headers": ["Grade", "CAS", "Purity"], '
                '"product_family": "Vinyl acetate-ethylene (VAE) emulsion"}. '
                "Null only if the page ends no open table or section."
            ),
        },
    },
    "required": ["listings"],
    "additionalProperties": False,
}

#: Qwen's DashScope endpoint does not reliably honour a forced function
#: `tool_choice`, so that path uses response_format=json_object plus this
#: explicit shape, then Pydantic enforcement. Kept in sync with
#: TOOL_PARAMETERS by hand — update both together.
STAGE2_JSON_SHAPE = (
    "\n\nReturn ONLY a JSON object of this exact shape (no prose, no fences):\n"
    '{"listings": [{"name_raw": str, "name_en": str, '
    '"product_family": str|null, "cas_number_raw": str|null, '
    '"price": number|null, "currency": str|null, "purity": str|null, '
    '"characteristics": object|null, "confidence": "high"|"low"}], '
    '"context_for_next_page": object|null}'
)


# ---------------------------------------------------------------------------
# Whole-document path (legacy) — transcription -> supplier + products JSON
# ---------------------------------------------------------------------------
# Not called by the worker. Retained for services/extraction.py and
# pipeline/extraction.py, composed from the SAME rule blocks as STAGE2_SYSTEM
# so a rule fix cannot land on one path and miss the other.

_DOC_INTRO = (
    "You are a data-extraction engine for chemical supplier brochures. You will "
    "receive a structured transcription of a brochure page. It may be in any "
    "language — do not assume a source language, but always translate names into "
    "English for the *_en fields.\n\n"
    "Extract the supplier's identity and every chemical product described."
)

_DOC_OUTPUT_SHAPE = """\
OUTPUT SHAPE — return ONE JSON object with EXACTLY these top-level keys (do not
rename them, do not invent alternatives like "supplier" or "manufacturer"):
{
  "company_name": <supplier name exactly as printed, original script, or null>,
  "company_name_en": <English supplier name, or null>,
  "company_website": <website URL if printed, else null>,
  "company_email": <contact email if printed, else null>,
  "company_phone": <contact phone/tel number exactly as printed, else null>,
  "products": [
    {
      "name_raw": <product name exactly as printed, including any inherited family label>,
      "name_en": <English product name, including any inherited family label>,
      "product_family": <the inherited category/family label on its own, else null>,
      "cas_number": <CAS number if printed, else null>,
      "price": <number if printed, else null>,
      "currency": <ISO code or symbol if printed, else null>,
      "purity": <e.g. "60%" if printed, else null>,
      "details": { <short snake_case keys for every OTHER printed attribute> }
    }
  ]
}
Rules for the shape:
- The supplier key is ALWAYS "company_name" (never "supplier"/"company"). If
  this page shows the supplier (cover, letterhead, or contact/footer), fill it;
  otherwise set company_name to null — do NOT omit the key.
- Output raw JSON only: no markdown code fences, no comments, no trailing
  commas, and escape every quote/newline inside string values so the result
  parses. If a page has no products, return "products": [].
"""

EXTRACTION_PROMPT = _rules.compose(
    _DOC_INTRO,
    _DOC_OUTPUT_SHAPE,
    "Focus on getting the CONTENT right, especially the judgment calls below, "
    "which nothing else in this pipeline can make for you.",
    *_rules.STAGE2_BLOCKS,
) + "\n"
