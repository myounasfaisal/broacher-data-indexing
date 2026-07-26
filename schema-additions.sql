-- =====================================================================
-- Chemical Brochure Extraction Platform — schema additions (MERGE migration)
-- =====================================================================
-- Run this ONCE in the Supabase SQL editor, AFTER the existing base schema.
--
-- IMPORTANT — this is a MERGE, not a from-scratch create. The live DB already
-- has a `documents` table: the content-hash dedup LEDGER that powers upload
-- dedup, upload history (`listing_ids`, `product_count`) and undo-upload
-- (see CHANGES.md). The pipeline design's `documents` work-queue row is a
-- SUPERSET of that ledger (its own spec already carries `content_hash unique`),
-- so instead of creating a second table we EVOLVE the existing one in place.
--
-- Adaptations to the live schema (deliberate — follow the repo, not the generic
-- brief which assumed different column names):
--   * documents.company_id stays BIGINT (live companies.id is bigint identity),
--     not uuid.
--   * We reuse the existing `documents.filename` (not `original_filename`).
--   * `id uuid` is added as a UNIQUE key; `content_hash` stays the PRIMARY KEY.
--     FKs may reference documents(id) because it is unique — this avoids a
--     risky primary-key swap on a live table, and keeps every content_hash
--     query in jobs.py/database.py working unchanged.
--   * companies already has `email` + `contact_number`; we do NOT re-add them.
--     The trigram index is on the real column `company_name` (not `name`).
--
-- What this adds, and why:
--   1. documents — evolved into the pipeline work-queue (status machine,
--      running_context, page_count, claimed_by/at) while keeping the ledger
--      columns (content_hash, listing_ids, product_count).
--   2. pages — one row per page image; per-page status + crash-resume state.
--   3. Traceability + flexible columns on listings (document_id, source_page_id,
--      characteristics, cas_number_raw, review_reason).
--   4. Stronger company dedup (website / website_domain / extra_details) +
--      pg_trgm fuzzy-name index.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- 1. Evolve the existing `documents` ledger into the work-queue table.
--    All ADDs are idempotent; existing ledger rows are back-filled below.
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists id              uuid default gen_random_uuid(),
  add column if not exists status          text not null default 'pending',
  add column if not exists running_context jsonb,
  add column if not exists page_count      int,
  add column if not exists claimed_by      text,
  add column if not exists claimed_at      timestamptz;

-- Existing ledger rows predate the pipeline and represent completed uploads.
update public.documents set status = 'done' where status = 'pending';

-- Ensure every row has an id, then make it a NOT NULL unique key so pages /
-- listings can FK to documents(id). content_hash remains the primary key.
update public.documents set id = gen_random_uuid() where id is null;
alter table public.documents alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_id_key'
  ) then
    alter table public.documents add constraint documents_id_key unique (id);
  end if;
end$$;

-- Status check constraint (added separately so the ADD COLUMN above stays simple).
--   staged    — uploaded, PDF retained, NOT claimable. Waits for the user to
--               press "Start processing" (POST /upload-jobs/start).
--   paused /
--   cancelled — lifecycle controls (were live in the DB before being written
--               down here; see ARCHITECTURE.md §12.1 on this file's drift).
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('staged', 'pending', 'splitting', 'split', 'claimed',
                    'extracting', 'paused', 'done', 'failed', 'cancelled'));

-- Staged documents are the queue's waiting room; the upload UI reads them on
-- every poll.
create index if not exists idx_documents_uploaded_by_status
  on public.documents (uploaded_by, status);

-- ---------------------------------------------------------------------
-- 2. pages: one row per page image, belonging to a document.
-- ---------------------------------------------------------------------
create table if not exists public.pages (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  page_number     int not null,
  image_path      text,           -- Supabase Storage path
  status          text not null default 'pending'
                    check (status in ('pending', 'claimed', 'extracting', 'done', 'failed', 'dead')),
  attempts        int not null default 0,
  claimed_at      timestamptz,
  markdown_output text,           -- stage 1 output, kept for debugging/audit
  raw_json        jsonb,          -- stage 2 output, kept for debugging/audit
  error_message   text,
  created_at      timestamptz not null default now(),
  unique (document_id, page_number)
);

-- ---------------------------------------------------------------------
-- 3. Traceability + flexible fields on listings.
-- ---------------------------------------------------------------------
alter table public.listings
  add column if not exists document_id     uuid references public.documents (id) on delete set null,
  add column if not exists source_page_id  uuid references public.pages (id) on delete set null,
  add column if not exists characteristics jsonb,   -- variable per-product specs
  add column if not exists cas_number_raw  text,    -- exact as-extracted text, pre-normalization
  add column if not exists review_reason   text;    -- why needs_review was set, for the reviewer

-- ---------------------------------------------------------------------
-- 4. Stronger company dedup. (email + contact_number already exist live.)
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists website        text,
  add column if not exists website_domain text,
  add column if not exists extra_details  jsonb;

-- website_domain is the primary dedup key; partial unique index allows the
-- many companies with no website to coexist (multiple NULLs).
create unique index if not exists uq_companies_website_domain
  on public.companies (website_domain) where website_domain is not null;

