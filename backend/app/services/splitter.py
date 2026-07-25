"""
PDF splitter — turns an uploaded brochure PDF into per-page images in Storage
and one `pages` row each, then leaves the document ready for the worker.

This runs in the upload path (the inline-extraction path it replaces is gone):
upload creates the `documents` row, this splits it, and the DB worker claims it
for the two-stage extraction. Splitting is CPU-bound and fast (PyMuPDF render),
so it happens up front; the slow AI work is the worker's asynchronous job.

The source PDF is never persisted — it lives only in the request's memory while
this runs. Once page images are in Storage, the bytes are dropped by the caller.
"""

from __future__ import annotations

import logging

from app.services import pdf_utils, pipeline_db

logger = logging.getLogger(__name__)


class SplitError(Exception):
    """Raised when a PDF could not be split into any page images."""


def split_document(doc_id: str, pdf_bytes: bytes) -> int:
    """
    Render every page of `pdf_bytes` to a PNG, upload it to Storage, and insert
    a `pages` row for it. On success sets the document to 'split' with its
    page_count and returns the page count. On failure sets 'failed' and raises.

    Idempotent per document: page images upsert on a deterministic path and
    `pages` rows are unique on (document_id, page_number), so a re-run of a
    partially-split document overwrites rather than duplicating.
    """
    try:
        images = pdf_utils.render_pages(pdf_bytes)
    except Exception as exc:  # noqa: BLE001
        pipeline_db.set_document(doc_id, status="failed")
        raise SplitError(f"Could not render PDF pages: {exc}") from exc

    if not images:
        pipeline_db.set_document(doc_id, status="failed")
        raise SplitError("PDF produced no pages.")

    # Which pages already exist (crash/retry resume) so we don't duplicate rows.
    existing = {p["page_number"] for p in pipeline_db.list_pages(doc_id)}

    for page_number, png in enumerate(images, start=1):
        path = pipeline_db.upload_page_image(doc_id, page_number, png)
        if page_number not in existing:
            pipeline_db.insert_page(doc_id, page_number, path)

    # If the user cancelled while we were splitting, don't hand it to the worker.
    if pipeline_db.is_cancel_requested(doc_id):
        pipeline_db.set_document(doc_id, status="cancelled", page_count=len(images))
        logger.info("Document %s cancelled during split", doc_id)
        return len(images)

    pipeline_db.set_document(doc_id, status="split", page_count=len(images))
    logger.info("Split document %s into %d page(s)", doc_id, len(images))
    return len(images)
