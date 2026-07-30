-- A document-level error reason, so a failed upload tells the user WHY
-- (out of API credit, bad key, corrupt file, ...) instead of just "failed".
--
-- pages.error_message already existed per-page, but nothing summarized it
-- onto the document, and the upload UI only ever showed a generic
-- "Extraction failed" line regardless of cause. This column is what the
-- worker now writes a plain-English reason into (see app/worker.py) and
-- what GET /upload-jobs reads back for the progress list.

alter table documents add column if not exists error text;
