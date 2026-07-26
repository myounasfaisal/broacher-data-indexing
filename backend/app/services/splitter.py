"""
PDF splitter — turns a retained brochure PDF into per-page images in Storage and
one `pages` row each.

Splitting runs inside the WORKER now (lazily), not at upload time: the upload
path retains the source PDF in Storage, and the worker splits it the first time
it processes the document. This means a crash before splitting finishes just
re-splits from the retained PDF, and no page image is held in request memory.

This function only produces pages + sets page_count; the WORKER owns document
status transitions (so a split running mid-'extracting' never resets status).
"""

from __future__ import annotations

import logging

from app.config import settings
from app.services import pdf_utils, pipeline_db

logger = logging.getLogger(__name__)


class SplitError(Exception):
    """Raised when a PDF could not be split into any page images."""


def split_document(doc_id: str, pdf_bytes: bytes) -> int:
    """
    Render every page of `pdf_bytes` to a PNG, upload it to Storage, and insert
    a `pages` row for it; set the document's page_count. Returns the page count,
    or raises SplitError if the PDF produces no pages.

    Idempotent per document: page images upsert on a deterministic path and
    `pages` rows are unique on (document_id, page_number), so re-splitting a
    partially-split document overwrites rather than duplicating.

    Render resolution comes from `settings.split_dpi` so it can be tuned without
    a code change — but it trades extraction recall for image size, so measure
    before lowering it.
    """
    try:
        images = pdf_utils.render_pages(pdf_bytes, dpi=settings.split_dpi)
    except Exception as exc:  # noqa: BLE001
        raise SplitError(f"Could not render PDF pages: {exc}") from exc

    if not images:
        raise SplitError("PDF produced no pages.")

    # Which pages already exist (crash/retry resume) so we don't duplicate rows.
    existing = {p["page_number"] for p in pipeline_db.list_pages(doc_id)}

    for page_number, png in enumerate(images, start=1):
        path = pipeline_db.upload_page_image(doc_id, page_number, png)
        if page_number not in existing:
            pipeline_db.insert_page(doc_id, page_number, path)

    pipeline_db.set_document(doc_id, page_count=len(images))
    logger.info("Split document %s into %d page(s)", doc_id, len(images))
    return len(images)
