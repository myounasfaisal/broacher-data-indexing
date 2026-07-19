"""
Stage 2 — Qwen3 8B: transcription -> schema-constrained structured JSON.

The model receives the stage-1 markdown transcription and the EXTRACTION_PROMPT
and must emit a `ChemicalBrochure`-shaped JSON object. Output *syntax* and
*shape* are enforced by constrained decoding against
`ChemicalBrochure.model_json_schema()`, so the prompt carries only the semantic
judgment calls decoding can't make ("one product or four bundled?", "formula or
grade code?").

--------------------------------------------------------------------------
OPEN QUESTION RESOLVED — which constrained-decoding mechanism?
--------------------------------------------------------------------------
The project already serves Qwen exclusively through the *OpenAI-compatible*
client (`openai.OpenAI` pointed at `QWEN_API_BASE`) — Dashscope in the deployed
`.env`, but the same code targets a local vLLM/Ollama server. There is no vLLM
Python SDK, `outlines`, or `lm-format-enforcer` already in `requirements.txt`,
so introducing one purely for guidance would be a new dependency for no gain:
every OpenAI-compatible *server* exposes guided decoding through the request
body instead. We therefore drive it through the existing client, choosing the
mechanism by `settings.pipeline_guided_decoding`:

  * "guided_json"  (default) — vLLM's native guided decoding:
        extra_body={"guided_json": <schema>}
    True token-level constraint; the model can ONLY emit schema-valid JSON.
    Use this whenever the pipeline is served by vLLM (the intended stack).
  * "json_schema" — OpenAI structured outputs:
        response_format={"type":"json_schema","json_schema":{...}}
    For OpenAI / gateways that implement structured outputs.
  * "json_object" — loosest fallback:
        response_format={"type":"json_object"}
    Guarantees valid JSON syntax but not the schema; Dashscope's public
    OpenAI-compatible endpoint supports this but NOT guided_json, so this is
    the safe default there. The schema is still enforced immediately after by
    Pydantic (stage 3), so the guarantee is only weakened, never lost.
  * "none" — send nothing special (last-resort compatibility).

KNOWN LIMITATION worth flagging: the `details` field is an open-ended
`dict[str, Any]` (arbitrary snake_case keys per brochure). Strict grammar-based
guided decoding handles unbounded-key objects poorly, so we relax that subtree
(`additionalProperties: true`, no required key list) before sending the schema —
otherwise a vLLM grammar can either forbid `details` content or loop. Pydantic
still accepts any dict there in stage 3, so nothing is lost.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from openai import OpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.pipeline.schema import ChemicalBrochure
from app.prompts.extraction_prompt import EXTRACTION_PROMPT

logger = logging.getLogger(__name__)

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    """Text-extraction client. Same OpenAI-compatible base/key as the VLM/OCR
    calls — Qwen3 8B is served alongside the VLM on the same endpoint."""
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_api_base,
        )
    return _client


class Stage2Error(Exception):
    """Raised when stage 2 cannot produce parseable JSON from the model."""


def _relax_details_subtree(schema: dict) -> dict:
    """Return a copy of the schema with the `details` object opened up.

    See the module docstring's KNOWN LIMITATION: grammar-based guided decoding
    struggles with the free-form `details` dict. We set it to a permissive open
    object so guidance constrains the *structured* fields (names, formula, cas,
    price…) while leaving `details` unconstrained. Pydantic re-accepts any dict
    in stage 3, so correctness is unaffected.
    """
    relaxed = copy.deepcopy(schema)
    for defs_key in ("$defs", "definitions"):
        product_def = relaxed.get(defs_key, {}).get("Product")
        if product_def and "details" in product_def.get("properties", {}):
            product_def["properties"]["details"] = {"type": "object"}
    return relaxed


def _guided_kwargs(schema: dict) -> dict[str, Any]:
    """Build the create() kwargs that carry the schema to the serving stack,
    per `settings.pipeline_guided_decoding`."""
    mode = (settings.pipeline_guided_decoding or "json_object").lower()
    if mode == "guided_json":
        # vLLM reads guidance from extra_body; unknown keys are ignored by
        # servers that don't implement it (they just skip guidance).
        return {"extra_body": {"guided_json": schema}}
    if mode == "json_schema":
        return {
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "ChemicalBrochure",
                    "schema": schema,
                    "strict": True,
                },
            }
        }
    if mode == "json_object":
        return {"response_format": {"type": "json_object"}}
    return {}  # "none"


@retry(
    retry=retry_if_exception_type(Exception),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_extraction(markdown: str, schema: dict) -> str:
    """Single guided-decoding call. Returns the raw model string (JSON)."""
    user_content = (
        f"{EXTRACTION_PROMPT}\n\n"
        "--- BROCHURE TRANSCRIPTION (markdown) ---\n"
        f"{markdown}\n"
        "--- END TRANSCRIPTION ---"
    )
    response = _get_client().chat.completions.create(
        model=settings.qwen_text_model,
        max_tokens=settings.pipeline_max_tokens,
        temperature=0,
        messages=[{"role": "user", "content": user_content}],
        **_guided_kwargs(schema),
    )
    return response.choices[0].message.content or ""


def _parse_json(raw: str) -> dict:
    """Parse the model output into a dict.

    Guided decoding should return clean JSON, but under the looser
    ("json_object"/"none") modes the model can still wrap it in ```json fences
    or stray prose — so we fall back to extracting the outermost {...} span,
    matching the production extractor's tolerance.
    """
    text = raw.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


def extract_structured(markdown: str) -> dict:
    """Stage 2 entry point: markdown transcription -> raw JSON dict.

    The returned dict is intentionally the *raw* model output (already
    JSON-parsed) — it has NOT yet been through Pydantic or the chemical
    repairs. That is stages 3-5's job (`pipeline.validation.validate_brochure`),
    kept separate so the guided-decoding guarantee and the repair guarantees are
    layered, not entangled.
    """
    if not markdown.strip():
        raise Stage2Error("Empty transcription — nothing to extract.")

    schema = _relax_details_subtree(ChemicalBrochure.model_json_schema())
    logger.info(
        "Stage 2 (structured extraction): model=%s guided=%s",
        settings.qwen_text_model,
        settings.pipeline_guided_decoding,
    )
    try:
        raw = _call_extraction(markdown, schema)
    except Exception as exc:
        raise Stage2Error(f"Extraction model call failed after retries: {exc}") from exc

    try:
        return _parse_json(raw)
    except json.JSONDecodeError as exc:
        logger.warning("Stage 2 returned non-JSON output: %s", raw[:500])
        raise Stage2Error("Model did not return valid JSON.") from exc
