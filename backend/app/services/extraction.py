"""
Multi-provider brochure extraction (GPT / Qwen / Gemini / Claude) with Qwen OCR.

Pipeline:
  1. Detect whether the PDF is scanned (image-only) via pdf_utils.
  2. If scanned → run Qwen vision OCR to extract page text first.
  3. Send the PDF (or OCR text / page images) to the configured extraction
     provider with the structured extraction prompt.
  4. Parse + validate the JSON result against the pydantic schema.

Provider selection is controlled by EXTRACTION_PROVIDER in the .env
("gpt", "qwen", "gemini", or "claude"). With "gpt", **Qwen OCRs the brochure
page images and GPT (OpenAI) turns that text into the structured JSON** — every
PDF (scanned or text-based) goes image → Qwen OCR → text → GPT. The prompt text
lives in app/prompts/extraction_prompt.py so it can be tuned without touching
this logic.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
import httpx
from google import genai
from google.genai import types as genai_types
from openai import OpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import eff_int, eff_str, settings
from app.prompts.extraction_prompt import EXTRACTION_PROMPT
from app.schemas.chemical import ExtractionResult
from app.services import enrich, llm_clients, ocr, pdf_utils

logger = logging.getLogger(__name__)


# ── Clients ───────────────────────────────────────────────────────────
#
# Construction lives in llm_clients, which reads keys at call time and rebuilds
# when they change — so a key saved on the Settings page applies to the next
# extraction without a restart.

_get_anthropic = llm_clients.anthropic_client
_get_gemini = llm_clients.gemini_client
_get_qwen = llm_clients.qwen_client
_get_openai = llm_clients.openai_client
_get_openrouter = llm_clients.openrouter_client


class ExtractionError(Exception):
    """Raised when a brochure could not be extracted into valid structured data."""


# Accept common spellings of each provider so a stray "chatgpt"/"openai" in the
# .env doesn't silently fall through to the wrong branch. (Root cause of a real
# failure: EXTRACTION_PROVIDER=chatgpt matched no branch and defaulted to the
# Gemini path, which then failed on an empty Gemini key.)
_PROVIDER_ALIASES = {
    "gpt": "gpt", "chatgpt": "gpt", "openai": "gpt", "gpt-4o": "gpt",
    "gpt-4o-mini": "gpt",
    "qwen": "qwen", "dashscope": "qwen",
    "gemini": "gemini", "google": "gemini",
    "claude": "claude", "anthropic": "claude",
    "nuextract": "nuextract", "numind": "nuextract",
    "glm": "glm", "openrouter": "glm", "glm-4.6": "glm", "glm4.6": "glm",
    "zai": "glm", "z-ai": "glm",
}


def _normalize_provider(raw: str) -> str:
    """Canonicalise the configured provider name; fail loudly on an unknown one
    rather than silently picking a default provider whose key may be empty."""
    key = (raw or "").strip().lower()
    if key not in _PROVIDER_ALIASES:
        raise ExtractionError(
            f"Unknown EXTRACTION_PROVIDER={raw!r}. Set it to one of: "
            "gpt, qwen, gemini, claude, nuextract."
        )
    return _PROVIDER_ALIASES[key]


# ── Claude provider ───────────────────────────────────────────────────

# Transient Anthropic errors worth retrying (rate limits, 5xx, connection drops).
_CLAUDE_RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.APIStatusError,
    anthropic.APIConnectionError,
)


@retry(
    retry=retry_if_exception_type(_CLAUDE_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_claude_pdf(pdf_b64: str) -> str:
    """Send a native PDF to Claude as a document block and return raw text."""
    message = _get_anthropic().messages.create(
        model=eff_str("claude_model"),
        max_tokens=8000,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text")


@retry(
    retry=retry_if_exception_type(_CLAUDE_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_claude_text(text: str) -> str:
    """Send OCR-extracted text to Claude for structured extraction."""
    preamble = (
        "The following text was extracted via OCR from a scanned brochure PDF. "
        "Treat it as the brochure content and extract structured data.\n\n"
        f"--- OCR TEXT ---\n{text}\n--- END OCR TEXT ---\n\n"
    )
    message = _get_anthropic().messages.create(
        model=eff_str("claude_model"),
        max_tokens=8000,
        messages=[
            {
                "role": "user",
                "content": preamble + EXTRACTION_PROMPT,
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text")


# ── Gemini provider ──────────────────────────────────────────────────

# Broad retry for Gemini — the SDK raises various Exception subclasses.
_GEMINI_RETRYABLE = (Exception,)


@retry(
    retry=retry_if_exception_type(_GEMINI_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_gemini_pdf(pdf_bytes: bytes) -> str:
    """Send a native PDF to Gemini as inline data and return raw text."""
    response = _get_gemini().models.generate_content(
        model=eff_str("gemini_model"),
        contents=[
            genai_types.Content(
                parts=[
                    genai_types.Part.from_bytes(
                        data=pdf_bytes,
                        mime_type="application/pdf",
                    ),
                    genai_types.Part.from_text(text=EXTRACTION_PROMPT),
                ]
            )
        ],
        config=genai_types.GenerateContentConfig(
            max_output_tokens=8000,
        ),
    )
    return response.text or ""


@retry(
    retry=retry_if_exception_type(_GEMINI_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_gemini_text(text: str) -> str:
    """Send OCR-extracted text to Gemini for structured extraction."""
    preamble = (
        "The following text was extracted via OCR from a scanned brochure PDF. "
        "Treat it as the brochure content and extract structured data.\n\n"
        f"--- OCR TEXT ---\n{text}\n--- END OCR TEXT ---\n\n"
    )
    response = _get_gemini().models.generate_content(
        model=eff_str("gemini_model"),
        contents=[preamble + EXTRACTION_PROMPT],
        config=genai_types.GenerateContentConfig(
            max_output_tokens=8000,
        ),
    )
    return response.text or ""


# ── Qwen provider (OpenAI-compatible) ────────────────────────────────

_QWEN_RETRYABLE = (Exception,)


@retry(
    retry=retry_if_exception_type(_QWEN_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_qwen_images(page_images: list[bytes], extra_context: str = "") -> str:
    """
    Send page images to Qwen vision model with the extraction prompt.

    The OpenAI-compatible API doesn't accept native PDFs, so text-based PDFs
    are also rendered to page images before calling this. Each page image is
    included as an image_url content block. `extra_context` (e.g. the
    cross-page family carry-forward hint) is appended to the prompt.
    """
    content: list[dict] = []
    for png_bytes in page_images:
        b64 = base64.standard_b64encode(png_bytes).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"},
        })
    content.append({"type": "text", "text": EXTRACTION_PROMPT + extra_context})

    response = _get_qwen().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=8000,
        temperature=0,  # deterministic per-page extraction
        messages=[{"role": "user", "content": content}],
    )
    return response.choices[0].message.content or ""


@retry(
    retry=retry_if_exception_type(_QWEN_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_qwen_text(text: str) -> str:
    """Send OCR-extracted text to Qwen for structured extraction."""
    preamble = (
        "The following text was extracted via OCR from a scanned brochure PDF. "
        "Treat it as the brochure content and extract structured data.\n\n"
        f"--- OCR TEXT ---\n{text}\n--- END OCR TEXT ---\n\n"
    )
    response = _get_qwen().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=8000,
        messages=[{"role": "user", "content": preamble + EXTRACTION_PROMPT}],
    )
    return response.choices[0].message.content or ""


# ── GPT provider (OpenAI) ────────────────────────────────────────────
#
# GPT is the structured-JSON extractor. It NEVER does OCR or vision here: Qwen
# reads the brochure page images (OCR) and GPT turns that text into strict
# JSON. response_format=json_object forces valid JSON (the extraction prompt
# already asks for JSON).

_GPT_RETRYABLE = (Exception,)  # the openai SDK raises various error types


@retry(
    retry=retry_if_exception_type(_GPT_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_gpt_text(text: str, extra_context: str = "") -> str:
    """Send Qwen-OCR'd brochure text to GPT for structured extraction (JSON text)."""
    preamble = (
        "The following text was extracted via OCR from a brochure PDF. "
        "Treat it as the brochure content and extract structured data.\n\n"
        f"--- OCR TEXT ---\n{text}\n--- END OCR TEXT ---\n\n"
    )
    response = _get_openai().chat.completions.create(
        model=eff_str("openai_model"),
        max_tokens=8000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": preamble + EXTRACTION_PROMPT + extra_context}],
    )
    return response.choices[0].message.content or ""


