"""
Stage 1 — Qwen VLM: brochure page image -> faithful structured transcription.

This stage's ONLY job is lossless transcription that preserves the visual
structure carrying meaning (which bullets sit under which category header,
which cells belong to which table row). If that structure is flattened here,
stage 2 cannot reliably decide how to split bundled listings — most "bundling"
failures trace back to this step silently losing the header/bullet hierarchy,
not to stage 2 reasoning badly. That is why the prompt (VLM_TRANSCRIPTION_PROMPT)
forbids summarising/reordering and why we keep DPI high enough to read grade
codes in small print.

Serving stack: the project already talks to Qwen through the OpenAI-compatible
client (Dashscope by default, or a local vLLM/Ollama deployment) — see
`services/ocr.py` and `services/extraction.py`. We reuse that exact pattern
here rather than introducing a new SDK.
"""

from __future__ import annotations

import base64
import logging

from openai import OpenAI
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import eff_str, settings
from app.prompts.extraction_prompt import VLM_TRANSCRIPTION_PROMPT
from app.services import llm_clients, pdf_utils

logger = logging.getLogger(__name__)

# Same DashScope client as OCR/extraction — see app/services/llm_clients.py.
_get_client = llm_clients.qwen_client


# Broad retry — the OpenAI SDK raises a range of transient error types against
# an OpenAI-compatible endpoint (rate limits, 5xx, connection drops).
_RETRYABLE = (Exception,)


@retry(
    retry=retry_if_exception_type(_RETRYABLE),
    stop=stop_after_attempt(settings.api_max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    reraise=True,
)
def transcribe_page(png_bytes: bytes, page_number: int = 1) -> str:
    """Transcribe ONE brochure page image (PNG bytes) to structured markdown."""
    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    response = _get_client().chat.completions.create(
        model=eff_str("qwen_vlm_model"),
        max_tokens=settings.pipeline_max_tokens,
        # Deterministic transcription — we do NOT want the model paraphrasing.
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                    {"type": "text", "text": VLM_TRANSCRIPTION_PROMPT},
                ],
            }
        ],
    )
    text = (response.choices[0].message.content or "").strip()
    logger.debug("VLM page %d: %d chars transcribed", page_number, len(text))
    return text


def transcribe_pages(page_images: list[bytes]) -> str:
    """Transcribe a list of page images and merge into one document string.

    Multi-page brochures are transcribed page-by-page (each page is one VLM
    call — the OpenAI-compatible vision endpoint takes images, not native PDFs)
    and joined with explicit page markers so stage 2 still sees one document
    with a single company identity. Per-page failures degrade gracefully rather
    than sinking the whole document.
    """
    if not page_images:
        return ""

    logger.info("Stage 1 (VLM transcription): %d page(s)", len(page_images))
    parts: list[str] = []
    for i, png in enumerate(page_images, start=1):
        try:
            text = transcribe_page(png, page_number=i)
            parts.append(f"--- Page {i} ---\n{text}" if text else f"--- Page {i} ---\n[no text detected]")
        except Exception as exc:  # noqa: BLE001 — one bad page must not kill the doc
            logger.warning("VLM transcription failed for page %d: %s", i, exc)
            parts.append(f"--- Page {i} ---\n[transcription failed: {exc}]")

    merged = "\n\n".join(parts)
    logger.info(
        "Stage 1 complete: %d page(s), %d total chars", len(page_images), len(merged)
    )
    return merged


def transcribe_pdf(pdf_bytes: bytes) -> str:
    """Render a PDF to page images and transcribe all pages (stage 1 entry).

    Reuses `pdf_utils.render_pages` (PyMuPDF) — the project's existing
    PDF→image utility — rather than adding a new rasteriser dependency.
    """
    page_images = pdf_utils.render_pages(pdf_bytes)
    if not page_images:
        logger.warning("No pages rendered from PDF — nothing to transcribe")
        return ""
    return transcribe_pages(page_images)
