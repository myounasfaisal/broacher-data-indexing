"""
Qwen vision OCR for scanned PDF pages.

Takes PNG page images rendered by pdf_utils and sends each to Qwen's vision
model via the OpenAI-compatible API (works with Dashscope or a local vLLM /
Ollama deployment). The model is asked to faithfully reproduce ALL visible
text on the page — no summarisation, no interpretation.

The concatenated output is then passed to the extraction model (Gemini or
Claude) as plain text, so even scanned brochures get structured extraction.
"""

from __future__ import annotations

import base64
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import eff_int, eff_str, settings
from app.services import llm_clients

logger = logging.getLogger(__name__)

# Shared with extraction and the two-stage pipeline — same DashScope key and
# base URL, so they must not drift apart when an admin changes one.
_get_client = llm_clients.qwen_client


# The OCR prompt asks Qwen to be a faithful text extractor — no
# interpretation, no summarisation, preserve layout where possible. It lives in
# app/prompts/ocr_prompt.py; all prompt text belongs in that package (see its
# docstring). Aliased to the old private name so call sites below are unchanged.
from app.prompts.ocr_prompt import OCR_PROMPT as _OCR_PROMPT

# Retry on transient errors from the OpenAI-compatible endpoint.
_RETRYABLE = (Exception,)  # broad — the openai SDK raises various errors


@retry(
    retry=retry_if_exception_type(_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def _ocr_single_page(png_bytes: bytes, page_number: int) -> str:
    """Send one page image to Qwen and return the extracted text."""
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")

    response = _get_client().chat.completions.create(
        model=eff_str("qwen_model"),
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64}",
                        },
                    },
                    {"type": "text", "text": _OCR_PROMPT},
                ],
            }
        ],
    )

    text = response.choices[0].message.content or ""
    logger.debug("OCR page %d: %d chars extracted", page_number, len(text))
    return text.strip()


def _ocr_page_safe(png_bytes: bytes, page_number: int) -> str:
    """OCR one page, converting any failure into an inline marker (so one bad
    page never sinks the batch)."""
    try:
        text = _ocr_single_page(png_bytes, page_number=page_number)
        return text or "[no text detected]"
    except Exception as exc:  # noqa: BLE001
        logger.warning("OCR failed for page %d: %s", page_number, exc)
        return f"[OCR failed: {exc}]"


def ocr_pages(page_images: list[bytes]) -> str:
    """
    Run Qwen vision OCR on a list of page images (PNG bytes).

    Returns all extracted text concatenated in page order with page separators.
    Pages are OCR'd CONCURRENTLY (up to settings.page_concurrency) to cut
    wall-clock time — they're independent — while results are re-assembled in
    order. Set page_concurrency=1 for fully sequential behaviour.
    """
    if not page_images:
        return ""

    workers = max(1, min(eff_int("page_concurrency"), len(page_images)))
    logger.info(
        "Starting Qwen OCR for %d page(s) (concurrency=%d)",
        len(page_images), workers,
    )

    if workers == 1:
        texts = [
            _ocr_page_safe(png, i) for i, png in enumerate(page_images, start=1)
        ]
    else:
        texts = [""] * len(page_images)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_ocr_page_safe, png, i + 1): i
                for i, png in enumerate(page_images)
            }
            for fut in as_completed(futures):
                texts[futures[fut]] = fut.result()

    parts = [f"--- Page {i} ---\n{t}" for i, t in enumerate(texts, start=1)]
    result = "\n\n".join(parts)
    logger.info(
        "Qwen OCR complete: %d pages, %d total chars", len(page_images), len(result)
    )
    return result