# ── GLM-4.6V provider (OpenRouter, single-model VISION, whole-document) ─
#
# GLM-4.6V is multimodal with a 131k context and 32k output window, so unlike
# the per-page qwen/gpt paths it ingests EVERY page image at once and emits the
# whole product list in a single call — one model does the reading AND the
# structuring (no separate OCR). Seeing every page together makes bundle
# splitting and cross-page table inheritance reliable, and it's one request.

_GLM_RETRYABLE = (Exception,)


@retry(
    retry=retry_if_exception_type(_GLM_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _call_glm_page(png_bytes: bytes, extra_context: str = "") -> str:
    """Send ONE brochure page image to GLM-4.6V and get that page's product JSON.

    Per-page (not whole-document): a single call over all 13 images is far too
    slow (~25 MB payload, >400 s) and risks output truncation. Per-page keeps
    each call small and lets the pages run concurrently (see _extract_pages),
    which is both fast and truncation-proof."""
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    response = _get_openrouter().chat.completions.create(
        model=eff_str("openrouter_model"),
        max_tokens=8000,
        temperature=0,  # deterministic: same page → same products, run to run
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": EXTRACTION_PROMPT + extra_context},
        ]}],
    )
    return response.choices[0].message.content or ""


def _glm_page_call(img: bytes, hint: str) -> str:
    return _call_glm_page(img, extra_context=hint)