-- ---------------------------------------------------------------------
-- 5. Indexes.
-- ---------------------------------------------------------------------
create index if not exists idx_documents_status         on public.documents (status);
create index if not exists idx_pages_document_id_status on public.pages (document_id, status);
create index if not exists idx_pages_status             on public.pages (status);
create index if not exists idx_listings_document_id     on public.listings (document_id);
create index if not exists idx_listings_source_page_id  on public.listings (source_page_id);
-- fuzzy-name fallback for supplier dedup (real column is company_name).
create index if not exists idx_companies_name_trgm      on public.companies using gin (company_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 6. Row Level Security for the new processing state.
--    documents already has RLS enabled; add an admin/manager read policy.
--    pages is new — enable RLS + the same read policy. All writes go through
--    the service_role key from the backend worker (bypasses RLS), unchanged.
-- ---------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.pages     enable row level security;

drop policy if exists "admin_manager read documents" on public.documents;
create policy "admin_manager read documents"
  on public.documents for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );

drop policy if exists "admin_manager read pages" on public.pages;
create policy "admin_manager read pages"
  on public.pages for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );

-- ---------------------------------------------------------------------
-- 7. House knowledge (P4): curated substitution + regulatory notes.
--    Full commentary lives in db/migrations/2026-07-26_house_knowledge.sql;
--    repeated here so a from-scratch setup gets the whole schema from the
--    two repo SQL files (see ARCHITECTURE.md §12.1 on why this matters).
-- ---------------------------------------------------------------------
create table if not exists public.substitution_notes (
  id               uuid primary key default gen_random_uuid(),
  from_chemical_id uuid not null references public.chemicals (id) on delete cascade,
  -- Nullable: the most useful notes are often about substances we do NOT
  -- stock, which is a sourcing instruction rather than missing data.
  to_chemical_id   uuid references public.chemicals (id) on delete set null,
  to_name          text not null,
  verdict          text not null default 'works'
                     check (verdict in ('works', 'conditional', 'avoid')),
  context          text not null,
  author_id        uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.regulatory_notes (
  id             uuid primary key default gen_random_uuid(),
  chemical_id    uuid not null references public.chemicals (id) on delete cascade,
  jurisdiction   text not null,
  status         text not null
                   check (status in ('banned', 'restricted', 'phase_out',
                                     'permitted', 'unclear')),
  effective_date date,
  note           text not null,
  source_url     text,
  author_id      uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_substitution_notes_from
  on public.substitution_notes (from_chemical_id);
create index if not exists idx_substitution_notes_to
  on public.substitution_notes (to_chemical_id);
create index if not exists idx_regulatory_notes_chemical
  on public.regulatory_notes (chemical_id);

alter table public.substitution_notes enable row level security;
alter table public.regulatory_notes   enable row level security;

drop policy if exists "authenticated read substitution_notes" on public.substitution_notes;
create policy "authenticated read substitution_notes"
  on public.substitution_notes for select
  to authenticated
  using (true);

drop policy if exists "authenticated read regulatory_notes" on public.regulatory_notes;
create policy "authenticated read regulatory_notes"
  on public.regulatory_notes for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- 8. Semantic index (P3): one embedding per canonical chemical.
--    Full commentary in db/migrations/2026-07-26_chemical_embeddings.sql.
--    Used ONLY for "find chemicals like this one" — never for fact retrieval.
-- ---------------------------------------------------------------------
-- Into `extensions` (Supabase convention), not public: keeps the security
-- advisor quiet and matches where pgcrypto/uuid-ossp already live.
create extension if not exists vector with schema extensions;

create table if not exists public.chemical_embeddings (
  chemical_id uuid primary key
                references public.chemicals (id) on delete cascade,
  -- Must match settings.embedding_dim (Qwen text-embedding-v3 → 1024).
  embedding   extensions.vector(1024) not null,
  source_text text not null,   -- also the change detector for the refresh job
  updated_at  timestamptz not null default now()
);

create index if not exists idx_chemical_embeddings_hnsw
  on public.chemical_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- ANN search as an RPC — PostgREST cannot express `order by <=>`.
-- query_embedding is TEXT and cast here; see the migration for why.
create or replace function public.match_chemicals(
  query_embedding text,
  match_count     int  default 8,
  exclude_id      uuid default null,
  min_similarity  real default 0.0
)
returns table (
  chemical_id uuid,
  name_en     text,
  cas_number  text,
  similarity  real
)
language sql
stable
-- Explicit: the <=> operator and the vector type live in `extensions`, and
-- this must not depend on PostgREST's runtime search_path.
set search_path = public, extensions
as $$
  select
    ce.chemical_id,
    c.name_en,
    c.cas_number,
    (1 - (ce.embedding <=> query_embedding::extensions.vector))::real as similarity
  from public.chemical_embeddings ce
  join public.chemicals c on c.id = ce.chemical_id
  where (exclude_id is null or ce.chemical_id <> exclude_id)
    and (1 - (ce.embedding <=> query_embedding::extensions.vector)) >= min_similarity
  order by ce.embedding <=> query_embedding::extensions.vector
  limit match_count;
$$;

alter table public.chemical_embeddings enable row level security;

drop policy if exists "authenticated read chemical_embeddings"
  on public.chemical_embeddings;
create policy "authenticated read chemical_embeddings"
  on public.chemical_embeddings for select
  to authenticated
  using (true);
