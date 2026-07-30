-- Migration — P4 house knowledge: substitution + regulatory notes (2026-07-26)
--
-- The curated layer described in docs/AI_SEARCH_ARCHITECTURE.md §1c and §6.3.
-- Two tables holding BosTech's own judgement, written by managers from the
-- Inspector and given precedence over the model's chemistry knowledge.
--
-- WHY THIS EXISTS AT ALL (ARCHITECTURE.md §14.5): asked what replaces titanium
-- dioxide, the model needed judgement, not retrieval — the correct answer was
-- "nothing we stock does that job". A curated note is deterministic and cannot
-- hallucinate, which is why P4 was pulled ahead of the P3 embedding work.
--
-- Run once in the Supabase SQL editor. Idempotent.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- substitution_notes: "we used B in place of A, and here is when that holds"
-- ---------------------------------------------------------------------
create table if not exists public.substitution_notes (
  id               uuid primary key default gen_random_uuid(),
  from_chemical_id uuid not null references public.chemicals (id) on delete cascade,

  -- The substitute is stored as BOTH a name and (when we can resolve it) a
  -- chemical id. `to_chemical_id` is nullable on purpose: the most valuable
  -- note a manager can write is often about a substance we do NOT stock —
  -- that is a sourcing instruction, not missing data (ARCHITECTURE.md §14.3,
  -- "naming candidates we do not stock is a feature"). Storing only an id
  -- would make those notes impossible to write.
  to_chemical_id   uuid references public.chemicals (id) on delete set null,
  to_name          text not null,

  -- A note that says "do NOT swap these" is house knowledge too, and the
  -- assistant must not read it as an endorsement. Without this column every
  -- note is implicitly positive and a warning becomes unwritable.
  verdict          text not null default 'works'
                     check (verdict in ('works', 'conditional', 'avoid')),

  -- Free text, and the whole point: "GCC floor coatings, summer cure".
  -- A substitution is only ever valid in a context.
  context          text not null,
  author_id        uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- regulatory_notes: a recorded, dated, jurisdiction-scoped status.
-- ---------------------------------------------------------------------
-- The assistant is forbidden from asserting regulatory status from model
-- memory (§6.3: bans are jurisdiction-specific, dated, and often partial).
-- This table is the only in-house source it may cite — hence jurisdiction and
-- effective_date are first-class columns rather than prose: a status without
-- a where and a when is exactly the flattened claim we are avoiding.
create table if not exists public.regulatory_notes (
  id             uuid primary key default gen_random_uuid(),
  chemical_id    uuid not null references public.chemicals (id) on delete cascade,
  jurisdiction   text not null,          -- 'UAE', 'GCC', 'EU REACH', 'Saudi SASO'...
  status         text not null
                   check (status in ('banned', 'restricted', 'phase_out',
                                     'permitted', 'unclear')),
  effective_date date,                   -- nullable: often "announced, not yet dated"
  note           text not null,          -- the nuance: concentration limits, use classes
  source_url     text,                   -- what the manager read; rendered as a link
  author_id      uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Both tables are read on every Inspector open and on every assistant lookup,
-- always by chemical.
create index if not exists idx_substitution_notes_from
  on public.substitution_notes (from_chemical_id);
create index if not exists idx_substitution_notes_to
  on public.substitution_notes (to_chemical_id);
create index if not exists idx_regulatory_notes_chemical
  on public.regulatory_notes (chemical_id);

-- ---------------------------------------------------------------------
-- RLS — read for any authenticated user, writes only via the service key.
-- ---------------------------------------------------------------------
-- Same model as chemicals/listings: viewers must SEE house knowledge (it is
-- the point of capturing it), but every write goes through the backend, which
-- re-checks the admin/manager role itself. RLS is defence in depth here, not
-- the control.
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

-- Verify:
--   select count(*) from public.substitution_notes;
--   select count(*) from public.regulatory_notes;
