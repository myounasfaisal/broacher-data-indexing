-- Migration — "Start processing" gate (2026-07-26)
--
-- Adds the 'staged' document status: uploaded and durable, but NOT claimable by
-- a worker until the user presses "Start processing" (POST /upload-jobs/start).
-- Without this, POST /upload-jobs fails at the retain step with a 23514 check
-- violation and every upload lands in 'failed'.
--
-- Run once in the Supabase SQL editor. Idempotent.
--
-- NOTE: the existing constraint in the live DB already permits 'paused' and
-- 'cancelled' even though schema-additions.sql never listed them. This
-- rewrites the constraint with the complete, correct set — see
-- ARCHITECTURE.md §12.1 on why the repo's SQL had drifted.

alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('staged', 'pending', 'splitting', 'split', 'claimed',
                    'extracting', 'paused', 'done', 'failed', 'cancelled'));

-- The upload UI polls "my staged documents" on every refresh.
create index if not exists idx_documents_uploaded_by_status
  on public.documents (uploaded_by, status);

-- Verify:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conname = 'documents_status_check';
