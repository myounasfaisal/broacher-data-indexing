-- Distinguishes a document the worker deliberately stopped (bad key, no
-- credit, unknown model — see the 2026-07-29 error-handling change) from an
-- ordinary failed-but-retriable one.
--
-- Without this, the reconciler's "retry failed documents that still have
-- retriable pages" sweep (app/reconciler.py) would reset a fatally-stopped
-- document back to claimable every ~30s forever, since its untouched
-- remaining pages are still 'pending' — the worker would just hit the same
-- unrecoverable error again on the next page. A manual Restart still clears
-- this flag (the human presumably fixed the key); the automatic sweep does
-- not.

alter table documents add column if not exists fatal boolean not null default false;
