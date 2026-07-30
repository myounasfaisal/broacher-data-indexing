-- Migration — P3 semantic index: chemical embeddings (2026-07-26)
--
-- The narrow vector index from docs/AI_SEARCH_ARCHITECTURE.md §1b. It exists
-- for exactly ONE job keyword search cannot do: "find me chemicals LIKE this
-- one". It is NOT a retrieval path for facts — every row the assistant talks
-- about still comes from search_listings. See ARCHITECTURE.md §16.
--
-- The failure it fixes: no lexical rule separates "calcium carbonate" (one
-- substance) from "floor coatings" (two application words), so the widening
-- heuristic in agent_tools._search_catalog has to choose between a false
-- negative and offering dimethyl carbonate as a substitute.
--
-- ONE ROW PER CANONICAL CHEMICAL, not per listing. Listings are the same
-- substance repeated across suppliers; embedding each would multiply cost and
-- make a similarity search return twelve copies of one product. Listings are
-- joined back at answer time, so prices are always live and never stale
-- inside the index.
--
-- Run once in the Supabase SQL editor. Idempotent.

-- Supabase ships pgvector; this is a no-op where it is already installed.
-- Into `extensions` (Supabase convention), not public: keeps the security
-- advisor quiet and matches where pgcrypto/uuid-ossp already live.
create extension if not exists vector with schema extensions;

create table if not exists public.chemical_embeddings (
  chemical_id uuid primary key
                references public.chemicals (id) on delete cascade,
  -- 1024 = Qwen text-embedding-v3's default output width. THIS NUMBER IS
  -- BAKED IN: changing settings.embedding_dim without a migration that
  -- rewrites this column will fail every insert, loudly, which is the
  -- behaviour we want over a silently half-populated index.
  embedding   extensions.vector(1024) not null,
  -- What was actually embedded. Kept for debugging (a bad neighbour is almost
  -- always a bad source text) and, more importantly, as the change detector:
  -- the refresh job skips a chemical whose source text is byte-identical, so
  -- re-running it over an unchanged catalog costs nothing.
  source_text text not null,
  updated_at  timestamptz not null default now()
);

-- HNSW over cosine distance. Cosine because the source texts vary wildly in
-- length — a chemical with twelve listings' worth of details would dominate a
-- short one under L2 purely by magnitude.
create index if not exists idx_chemical_embeddings_hnsw
  on public.chemical_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------
-- Similarity search, as an RPC.
-- ---------------------------------------------------------------------
-- PostgREST cannot express `order by embedding <=> $1`, so the ANN query
-- lives here and the backend calls it by name.
--
-- `query_embedding` is TEXT, not vector, on purpose: the client sends
-- pgvector's own literal form ('[0.1,0.2,…]') as a JSON string and the cast
-- happens here. Declaring it as `vector` forces the caller to rely on
-- PostgREST's JSON-array coercion, which differs across versions.
--
-- `exclude_id` drops the query's own chemical from its own neighbours — the
-- same substance is not an alternative to itself (§5.1: same CAS, different
-- supplier is a sourcing question, not a substitution).
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
    -- pgvector's <=> is cosine DISTANCE; 1 - d reads as similarity, which is
    -- what the caller (and the model) reasons about.
    (1 - (ce.embedding <=> query_embedding::extensions.vector))::real as similarity
  from public.chemical_embeddings ce
  join public.chemicals c on c.id = ce.chemical_id
  where (exclude_id is null or ce.chemical_id <> exclude_id)
    and (1 - (ce.embedding <=> query_embedding::extensions.vector)) >= min_similarity
  order by ce.embedding <=> query_embedding::extensions.vector
  limit match_count;
$$;

-- ---------------------------------------------------------------------
-- RLS — read for authenticated users, writes via the service key only.
-- ---------------------------------------------------------------------
-- Same model as chemicals/listings. The refresh job runs in the worker with
-- the service key, which bypasses RLS.
alter table public.chemical_embeddings enable row level security;

drop policy if exists "authenticated read chemical_embeddings"
  on public.chemical_embeddings;
create policy "authenticated read chemical_embeddings"
  on public.chemical_embeddings for select
  to authenticated
  using (true);

-- Verify (after running the backfill: python -m app.embed_backfill):
--   select count(*) from public.chemical_embeddings;
--   select * from public.match_chemicals(
--     (select embedding::text from public.chemical_embeddings limit 1), 5);
