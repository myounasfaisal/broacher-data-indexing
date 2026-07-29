"""
Two-stage, per-page extraction for the DB-worker pipeline.

This is the `extract(image, context) -> PageExtraction` function the brief calls
for (IMPLEMENTATION_BRIEF.md §2/§3). It is deliberately self-contained and
testable independent of the worker loop, and it is the ONE place the extraction
model is chosen (config-driven, not a separate code path per model).

Pipeline, per page:
  1. Stage 1 — image -> markdown. The model transcribes the page (tables and
     all) faithfully. The `running_context` carried from earlier pages of the
     same document is injected so a table header printed once, pages back, is
     not lost.
  2. Stage 2 — markdown -> JSON via FORCED tool-calling (not a "return JSON"
     instruction). The tool schema matches the per-listing shape in §3, so
     malformed output is impossible by construction; we retry stage 2 up to a
     small cap and report the attempt count (a >1 attempt flags every listing
     from the page for review, per §6).

Only two providers are supported here — "qwen" (testing) and "claude"
(production). Both receive the same image and the same tool schema; switching is
a config change (settings.page_extract_provider), never a new call path. The
low-level clients and retry policy are reused from services.extraction so there
is exactly one client abstraction in the codebase.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, ValidationError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import eff_str, settings
from app.prompts.extraction_prompt import VLM_TRANSCRIPTION_PROMPT
from app.services import extraction  # reuse the Qwen/Claude clients + retry policy

logger = logging.getLogger(__name__)

# How many times stage 2 may be re-attempted before we give up on the page.
# A page that needs >1 attempt is a messy source page — every listing from it is
# flagged for review by the caller (§6), so this stays deliberately small.
_STAGE2_MAX_ATTEMPTS = 2


class PageExtractError(Exception):
    """Raised when a page could not be extracted into valid structured data.

    `fatal=True` means the cause won't fix itself on retry (bad/expired key,
    no credit, unknown model) — the worker stops the whole document instead
    of failing every remaining page the same way, one at a time."""

    def __init__(self, message: str, *, fatal: bool = False) -> None:
        super().__init__(message)
        self.fatal = fatal


# ── Output shape (matches IMPLEMENTATION_BRIEF.md §3) ────────────────────

class PageListing(BaseModel):
    """One product row transcribed from a single brochure page.

    `cas_number_raw` is the CAS EXACTLY as printed — normalization/checksum is
    deterministic application code downstream (§5), never the model's job.
    """

    name_raw: str
    name_en: str
    cas_number_raw: str | None = None
    price: float | None = None
    currency: str | None = None
    purity: str | None = None
    # Any other variable attributes as key/value pairs (packaging, grade,
    # storage, flash point, ...). Maps to listings.characteristics.
    characteristics: dict[str, Any] | None = None
    confidence: Literal["high", "low"] = "high"


class PageExtraction(BaseModel):
    """Result of extracting one page: the stage-1 markdown, the listings, the
    context to carry to the next page, and how many stage-2 attempts it took."""

    markdown: str
    listings: list[PageListing]
    next_context: dict[str, Any] | None = None
    stage2_attempts: int = 1


# ── Tool / function schema (forced tool-calling) ─────────────────────────
#
# The parameter schema is shared; only the envelope differs between the OpenAI
# (Qwen) and Anthropic (Claude) tool-calling formats.

_TOOL_NAME = "record_page_listings"
_TOOL_DESCRIPTION = (
    "Record every product listing transcribed from this brochure page, plus the "
    "table context to carry to the next page. Call this exactly once."
)
_TOOL_PARAMETERS: dict[str, Any] = {
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
                        "description": "Product name exactly as printed, in the source language/script.",
                    },
                    "name_en": {
                        "type": "string",
                        "description": "English translation of the product name.",
                    },
                    "cas_number_raw": {
                        "type": ["string", "null"],
                        "description": (
                            "CAS number EXACTLY as it appears on the page. Do NOT "
                            "reformat, correct, or infer missing digits. Null if none printed."
                        ),
                    },
                    "price": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "purity": {"type": ["string", "null"]},
                    "characteristics": {
                        "type": ["object", "null"],
                        "description": "Any other printed attributes as key/value pairs; omit if none.",
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
                "Table headers / current product family that a CONTINUATION table on "
                "the next page would need but may not reprint (e.g. "
                '{"table_headers": ["Grade", "CAS", "Purity"], "product_family": "VAE emulsion"}). '
                "Null if the page ends no open table."
            ),
        },
    },
    "required": ["listings"],
    "additionalProperties": False,
}

_STAGE2_SYSTEM = (
    "You convert a faithful markdown transcription of ONE chemical-brochure page "
    "into structured product listings by calling the record_page_listings tool.\n"
    "Rules:\n"
    "- Emit one listing per distinct product. If a single line bundles several "
    "products under a shared category (\"Silane: A171, A110, A170\"), split it "
    "into one listing each, carrying the category into every name.\n"
    "- If a table's header/family was printed on an earlier page (given to you as "
    "CONTINUATION CONTEXT), apply it to this page's rows.\n"
    "- Transcribe cas_number_raw EXACTLY as printed — never reformat or invent digits.\n"
    "- Never invent data. Only record what the transcription shows. Set confidence "
    "'low' when a value had to be inferred or the source was unclear."
)


# ── Stage 1: image -> markdown ───────────────────────────────────────────

def _running_context_hint(context: dict[str, Any] | None) -> str:
    """Render the carried running_context into a prompt suffix (empty if none)."""
    if not context:
        return ""
    try:
        blob = json.dumps(context, ensure_ascii=False)
    except (TypeError, ValueError):
        blob = str(context)
    return (
        "\n\nCONTINUATION CONTEXT (from earlier pages of THIS document): a table "
        "may continue onto this page without reprinting its header/family. If a "
        "table here has no header of its own, it belongs to: " + blob
    )


@retry(
    retry=retry_if_exception_type(Exception),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _stage1_qwen(image: bytes, context: dict[str, Any] | None) -> str:
    b64 = base64.standard_b64encode(image).decode("ascii")
    resp = extraction._get_qwen().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=4096,
        temperature=0,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": VLM_TRANSCRIPTION_PROMPT + _running_context_hint(context)},
            ],
        }],
    )
    return resp.choices[0].message.content or ""


@retry(
    retry=extraction._CLAUDE_RETRY_CONDITION,
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _stage1_claude(image: bytes, context: dict[str, Any] | None) -> str:
    b64 = base64.standard_b64encode(image).decode("ascii")
    msg = extraction._get_anthropic().messages.create(
        model=_claude_model(),
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": VLM_TRANSCRIPTION_PROMPT + _running_context_hint(context)},
            ],
        }],
    )
    return "".join(b.text for b in msg.content if b.type == "text")


# ── Stage 2: markdown -> JSON via forced tool-calling ────────────────────

# The exact JSON shape for the Qwen path (which has no tool schema to lean on).
_STAGE2_JSON_SHAPE = (
    "\n\nReturn ONLY a JSON object of this exact shape (no prose, no fences):\n"
    '{"listings": [{"name_raw": str, "name_en": str, "cas_number_raw": str|null, '
    '"price": number|null, "currency": str|null, "purity": str|null, '
    '"characteristics": object|null, "confidence": "high"|"low"}], '
    '"context_for_next_page": object|null}'
)


@retry(
    retry=retry_if_exception_type(Exception),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _stage2_qwen(markdown: str) -> dict[str, Any]:
    # Dashscope's OpenAI-compatible endpoint does not reliably honor a forced
    # function `tool_choice` (the vision-capable qwen models reject it), so the
    # Qwen (TEST) path uses response_format=json_object + Pydantic enforcement —
    # the same guaranteed-structured-output pattern the repo already uses for
    # GLM/GPT. The production path (Claude) uses genuine forced tool_use below.
    resp = extraction._get_qwen().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=8000,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _STAGE2_SYSTEM + _STAGE2_JSON_SHAPE},
            {"role": "user", "content": f"--- PAGE TRANSCRIPTION ---\n{markdown}\n--- END ---"},
        ],
    )
    raw = resp.choices[0].message.content or ""
    return extraction._parse_json(raw)  # tolerant parse (fences/trailing commas)


@retry(
    retry=extraction._CLAUDE_RETRY_CONDITION,
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _stage2_claude(markdown: str) -> dict[str, Any]:
    msg = extraction._get_anthropic().messages.create(
        model=_claude_model(),
        max_tokens=8000,
        system=_STAGE2_SYSTEM,
        tools=[{
            "name": _TOOL_NAME,
            "description": _TOOL_DESCRIPTION,
            "input_schema": _TOOL_PARAMETERS,
        }],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[{
            "role": "user",
            "content": f"--- PAGE TRANSCRIPTION ---\n{markdown}\n--- END ---",
        }],
    )
    for block in msg.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            return dict(block.input)
    raise PageExtractError("Claude stage 2 returned no tool_use block.")


def _claude_model() -> str:
    """Stage-2 Claude model: the page-extract override if set, else claude_model."""
    return eff_str("page_extract_claude_model") or eff_str("claude_model")


# ── Provider routing (the one config-driven switch) ──────────────────────

def _normalize_page_provider(raw: str | None) -> str:
    key = (raw or eff_str("page_extract_provider") or "qwen").strip().lower()
    if key in ("qwen", "dashscope"):
        return "qwen"
    if key in ("claude", "anthropic", "sonnet"):
        return "claude"
    raise PageExtractError(
        f"Unsupported page_extract_provider={raw!r}. Use 'qwen' or 'claude'."
    )


# ── Public entry point ───────────────────────────────────────────────────

def extract(
    image: bytes,
    context: dict[str, Any] | None = None,
    provider: str | None = None,
) -> PageExtraction:
    """
    Extract one page image into structured listings via the two-stage pipeline.

    `context` is the document's running_context carried from earlier pages (may
    be None on the first page). `provider` overrides the configured model
    (useful in tests); it defaults to settings.page_extract_provider.

    Returns a PageExtraction (markdown + validated listings + next_context +
    stage2_attempts). Raises PageExtractError if the page can't be transcribed
    or stage 2 never yields schema-valid listings.
    """
    chosen = _normalize_page_provider(provider)
    stage1 = _stage1_qwen if chosen == "qwen" else _stage1_claude
    stage2 = _stage2_qwen if chosen == "qwen" else _stage2_claude

    # Stage 1 — transcribe the page to markdown.
    try:
        markdown = stage1(image, context)
    except Exception as exc:
        message, fatal = extraction.friendly_provider_error(exc, "reading brochures")
        raise PageExtractError(message, fatal=fatal) from exc
    if not markdown.strip():
        # A blank page is legitimately empty — not an error, just no listings.
        return PageExtraction(markdown="", listings=[], next_context=context, stage2_attempts=0)

    # Stage 2 — structure it, retrying on schema-invalid output. A raw
    # provider exception (key/credit/model problem) is not worth retrying
    # here — it will fail the same way every time — so it's translated and
    # raised immediately rather than burning through _STAGE2_MAX_ATTEMPTS.
    last_err: Exception | None = None
    for attempt in range(1, _STAGE2_MAX_ATTEMPTS + 1):
        try:
            raw = stage2(markdown)
            listings = [PageListing.model_validate(x) for x in (raw.get("listings") or [])]
            next_ctx = raw.get("context_for_next_page")
            if not isinstance(next_ctx, dict):
                next_ctx = None
            return PageExtraction(
                markdown=markdown,
                listings=listings,
                next_context=next_ctx,
                stage2_attempts=attempt,
            )
        except (ValidationError, json.JSONDecodeError, PageExtractError) as exc:
            last_err = exc
            logger.warning("Stage 2 attempt %d/%d failed: %s", attempt, _STAGE2_MAX_ATTEMPTS, exc)
        except Exception as exc:
            message, fatal = extraction.friendly_provider_error(exc, "reading brochures")
            raise PageExtractError(message, fatal=fatal) from exc

    raise PageExtractError(
        f"Stage 2 (structuring) failed after {_STAGE2_MAX_ATTEMPTS} attempts: {last_err}"
    )
