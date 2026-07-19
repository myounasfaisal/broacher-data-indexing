-- =====================================================================
-- Chemical Brochure Extraction Platform — database schema
-- =====================================================================
-- Run this ONCE in the Supabase SQL editor (SQL Editor -> New query -> paste
-- -> Run) before starting the backend.
--
-- Design notes:
--   * Row Level Security (RLS) is enabled on every table. Viewers (and the
--     anon key used by the frontend) can only ever READ chemical/listing data.
--     All writes go through the backend using the service_role key, which
--     bypasses RLS by design — so the backend is the only path that can insert.
--   * The backend still re-checks the caller's role on protected routes; RLS is
--     defense in depth, not the sole control.
--   * Names carry two fields everywhere: name_raw (as printed, any language)
--     and name_en (English), so search/sort/dedup use one consistent column.
-- =====================================================================

-- Needed for gen_random_uuid(); present by default on Supabase but explicit
-- here so the script is self-contained.
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles: one row per auth user, holding their role.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  -- admin: search + upload + user management; manager: search + upload;
  -- viewer: search only. (Live DB migrated via 'allow_manager_role'.)
  -- New signups start as 'viewer'; an admin promotes them on /admin/users.
  role       text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- chemicals: canonical, deduplicated chemical identities.
-- One row per real-world chemical; many listings point at it.
-- ---------------------------------------------------------------------
create table if not exists public.chemicals (
  id         uuid primary key default gen_random_uuid(),
  cas_number text unique,          -- nullable: not every chemical resolves to a CAS
  name_en    text not null,        -- canonical English name
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- companies: canonical supplier/manufacturer identities.
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- listings: one supplier's offer of a product, extracted from a brochure.
-- ---------------------------------------------------------------------
create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  chemical_id  uuid references public.chemicals (id) on delete set null,
  company_id   uuid references public.companies (id) on delete set null,
  company_name text not null,      -- denormalized fallback for queries/backwards compatibility
  name_raw     text not null,      -- exactly as printed, in the brochure's language
  name_en      text not null,      -- English translation for search/sort/dedup
  cas_number   text,
  price        numeric(14, 4),     -- nullable: not every brochure lists a price
  currency     text,               -- e.g. 'USD', 'CNY'; nullable
  purity       text,               -- kept as text, e.g. '99.5%', '>= 98%'
  needs_review boolean not null default false,  -- set by fuzzy-match dedup
  uploaded_by  uuid references auth.users (id) on delete set null,  -- admin audit
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes (spec section 6): keep search fast as the table grows.
-- ---------------------------------------------------------------------
create index if not exists idx_listings_cas_number on public.listings (cas_number);
create index if not exists idx_listings_name_en    on public.listings (name_en);
create index if not exists idx_listings_price       on public.listings (price);
create index if not exists idx_listings_chemical_id on public.listings (chemical_id);
create index if not exists idx_chemicals_name_en    on public.chemicals (name_en);

-- ---------------------------------------------------------------------
-- Trigger: give every new auth user a 'viewer' profile automatically.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles  enable row level security;
alter table public.chemicals enable row level security;
alter table public.companies enable row level security;
alter table public.listings  enable row level security;

-- profiles: a user may read their own profile (so the frontend can look up
-- its own role). No one may change roles via the anon/authenticated key —
-- role changes are an admin/DB operation via the service key.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- chemicals: any authenticated user may read. Writes only via service key
-- (which bypasses RLS), so no insert/update/delete policies are defined.
drop policy if exists "authenticated read chemicals" on public.chemicals;
create policy "authenticated read chemicals"
  on public.chemicals for select
  to authenticated
  using (true);

-- listings: any authenticated user may read. Same write model as chemicals.
drop policy if exists "authenticated read listings" on public.listings;
create policy "authenticated read listings"
  on public.listings for select
  to authenticated
  using (true);

-- companies: any authenticated user may read. Same write model as chemicals.
drop policy if exists "authenticated read companies" on public.companies;
create policy "authenticated read companies"
  on public.companies for select
  to authenticated
  using (true);

-- =====================================================================
-- Promoting a user to admin (run manually after they sign up):
--   update public.profiles set role = 'admin' where id = '<user-uuid>';
-- Find the uuid in the Supabase Auth -> Users table.
-- =====================================================================