@retry(
    retry=retry_if_exception_type(_GLM_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _complete_glm(prompt: str, max_tokens: int) -> str:
    response = _get_openrouter().chat.completions.create(
        model=eff_str("openrouter_model"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


# ── NuExtract provider (NuMind hosted, async structured-extraction) ──
#
# Best combo for brochures: Qwen OCRs the pages to text (strong multilingual
# OCR), then that text is sent to a pre-configured NuExtract "structured
# extraction" PROJECT whose template defines the output schema. NuExtract is
# purpose-built for extraction (low hallucination), which fits the "capture
# everything, invent nothing" goal well.
#
# The cloud API is ASYNC: POST creates a job, then we poll a GET until it's
# done. NOTE: the exact request body / auth header / result field are assumed
# here from the endpoint list and MUST be confirmed against the NuExtract API
# docs (marked TODO below) before this path is trusted.

_NUEXTRACT_POLL_INTERVAL = 2.0  # seconds between result polls
_NUEXTRACT_MAX_POLLS = 60  # ~2 min ceiling


def _call_nuextract_text(text: str) -> str:
    """
    Create a NuExtract structured-extraction job from `text` and return the
    extracted JSON. Per the NuExtract Platform OpenAPI spec:
      POST /api/structured-extraction/{projectId}/jobs/text  {"text": ...}
                                                            -> {"jobId": ...}
      GET  /api/structured-extraction/jobs/{jobId}
                          -> {"result": {...}, "rawModelOutput": str, "error": ...}
    The GET returns 200 with `result` once the job is done; earlier polls
    return a non-200 (still processing), so we poll until 200.
    """
    project_id = eff_str("nuextract_project_id")
    if not project_id:
        raise ExtractionError(
            "NuExtract project ID is not set — create a structured-extraction "
            "project on nuextract.ai and put its id in Settings → Extraction."
        )
    base = eff_str("nuextract_api_base").rstrip("/")
    headers = {"Authorization": f"Bearer {eff_str('nuextract_api_key')}"}
    try:
        with httpx.Client(timeout=60.0) as client:
            create = client.post(
                f"{base}/structured-extraction/{project_id}/jobs/text",
                headers=headers,
                json={"text": text},
            )
            create.raise_for_status()
            job_id = create.json()["jobId"]

            for _ in range(_NUEXTRACT_MAX_POLLS):
                res = client.get(
                    f"{base}/structured-extraction/jobs/{job_id}", headers=headers
                )
                if res.status_code == 200:
                    body = res.json()
                    if body.get("error"):
                        raise ExtractionError(
                            f"NuExtract result did not conform to the template: "
                            f"{body['error']}"
                        )
                    result = body.get("result")
                    if result is not None:
                        return json.dumps(result)
                    raw = body.get("rawModelOutput")
                    if raw:
                        return raw
                    raise ExtractionError(f"NuExtract returned no result: {body}")
                if res.status_code in (401, 403):
                    # Auth / quota problem — surface it clearly, don't spin.
                    try:
                        detail = res.json().get("message") or res.text
                    except Exception:
                        detail = res.text
                    raise ExtractionError(
                        f"NuExtract request denied ({res.status_code}): {detail}"
                    )
                # otherwise the job is still processing — wait and poll again
                time.sleep(_NUEXTRACT_POLL_INTERVAL)
            raise ExtractionError("NuExtract job timed out.")
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(f"NuExtract API error: {exc}") from exc


# ── Lightweight text completion (used by the NL search agent) ────────
#
# Same clients + retry policy as extraction, but plain text in / text out —
# no OCR preamble, no EXTRACTION_PROMPT. Kept here so there is exactly one
# provider abstraction in the codebase.

@retry(
    retry=retry_if_exception_type(_CLAUDE_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _complete_claude(prompt: str, max_tokens: int) -> str:
    message = _get_anthropic().messages.create(
        model=eff_str("claude_model"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in message.content if block.type == "text")


@retry(
    retry=retry_if_exception_type(_GEMINI_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _complete_gemini(prompt: str, max_tokens: int) -> str:
    response = _get_gemini().models.generate_content(
        model=eff_str("gemini_model"),
        contents=[prompt],
        config=genai_types.GenerateContentConfig(max_output_tokens=max_tokens),
    )
    return response.text or ""


@retry(
    retry=retry_if_exception_type(_QWEN_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _complete_qwen(prompt: str, max_tokens: int) -> str:
    response = _get_qwen().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


@retry(
    retry=retry_if_exception_type(_GPT_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _complete_gpt(prompt: str, max_tokens: int) -> str:
    response = _get_openai().chat.completions.create(
        model=eff_str("openai_model"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


def complete_text(
    prompt: str, provider: str | None = None, max_tokens: int = 600
) -> str:
    """
    Small text-only completion against one of the providers (defaults to the
    configured extraction provider). Raises ExtractionError on failure, like
    the extraction paths.
    """
    chosen = _normalize_provider(provider or eff_str("extraction_provider"))
    try:
        if chosen == "claude":
            return _complete_claude(prompt, max_tokens)
        if chosen == "qwen":
            return _complete_qwen(prompt, max_tokens)
        if chosen in ("gpt", "nuextract"):
            return _complete_gpt(prompt, max_tokens)
        if chosen == "glm":
            return _complete_glm(prompt, max_tokens)
        return _complete_gemini(prompt, max_tokens)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(
            f"{chosen.capitalize()} API error after retries: {exc}"
        ) from exc


# ── JSON parsing ─────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    """
    Parse the model's response into a dict, tolerantly.

    Vision models are flaky on dense table pages — the SAME page can come back
    as clean JSON one call and slightly malformed the next (a trailing comma, an
    unescaped quote/newline inside a cell value, an early stop). Rather than drop
    that page (and its whole table of grades), we escalate:
      1. plain json.loads
      2. json.loads of the outermost { ... } span (strips fences/prose)
      3. json_repair — fixes trailing commas, unescaped chars, truncated tails
    Only if all three fail do we give up.
    """
    text = raw.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start, end = text.find("{"), text.rfind("}")
    candidate = text[start : end + 1] if (start != -1 and end > start) else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    # Last resort: tolerant repair. Recovers the dense-table pages that would
    # otherwise be silently dropped.
    from json_repair import repair_json

    repaired = repair_json(candidate, return_objects=True)
    if isinstance(repaired, dict) and repaired:
        logger.info("Recovered a page's JSON via json_repair (%d chars)", len(candidate))
        return repaired
    raise json.JSONDecodeError("unrepairable model output", candidate, 0)


# ── Per-page extraction + merge (avoids single-call output truncation) ─
#
# A large brochure (e.g. 13 pages / 56 products ≈ 48 KB of JSON) cannot be
# produced in one model call: the output is capped at ~8 K tokens, so a single
# call gets truncated mid-JSON and fails to parse ("Model did not return valid
# JSON"). We therefore extract ONE PAGE AT A TIME and merge, which keeps every
# call's output small. It also carries the last-seen product family forward as a
# hint so a spec table whose header is printed once (page N) but whose rows
# continue onto later pages still tags those rows correctly — the v5
# TABLE-LEVEL HEADER INHERITANCE rule, extended across page boundaries.


def _continuation_hint(page_no: int, total: int, family_ctx: str) -> str:
    """Cross-page carry-forward note appended to a page's extraction prompt."""
    if not family_ctx:
        return ""
    return (
        f"\n\nCONTINUATION CONTEXT: This is page {page_no} of {total}, processed "
        "page by page. If a product table on this page has NO family/category "
        "header of its own (it was printed on an earlier page), the products "
        f'belong to the most recently seen family: "{family_ctx}". Apply the '
        "TABLE-LEVEL HEADER INHERITANCE RULE using that family — carry its full "
        "text into every product's name_raw/name_en and details.polymer_family."
    )


def _latest_family(data: dict) -> str:
    """The family/category of the last product on a page, used as the carry-
    forward context for the next page."""
    for p in reversed(data.get("products") or []):
        if isinstance(p, dict):
            det = p.get("details") or {}
            fam = det.get("polymer_family") or det.get("category")
            if fam:
                return str(fam)
    return ""


def _parse_json_soft(raw: str, page_no: int) -> dict:
    """Parse one page's output; on failure log and return an empty page rather
    than sinking the whole document (one bad page must not lose the other 12)."""
    try:
        return _parse_json(raw)
    except (json.JSONDecodeError, ValueError):
        logger.warning(
            "Page %d: extraction returned unparseable JSON (%d chars) — "
            "skipping that page.",
            page_no,
            len(raw or ""),
        )
        return {"products": []}


def _apply_bundle_split(data: dict) -> dict:
    """Deterministic safety net: split any product whose name is still an
    unsplit bundle ("Plasticizers: DINP, DIDP, DBP, DOP" → 4 products), no
    matter which model produced it. The extraction prompt asks the model to do
    this, but models miss it — so we guarantee it mechanically here, reusing the
    same conservative splitter as the reference pipeline (only fires on the
    "Category: item, item" shape, so real comma names like "1,2-Dichloroethane"
    are left alone).
    """
    from app.pipeline.schema import split_bundled_product  # local: avoid heavy import at load

    products = data.get("products") or []
    out: list[dict] = []
    n_split = 0
    for p in products:
        if not isinstance(p, dict):
            out.append(p)
            continue
        pieces = split_bundled_product(p)
        if len(pieces) > 1:
            n_split += 1
        out.extend(pieces)
    if n_split:
        logger.info(
            "Bundle-split: repaired %d bundled listing(s) → %d product(s) total",
            n_split,
            len(out),
        )
    data["products"] = out
    return data


# Purity is often emitted into `details` (details.purity / content / …) instead
# of the dedicated purity field; the search list reads the field, so it shows
# "—" while the detail page shows the value. Promote it into the field so both
# agree. Placeholder values ("/", "-", "N/A") are dropped, not promoted.
_PURITY_DETAIL_KEYS = (
    "purity", "content", "concentration", "assay", "min_purity",
    "purity_percent", "content_percent", "min_content",
)
_PURITY_PLACEHOLDERS = {"", "/", "-", "--", "n/a", "na", "none", "nil", "null", "0", "0%", "."}


def _promote_details_purity(data: dict) -> dict:
    """Lift a real purity value out of each product's details into `purity`."""
    for p in data.get("products") or []:
        if not isinstance(p, dict):
            continue
        if str(p.get("purity") or "").strip():
            continue  # already has a top-level purity
        details = p.get("details")
        if not isinstance(details, dict):
            continue
        for k in _PURITY_DETAIL_KEYS:
            v = details.get(k)
            if v is None:
                continue
            s = str(v).strip()
            if s.lower() in _PURITY_PLACEHOLDERS or not any(c.isdigit() for c in s):
                continue
            p["purity"] = s
            details.pop(k, None)  # avoid showing it twice (field + details)
            break
    return data


def _merge_page_results(pages: list[dict]) -> dict:
    """Merge per-page dicts into one brochure dict: a single company identity
    (first page that prints it — usually the cover) plus every page's products
    concatenated in order."""
    company_name = ""
    company_name_en: str | None = None
    company_website: str | None = None
    company_email: str | None = None
    company_phone: str | None = None
    products: list[dict] = []
    for d in pages:
        if not isinstance(d, dict):
            continue
        if not company_name and d.get("company_name"):
            company_name = d["company_name"]
        if company_name_en is None and d.get("company_name_en"):
            company_name_en = d.get("company_name_en")
        if not company_website and d.get("company_website"):
            company_website = d.get("company_website")
        if not company_email and d.get("company_email"):
            company_email = d.get("company_email")
        if not company_phone and d.get("company_phone"):
            company_phone = d.get("company_phone")
        for p in d.get("products") or []:
            if isinstance(p, dict):
                products.append(p)
    return {
        "company_name": company_name,
        "company_name_en": company_name_en,
        "company_website": company_website,
        "company_email": company_email,
        "company_phone": company_phone,
        "products": products,
    }


def _extract_pages(page_images: list[bytes], per_page_call) -> dict:
    """Drive `per_page_call(image_bytes, hint) -> raw_json_str` over every page,
    parse softly, and merge.

    Two modes, chosen by settings.page_concurrency:
      * 1  → SEQUENTIAL: carries the last-seen product family FORWARD as a hint,
             so a spec table whose header is printed once but spans pages still
             tags the continuation rows (max quality, slower).
      * >1 → PARALLEL: pages are independent calls run concurrently (much
             faster). The forward carry-forward can't apply across parallel
             calls, so cross-page header inheritance is left to the deterministic
             bundle-split + (preferably) the whole-document GLM path.
    """
    total = len(page_images)
    workers = max(1, min(eff_int("page_concurrency"), total))

    if workers == 1:
        page_results: list[dict] = []
        family_ctx = ""
        for i, img in enumerate(page_images, start=1):
            logger.info("Extracting page %d/%d (sequential)", i, total)
            raw = per_page_call(img, _continuation_hint(i, total, family_ctx))
            data = _parse_json_soft(raw, page_no=i)
            page_results.append(data)
            fam = _latest_family(data)
            if fam:
                family_ctx = fam
    else:
        logger.info("Extracting %d page(s) (concurrency=%d)", total, workers)
        page_results = [{} for _ in range(total)]

        def _one(idx: int) -> dict:
            try:
                return _parse_json_soft(per_page_call(page_images[idx], ""), page_no=idx + 1)
            except Exception as exc:  # noqa: BLE001
                # A single page's API failure (e.g. a 429 that outlived retries)
                # must not fail the whole brochure — log LOUDLY and drop just
                # that page, mirroring _parse_json_soft's per-page tolerance.
                logger.error(
                    "Page %d extraction call failed (%s): %s — page dropped",
                    idx + 1, type(exc).__name__, exc,
                )
                return {"products": []}

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_one, i): i for i in range(total)}
            for fut in as_completed(futures):
                page_results[futures[fut]] = fut.result()

    merged = _merge_page_results(page_results)
    logger.info(
        "Merged %d page(s) → %d product(s)", total, len(merged["products"])
    )
    return merged


# Company identity is a DOCUMENT-level fact (it sits on the cover and/or the
# contact/footer page), not something every product page repeats — so per-page
# product extraction reliably misses it. We recover it with one focused pass
# over the first + last page (where suppliers print their name/website).
# Lives in app/prompts/company_prompt.py — all prompt text belongs in that
# package (see its docstring). Aliased to the old private name so the existing
# call sites (here and worker._extract_identity) are unchanged.
from app.prompts.company_prompt import COMPANY_PROMPT as _COMPANY_PROMPT


def _extract_company_identity(page_images: list[bytes], provider: str) -> dict:
    """Best-effort document-level company identity from the first + last page.

    Uses Qwen OCR (always available) for those pages, then a short text
    completion on the configured provider. Failure is non-fatal — returns {}.
    """
    if not page_images:
        return {}
    idx = sorted({0, len(page_images) - 1})
    try:
        text = ocr.ocr_pages([page_images[i] for i in idx])
        if not text.strip():
            return {}
        raw = complete_text(
            f"{_COMPANY_PROMPT}\n\n--- PAGE TEXT ---\n{text}\n--- END ---",
            provider=provider,
            max_tokens=300,
        )
        return _parse_json_soft(raw, page_no=0)
    except Exception as exc:  # noqa: BLE001 — identity is best-effort
        logger.warning("Company-identity pass failed: %s", exc)
        return {}


def _qwen_page_call(img: bytes, hint: str) -> str:
    return _call_qwen_images([img], extra_context=hint)


def _gpt_page_call(img: bytes, hint: str) -> str:
    text = ocr.ocr_pages([img])  # Qwen OCR one page → text
    if not text.strip():
        return "{}"
    return _call_gpt_text(text, extra_context=hint)


# ── Main entry point ─────────────────────────────────────────────────

def extract_brochure(pdf_bytes: bytes) -> ExtractionResult:
    """
    Extract structured data from a single brochure PDF held in memory.

    Pipeline:
      1. Detect scanned vs text-based PDF.
      2. qwen / gpt / nuextract → extract PAGE BY PAGE and merge (bounds each
         call's output so large brochures don't truncate; see the per-page
         section above). gpt/nuextract OCR each page with Qwen first.
      3. claude / gemini → single native-PDF (or OCR-text) call.
      4. Parse JSON + validate against the pydantic schema.

    Raises ExtractionError if the output can't be parsed/validated — the
    caller logs/rejects it rather than inserting garbage. The PDF bytes are
    never written to disk here.
    """
    provider = _normalize_provider(eff_str("extraction_provider"))
    logger.info("Extraction provider: %s", provider)

    # Step 1: detect scanned PDF
    analysis = pdf_utils.analyse_pdf(pdf_bytes)

    # Step 2/3: route to the right call path
    try:
        if provider == "glm":
            # GLM-4.6V (OpenRouter) — single-model VISION, per-page + parallel.
            # One model reads the page images AND structures them (no OCR step);
            # pages run concurrently (settings.page_concurrency) so it's fast and
            # never truncates. Rendered at the vision DPI (lighter than OCR).
            page_imgs = pdf_utils.render_pages(
                pdf_bytes, dpi=settings.openrouter_vision_dpi
            )
            if not page_imgs:
                raise ExtractionError("Could not render any pages from the PDF.")
            data = _extract_pages(page_imgs, _glm_page_call)
            if not data.get("company_name") or not data.get("company_website"):
                ident = _extract_company_identity(page_imgs, provider)
                data["company_name"] = data.get("company_name") or ident.get("company_name")
                data["company_name_en"] = data.get("company_name_en") or ident.get("company_name_en")
                data["company_website"] = data.get("company_website") or ident.get("company_website")
                data["company_email"] = data.get("company_email") or ident.get("company_email")
                data["company_phone"] = data.get("company_phone") or ident.get("company_phone")

        elif provider in ("qwen", "gpt", "nuextract"):
            # These providers all consume page images (qwen=vision,
            # gpt/nuextract=Qwen-OCR→text). Extract per page + merge so the
            # output never gets truncated on a big brochure.
            page_imgs = analysis.page_images or pdf_utils.render_pages(pdf_bytes)
            if not page_imgs:
                raise ExtractionError(
                    "Could not render any pages from the PDF."
                )
            if provider == "qwen":
                data = _extract_pages(page_imgs, _qwen_page_call)
            elif provider == "gpt":
                data = _extract_pages(page_imgs, _gpt_page_call)
            else:  # nuextract — OCR whole doc then one template call (async API)
                ocr_text = ocr.ocr_pages(page_imgs)
                if not ocr_text.strip():
                    raise ExtractionError("Qwen OCR returned no text from the PDF.")
                data = _parse_json(_call_nuextract_text(ocr_text))

            # Recover the document-level company identity that per-page product
            # extraction tends to miss (name/website live on the cover/footer).
            if not data.get("company_name") or not data.get("company_website"):
                ident = _extract_company_identity(page_imgs, provider)
                data["company_name"] = data.get("company_name") or ident.get("company_name")
                data["company_name_en"] = (
                    data.get("company_name_en") or ident.get("company_name_en")
                )
                data["company_website"] = (
                    data.get("company_website") or ident.get("company_website")
                )
                data["company_email"] = (
                    data.get("company_email") or ident.get("company_email")
                )
                data["company_phone"] = (
                    data.get("company_phone") or ident.get("company_phone")
                )

        elif analysis.is_scanned and analysis.page_images:
            # Scanned → Qwen OCR first, then a single text-based call (claude /
            # gemini). Small scanned docs; native-PDF providers keep one call.
            logger.info(
                "Scanned PDF detected (%d pages) — running Qwen OCR",
                analysis.page_count,
            )
            ocr_text = ocr.ocr_pages(analysis.page_images)
            if not ocr_text.strip():
                raise ExtractionError(
                    "Qwen OCR returned no text from the scanned PDF."
                )
            raw = (
                _call_claude_text(ocr_text)
                if provider == "claude"
                else _call_gemini_text(ocr_text)
            )
            data = _parse_json(raw)
        else:
            # Text-based → send the native PDF directly (claude / gemini).
            if provider == "claude":
                pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")
                raw = _call_claude_pdf(pdf_b64)
            else:
                raw = _call_gemini_pdf(pdf_bytes)
            data = _parse_json(raw)

    except ExtractionError:
        raise  # re-raise our own errors as-is
    except json.JSONDecodeError as exc:
        logger.warning("Extraction returned non-JSON output.")
        raise ExtractionError("Model did not return valid JSON.") from exc
    except Exception as exc:
        raise ExtractionError(
            f"{provider.capitalize()} API error after retries: {exc}"
        ) from exc

    if not data.get("company_name") and not data.get("products"):
        raise ExtractionError(
            "No company or products could be extracted from any page."
        )
    # Deterministic bundle split for EVERY provider (see _apply_bundle_split):
    # guarantees "Category: a, b, c" listings are separated even when the model
    # doesn't split them itself.
    data = _apply_bundle_split(data)
    # Lift any purity the model tucked into details up into the purity field, so
    # the search list shows it (not just the product detail page).
    data = _promote_details_purity(data)
    # A brochure with products but no printed company name still validates —
    # supply a neutral placeholder so the required field is satisfied.
    if not data.get("company_name"):
        data["company_name"] = "Unknown supplier"

    try:
        # Pydantic validates shape and types; malformed extractions are rejected.
        result = ExtractionResult.model_validate(data)
    except Exception as exc:  # pydantic ValidationError and friends
        logger.warning("Extraction failed schema validation: %s", exc)
        raise ExtractionError(f"Extracted data failed validation: {exc}") from exc

    # Step 5: deterministic reference enrichment (PubChem by CAS). Best-effort
    # and clearly labelled as NOT from the brochure — never blocks extraction.
    enrich.enrich_result(result)
    return result
