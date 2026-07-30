-- Bring three objects the running system depends on under version control.
--
-- WHY: ARCHITECTURE.md §12.1 recorded that `claim_next_document` — the RPC the
-- worker's claim loop calls on every iteration — existed in the live database
-- and in NO .sql file in this repo. Same for the two PostgREST computed fields
-- the read side searches against. A fresh environment therefore could not be
-- provisioned from this repo: the API would start, the worker would crash on
-- its first claim, and search would 404 on an unknown column.
--
-- These definitions were captured from the live project (qpqdbyhfquqfrkrocnnu)
-- with pg_get_functiondef on 2026-07-30, so this file reproduces exactly what
-- production is running rather than a reconstruction from memory.
--
-- SAFE TO RE-RUN. Every statement is CREATE OR REPLACE / idempotent GRANT, and
-- the bodies are byte-identical to what is already deployed, so applying this
-- against the live database is a semantic no-op. That matters because the
-- migration ledger already contains duplicate entries from migrations having
-- been applied both by hand and by the Deploy Supabase migrations workflow.

-- ── The worker's claim loop ───────────────────────────────────────────────
-- Longest-job-first (page_count desc) so a 200-page catalog starts before a
-- 3-page flyer, and FOR UPDATE SKIP LOCKED so N workers never collide on the
-- same document. Claims from both 'pending' and 'split' because a worker that
-- died after splitting must be resumable. Skips documents with a pending
-- cancel request rather than starting work someone already called off.
CREATE OR REPLACE FUNCTION public.claim_next_document(p_worker_id text)
 RETURNS documents
 LANGUAGE plpgsql
AS $function$
declare
  claimed public.documents;
begin
  update public.documents d
  set status = 'extracting', claimed_by = p_worker_id, claimed_at = now()
  where d.id = (
    select id from public.documents
    where status in ('pending', 'split')
      and coalesce(cancel_requested, false) = false
    order by page_count desc nulls last
    limit 1
    for update skip locked
  )
  returning d.* into claimed;
  return claimed;
end;
$function$;

-- ── Search surfaces (PostgREST computed fields, NOT columns) ──────────────
-- PostgREST exposes a function taking the table's row type as a virtual
-- column, which is why these do not appear in information_schema.columns —
-- a real trap when auditing whether the schema is complete.

-- One broad match surface: names in both scripts, CAS, every detail value, and
-- the supplier's name. STABLE rather than IMMUTABLE because it reads
-- public.companies.
CREATE OR REPLACE FUNCTION public.search_text(l listings)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select concat_ws(' ',
    l.name_raw,
    l.name_en,
    l.cas_number,
    l.details::text,
    (select concat_ws(' ', c.company_name, c.company_name_en)
       from public.companies c
      where c.id = l.company_id)
  )
$function$;

-- Details-only surface, so a query can target printed attributes (colour,
-- hazard class, packaging, grade, product_family) without name/CAS/supplier
-- text producing false positives.
CREATE OR REPLACE FUNCTION public.details_text(listings)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce($1.details::text, '')
$function$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- service_role only, matching the live ACL exactly. The backend holds the
-- service key and is the only caller; the browser never invokes these
-- directly, so `authenticated` and `anon` are deliberately NOT granted.
-- Revoke first so re-running cannot silently widen access.
REVOKE ALL ON FUNCTION public.claim_next_document(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_text(listings)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.details_text(listings)    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_next_document(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_text(listings)     TO service_role;
GRANT EXECUTE ON FUNCTION public.details_text(listings)    TO service_role;
