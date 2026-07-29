"""
Scanned PDF detection and page image rendering.

Uses PyMuPDF (fitz) to determine whether a PDF is scanned (image-only pages
with no extractable text) and to render scanned pages to PNG images for
downstream OCR processing.

The detection heuristic is simple and conservative: if more than half of the
pages contain fewer than 30 characters of extractable text, the document is
treated as scanned. This avoids sending text-rich PDFs through the slower
(and more expensive) Qwen OCR pipeline.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# If a page yields fewer than this many text characters, it's considered
# an image-only (scanned) page.
_MIN_TEXT_CHARS = 30

# DPI used when rendering scanned pages to images. 200 is a good balance
# between OCR quality and image size / API cost.
_RENDER_DPI = 200

# Vision APIs (Claude, and most others) reject a single image over ~5MB.
# A normal text/table brochure page renders to a few hundred KB at 200 DPI —
# this only bites a page with a large photo/graphic background (a brochure
# cover is the common case), where PNG's lossless compression can't shrink it
# enough. Stay safely under the real limit rather than skating the edge.
_MAX_IMAGE_BYTES = 4_500_000

# Never render below this DPI even to hit the size cap — a further shrink
# would make small print (CAS numbers, units) genuinely unreadable, which is
# worse than the page failing loudly.
_MIN_RENDER_DPI = 72


@dataclass
class PdfAnalysis:
    """Result of analysing a PDF for scanned content."""

    is_scanned: bool
    page_images: list[bytes]  # PNG bytes per page (populated only when scanned)
    page_count: int


def analyse_pdf(pdf_bytes: bytes) -> PdfAnalysis:
    """
    Open a PDF from raw bytes, detect whether it's scanned, and render page
    images if it is.

    Returns a PdfAnalysis with is_scanned=True and populated page_images when
    the document appears to be a scan. For text-based PDFs, page_images is
    empty (no rendering cost).
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(doc)

    if page_count == 0:
        doc.close()
        return PdfAnalysis(is_scanned=False, page_images=[], page_count=0)

    # Count how many pages have meaningful extractable text.
    text_pages = 0
    for page in doc:
        text = page.get_text("text").strip()
        if len(text) >= _MIN_TEXT_CHARS:
            text_pages += 1

    is_scanned = text_pages < (page_count / 2)

    if not is_scanned:
        doc.close()
        logger.info(
            "PDF has %d/%d text pages — treating as text-based (no OCR needed)",
            text_pages,
            page_count,
        )
        return PdfAnalysis(is_scanned=False, page_images=[], page_count=page_count)

    # Render each page to PNG for OCR.
    logger.info(
        "PDF has %d/%d text pages — treating as scanned, rendering %d pages",
        text_pages,
        page_count,
        page_count,
    )
    page_images: list[bytes] = []
    zoom = _RENDER_DPI / 72  # fitz default is 72 dpi
    matrix = fitz.Matrix(zoom, zoom)

    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        png_bytes = pix.tobytes(output="png")
        page_images.append(png_bytes)
        pix = None  # free memory early

    doc.close()
    return PdfAnalysis(
        is_scanned=True, page_images=page_images, page_count=page_count
    )


def render_pages(pdf_bytes: bytes, dpi: int = _RENDER_DPI) -> list[bytes]:
    """
    Render EVERY page of a PDF to PNG bytes.

    Used to feed vision models that can't accept native PDFs (Qwen, GPT): a
    text-based PDF has no pre-rendered `page_images`, so callers render on
    demand here rather than duplicating the fitz plumbing.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images: list[bytes] = [_render_page_capped(page, dpi) for page in doc]
    doc.close()
    return images


def _render_page_capped(page: fitz.Page, dpi: int) -> bytes:
    """Render one page to PNG, halving the resolution if it comes out over
    _MAX_IMAGE_BYTES (a photo-heavy cover page is the usual cause — a normal
    text page never gets close) until it fits or _MIN_RENDER_DPI is hit."""
    current_dpi = dpi
    while True:
        zoom = current_dpi / 72  # fitz default is 72 dpi
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes(output="png")
        pix = None  # free memory early
        if len(png_bytes) <= _MAX_IMAGE_BYTES or current_dpi <= _MIN_RENDER_DPI:
            if len(png_bytes) > _MAX_IMAGE_BYTES:
                logger.warning(
                    "Page render still %.1fMB at the %d DPI floor — sending "
                    "as-is; the provider may reject it.",
                    len(png_bytes) / 1e6, _MIN_RENDER_DPI,
                )
            return png_bytes
        current_dpi = max(_MIN_RENDER_DPI, current_dpi // 2)
