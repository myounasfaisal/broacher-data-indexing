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
    zoom = dpi / 72  # fitz default is 72 dpi
    matrix = fitz.Matrix(zoom, zoom)
    images: list[bytes] = []
    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        images.append(pix.tobytes(output="png"))
        pix = None  # free memory early
    doc.close()
    return images
