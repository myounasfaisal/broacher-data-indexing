> **SUPERSEDED — historical.** The single source of truth for how this system
> works is [ARCHITECTURE.md](../../ARCHITECTURE.md). Historical change log through the pipeline migration. Kept for archaeology; not a description of the current system.

---

# Changes — Roles, Upload Queue, Paginated Search (2026-07-14)

Companion to [`changes.json`](changes.json) (machine-readable summary of the same
changes). The README covers setup; this file explains **what exists now, how
the pieces connect, and why**, so future refactors know the flow.

---

## 1. Current database structure (LIVE — differs from db/schema.sql history)

The live Supabase DB was normalized by hand and has drifted from the original
`db/schema.sql`. This is the actual state:

```
companies                      chemicals
──────────────────────         ──────────────────────
id           bigint PK         id          uuid PK
company_name text              cas_number  text (unique)
contact_number bigint          name_en     text
email        text              created_at  timestamptz
created_at   timestamptz
      ▲                              ▲
      │ company_id (bigint FK)       │ chemical_id (uuid FK)
      │                              │
listings ─────────────────────────────
──────────────────────
id           uuid PK
chemical_id  uuid FK → chemicals.id
company_id   bigint FK → companies.id
name_raw     text      (as printed in the brochure)
name_en      text      (English translation — search/sort/dedup key)
cas_number   text
price        numeric
currency     text
purity       text      (free text, e.g. '99.5%')
needs_review boolean
uploaded_by  uuid
created_at   timestamptz

profiles
──────────────────────
id    uuid PK → auth.users
role  text CHECK (role IN ('admin','manager','viewer'))   ← migration 'allow_manager_role'
```

Key points:
- `listings.company_name` was **removed** (normalized away). The search API
  joins `companies(company_name)` and flattens it server-side
  (`_flatten_company()` in `backend/app/services/database.py`) so API
  responses still carry a flat `company_name`.
- `company_id` is a **bigint**, not uuid — reflected in `ListingOut`
  (backend) and `Listing` (frontend types).

## 2. Roles (3-tier)

| Role    | Search | Upload PDFs | Manage users |
|---------|--------|-------------|--------------|
| admin   | ✅     | ✅          | ✅           |
| manager | ✅     | ✅          | ❌           |
| viewer  | ✅     | ❌          | ❌           |

- Migration `allow_manager_role` widened the `profiles.role` CHECK constraint.
- Backend guards (`backend/app/dependencies.py`):
  - `require_user` — any valid JWT (search).
  - `require_uploader` — role in `('admin','manager')` (upload endpoints).
  - `require_admin` — role `'admin'` (user management).
- New signups still default to `admin` (trigger `handle_new_user` — unchanged;
  demote via the Users page).

### User management API (`backend/app/routers/users.py`, admin-only)

| Endpoint | Purpose |
|---|---|
| `GET /users` | All users (email via Supabase Admin Auth API) + role |
| `PATCH /users/{id}/role` | Set role to admin/manager/viewer. **Changing your own role is blocked (400)** so the last admin can't lock themselves out. |

Frontend: `frontend/src/pages/AdminUsersPage.tsx` (route `/admin/users`, nav
link "Users", admin-only). Role dropdown per row; own row locked.

## 3. Upload flow — server-side job queue

The old synchronous `POST /upload-brochure` endpoint was **removed**. Uploads
now flow through an in-memory job queue so progress is visible and **survives
page reloads** (state lives on the server, not in React):

```
Pick files (FolderPicker)
  → client validates size (≤20MB) + .pdf
  → POST /upload-jobs per file        ← file is now safe on the server
       (validates MIME + magic bytes + size, queues job)
  → single background worker processes jobs ONE AT A TIME
       stage: "Extracting products with the AI model…"
       stage: "Found N product(s) from <company> — resolving company…"
       stage: "Saving product i/N: <name>"
  → frontend polls GET /upload-jobs every 1.5s (stops when queue idle)
  → page reload? jobs re-fetched from server — nothing lost
```

| Endpoint (`backend/app/routers/upload.py`) | Auth | Purpose |
|---|---|---|
| `POST /upload-jobs` (202) | admin/manager | Validate + enqueue one PDF |
| `GET /upload-jobs` | admin/manager | Caller's jobs (drives progress UI + reload restore) |
| `POST /upload-jobs/clear-finished` | admin/manager | Remove caller's done/failed jobs |

Queue implementation: `backend/app/services/jobs.py`
- PDF bytes held in memory **only while queued/processing**, dropped on finish.
- Finished job records kept 6h, then pruned.
- 512MB pending-bytes cap → `503` when full.
- Rate limit on enqueue: 120/min (enqueue is cheap; the worker paces AI calls).
- **Backend restart clears the queue** (in-memory by design for this internal
  tool). If that ever matters, persist jobs to a DB table.

Frontend: `frontend/src/pages/AdminUploadPage.tsx` +
`components/upload/UploadQueue.tsx` (progress bar, per-file badge, live stage
line) + `UploadSummary.tsx` (totals when batch finishes).

> **Superseded by part 4** (see bottom of this file): the queue now supports
> per-file controls (pause/resume/cancel/restart/remove) and a per-file
> progress bar; statuses gained `paused`/`cancelled`; PDF bytes are kept for
> failed/cancelled jobs so they can be restarted.

## 4. Search — sorts, alphabet tabs, pagination

`GET /search` (any authenticated user) — new params:

| Param | Values | Notes |
|---|---|---|
| `sort` | `price_asc` `price_desc` `name_asc` `name_desc` | legacy `price`/`name` still map to `*_asc` |
| `letter` | single `a`–`z` | only chemicals whose `name_en` starts with it |
| `page` | ≥1 | server-side pagination |
| `page_size` | 1–15 | **hard cap 15** — 16+ is rejected (422) |
| `q`, `max_price`, `min_purity` | unchanged | `min_purity` filters in Python AFTER pagination, so a page may show slightly fewer than 15 rows |

Response: `{ count, page, page_size, total_pages, results }` — `count` is the
total across ALL pages, so the frontend renders numbered pagination; each
letter tab gets its own page count.

Frontend (`frontend/src/pages/SearchPage.tsx`):
- `SearchFilters.tsx` — text/price/purity + 4-way sort select (runs on "Search").
- `AlphabetBar.tsx` — All + A–Z tabs (fires immediately, resets to page 1).
- `Pagination.tsx` — Prev/Next + windowed page numbers (1 … 4 5 **6** 7 8 … 20).
- `keepPreviousData` keeps the current page visible (dimmed) while the next loads.

## 5. Auth UX

- **Signup auto-login**: `signUp()` returns the Supabase session (non-null when
  email confirmation is disabled) → LoginPage navigates straight to `/search`.
  Falls back to "check your email" if confirmation is on.
- Nav shows the user's role as a badge; links adapt (Upload for
  admin/manager, Users for admin).

## 6. Gotchas discovered (do not re-learn these the hard way)

1. **Supabase edge + `%` wildcard**: a literal `%` in a bare `.ilike()` filter
   param makes this project's Supabase Cloudflare edge throw **error 1101
   (Worker threw exception)**. Use PostgREST's `*` wildcard alias instead:
   `.ilike("name_en", "a*")`. `%` inside `.or_("...ilike.%x%...")` strings is
   fine.
2. **`uvicorn --reload` is unreliable on this Windows machine** (WatchFiles
   detects the first change, prints "Reloading…", then the worker never
   restarts — old code keeps serving *silently*). Run **without** `--reload`
   and restart manually after backend edits.
3. **PostgREST embedded joins** (`companies(company_name)`) come back as a
   nested object — flatten before Pydantic validation (see
   `_flatten_company()`), and remember the FK must exist for the embed to
   resolve (schema cache reload if "could not find a relationship").
4. Routers must NOT use `from __future__ import annotations` — breaks
   FastAPI's `UploadFile` param analysis.

## 7. File-by-file map of this change set

Backend:
- `app/dependencies.py` — added `require_uploader` (admin|manager)
- `app/services/jobs.py` — **new**: in-memory upload job queue + worker
- `app/services/database.py` — `list_users_with_roles`, `set_user_role`,
  `_flatten_company`, paginated/sorted/letter-filtered `search_listings`
  (returns `(rows, total)`)
- `app/routers/upload.py` — rewritten: `/upload-jobs*` endpoints (old
  `/upload-brochure` removed)
- `app/routers/users.py` — **new**: admin user management
- `app/routers/search.py` — pagination/sort/letter params, hard 15-row cap
- `app/schemas/chemical.py` — `UploadJobOut`, `UploadJobsResponse`,
  `ManagedUser`, `UsersResponse`, `RoleUpdate`; `SearchResponse` +
  page/total_pages; `ListingOut.company_id: int`
- `app/main.py` — mounted users router

Frontend:
- `src/lib/api.ts` — job/user endpoints, paginated search, `SortOption`
- `src/types/chemical.ts` — `UserRole` + manager, `UploadJob`, `ManagedUser`,
  `company_id: number`
- `src/hooks/useAuth.tsx` — `signUp` returns the session
- `src/pages/LoginPage.tsx` — auto-login after signup
- `src/components/ProtectedRoute.tsx` — `role: "admin" | "uploader"`
- `src/App.tsx` — Users nav/route, role badge, active-link styling
- `src/pages/AdminUsersPage.tsx` — **new**
- `src/pages/AdminUploadPage.tsx` — rewritten for the server queue
- `src/components/upload/UploadQueue.tsx` / `UploadSummary.tsx` — render
  server jobs
- `src/pages/SearchPage.tsx` — letter tabs + pagination + keepPreviousData
- `src/components/search/SearchFilters.tsx` — 4-way sort
- `src/components/search/AlphabetBar.tsx` / `Pagination.tsx` — **new**

DB:
- Migration `allow_manager_role` (live) + `db/schema.sql` comment updated.

---

# Changes — Duplicate handling & bilingual company names (2026-07-14, part 2)

## Problem

Re-uploading the same brochure (same filename OR renamed) created a full set of
**duplicate `listings`** and re-paid the entire pipeline (AI extraction +
PubChem + full-table fuzzy match) every time. Nothing deduplicated at the
document or listing level.

## Dedup at two levels

**1. PDF content hash (skips the whole pipeline for identical files).**
- New `documents` table: `content_hash text PK` (SHA-256 of the PDF bytes),
  `filename, company_id, product_count, uploaded_by, created_at`.
- `jobs.enqueue()` hashes the bytes; if the hash is in `documents` (a prior
  run) **or** in the in-memory `_inflight_hashes` set (a duplicate earlier in
  the *same* batch), the job is returned already `done` with
  `duplicate=True` and a "skipped" stage — **no AI call, no inserts**. The hash
  is content-based, so a renamed copy is caught too.
- On successful processing the worker calls `record_document()`; on failure it
  does not (so a retry is allowed). The in-flight hash is always released.

**2. Listing dedup key (collapses a genuinely identical offer from the same
supplier; a revised/overlapping brochure updates instead of duplicating).**
- `listings.dedup_key` = `company_id | name_raw(lower,trim) | price | currency
  | purity`, with a **unique index**. `insert_listing()` now upserts on it.
- **Keyed on `name_raw`, NOT `chemical_id`** — critical: the fuzzy matcher
  over-merges distinct product grades onto one `chemical_id` (we found live
  rows where "Calcium Zinc Stabilizer" and "Calcium Stearate" shared a
  `chemical_id`, likewise "SBR 1502"/"SBR 1712"). Keying on `chemical_id` would
  have deleted real products.
- **`company_id` is in the key**, so the *same chemical from different
  suppliers* always stays as separate listings (an explicit requirement).
- `database._normalize_price()` matches the SQL backfill formatting exactly
  (`55.0 -> "55"`, `99.5 -> "99.5"`, `None -> ""`) so Python-computed keys and
  the migration's backfilled keys agree. Verified against a live row.

## Bilingual company names

- `companies.company_name_en` added (mirrors chemicals' `name_raw`/`name_en`).
- Extraction prompt + `ExtractionResult` now return `company_name` (as printed)
  and `company_name_en` (English).
- `resolve_company(company_name, company_name_en)` matches an existing supplier
  on an exact case-insensitive match of **either** name (so a native-script and
  a romanized brochure from the same supplier unify), backfills a missing
  English name, and is deliberately conservative to avoid merging genuinely
  different suppliers. **Matching is done in Python** (fetch the small companies
  table + compare) because supplier names contain commas/parentheses
  ("Co., Ltd.") that would break a PostgREST `.or_()` filter string.
- Search exposes `companies(company_name, company_name_en)`; `ListingOut` and
  the frontend `Listing` carry both; the results table shows the English name
  with the original underneath.

## New DB objects / migrations

- Migration `dedup_documents_and_bilingual_company`: creates `documents`
  (+RLS read policy), adds `companies.company_name_en`, adds
  `listings.dedup_key` + backfills all existing rows + unique index. (Verified
  first that no *true* duplicates existed under the `name_raw` key, so the
  unique index applied without dropping data.)

## Files touched (part 2)

- `backend/app/services/database.py` — bilingual `resolve_company`,
  `make_dedup_key`/`_normalize_price`, upsert `insert_listing`,
  `find_document`/`record_document`, `company_name_en` in SEARCH_COLUMNS +
  `_flatten_company`
- `backend/app/services/jobs.py` — hash + in-flight dedup in `enqueue`, document
  recording in the worker, `duplicate`/`content_hash`/`company_id` job fields
- `backend/app/schemas/chemical.py` — `company_name_en` on `ExtractionResult`
  and `ListingOut`; `duplicate` on `UploadJobOut`
- `backend/app/prompts/extraction_prompt.py` — return `company_name_en`
- `frontend/src/types/chemical.ts` — `company_name_en`, `UploadJob.duplicate`
- `frontend/src/components/search/ResultsTable.tsx` — English supplier name +
  original underneath
- `frontend/src/components/upload/UploadQueue.tsx` /`UploadSummary.tsx` —
  "duplicate" badge + "N duplicates skipped" in the summary

---

# Changes — CAS-first chemical resolution (2026-07-14, part 3)

Rewrote `backend/app/services/dedup.py` to a simple, predictable flow that fixes
the over-merging found in part 2:

```
Has a CAS number?
  YES → match on CAS ONLY
          exact CAS hit → reuse that chemical
          no CAS hit    → create a new canonical chemical
        (name is NOT consulted — CAS is authoritative, so a CAS-bearing
         product can never fuzzy-merge onto a differently-named chemical)
  NO  → resolve by English name
          exact (case-insensitive) name hit → reuse (confident, no review)
          fuzzy similarity >= 97 → reuse, flagged needs_review
          otherwise → create a new canonical chemical
```

What changed vs. before:
- **CAS present now short-circuits.** Previously a product WITH a CAS still fell
  through to exact-name + fuzzy matching if the CAS wasn't found — that's how
  distinct products (e.g. "Calcium Zinc Stabilizer" / "Calcium Stearate") got
  merged onto one `chemical_id`. Now a CAS is authoritative: match it or create
  new, full stop.
- **Fuzzy threshold raised 90 → 97** (`FUZZY_THRESHOLD`), so only near-identical
  names auto-merge (still flagged `needs_review`).
- **PubChem lookup removed.** The old "no CAS → ask PubChem to resolve one"
  step is gone (not part of the flow, and it added network latency + a
  dependency). `httpx` is no longer used directly by `dedup.py`; `requirements`
  keeps it only as a transitive dep.

Trade-off worth knowing: with CAS authoritative, a name-only chemical created
earlier (CAS null) and a later CAS-bearing brochure for the same substance can
produce two `chemicals` rows (one with CAS, one without). That's the intended
"CAS wins" behaviour; the listings themselves are unaffected (they key on
`name_raw` + `company_id`).

Verified with a mocked-DB unit check: known CAS reuses; unknown CAS creates new
and ignores a matching name; exact name reuses; fuzzy <97 creates new; fuzzy
>=97 merges with `needs_review`.

Files: `backend/app/services/dedup.py` (rewritten),
`backend/requirements.txt` (comment).

---

# Changes — Per-file upload controls & progress (2026-07-14, part 4)

## What

Every file in the upload queue now has its **own progress bar** and its **own
control buttons** — pause, resume, cancel, restart, remove — instead of one
global progress bar for the whole batch.

## Controls (per file)

| Action  | Valid when            | Effect |
|---------|-----------------------|--------|
| pause   | queued                | → paused; the worker skips it |
| resume  | paused                | → queued |
| cancel  | queued/paused/processing | → cancelled |
| restart | failed/cancelled      | → queued again (re-runs) |
| remove  | any                   | drops the job from the list |

The server tells the frontend which actions are valid via `can_pause` /
`can_resume` / `can_cancel` / `can_restart` / `can_remove` flags on each job, so
the UI only shows applicable buttons.

**Honest limitation:** a file that is actively *processing* can be **cancelled**
but not **paused** — its AI extraction call can't be interrupted (it finishes in
the background), so cancel drops the result and stops saving further products
rather than truly killing the call. Pause therefore only applies to files still
waiting in the queue.

## How it works

- **Worker rewritten** (`backend/app/services/jobs.py`) from a plain
  `asyncio.Queue` to a **scan-based loop + wake `Event`**: it repeatedly picks
  the oldest `queued` job and sleeps on the event when idle. This lets a job's
  state change (pause/cancel) while it waits, which a fixed queue couldn't
  express. Statuses are now
  `queued | processing | paused | done | failed | cancelled`.
- **Cancel mid-flight**: `_process` checks a `cancel_requested` flag at each
  checkpoint (before extraction, after the AI call, before each product save)
  and raises an internal `JobCancelled`. Products already saved stay (they're
  valid data); the stage notes "N product(s) were already saved".
- **Restart keeps the bytes**: PDF bytes are now retained for `failed` /
  `cancelled` jobs (dropped only on success or removal) so a restart re-runs
  without a re-upload. Re-runs are safe/idempotent thanks to the listing dedup
  key. The document-hash reservation is held while a job can still restart.
- **Endpoint**: `POST /upload-jobs/{job_id}/action` with body
  `{action: pause|resume|cancel|restart|remove}` → returns the updated job, or
  `{"removed": true}`. Guarded by `require_uploader`; only the caller's own jobs.

## Frontend

- **`UploadJobRow.tsx`** (new) — per-file row: animated "fake" progress bar
  (queued → creeps during extraction → tracks "saving product i/N" → 100%,
  colored by status) + icon buttons (lucide-react) shown per the `can_*` flags,
  each with its own busy spinner.
- **`UploadQueue.tsx`** — now renders one `UploadJobRow` per job plus optimistic
  **"Uploading…"** placeholder rows for files still being sent from the browser
  (the client `POST` phase), so all three phases (uploading → fetching →
  feeding) show per file.
- **`AdminUploadPage.tsx`** — tracks in-flight uploads, wires `handleAction` to
  `api.jobAction`, polls every 1.2s while active.
- Types: `UploadJobStatus`, `JobAction`, `can_*` flags on `UploadJob`.

## Verified

- State machine + worker: 16-check async test (pause skips a queued job; resume
  processes it; cancel on queued→cancelled and on processing→flag set; restart
  only with bytes; remove on done drops it; cross-user action rejected;
  done-jobs drop bytes). All pass.
- Live HTTP wiring: list 200, unknown-job action 400, invalid action 422,
  no-auth 401.
- Frontend `tsc --noEmit` clean; `vite build` succeeds.

## Files (part 4)

- `backend/app/services/jobs.py` (worker rewrite + `apply_action` + `can_*`)
- `backend/app/routers/upload.py` (`POST /upload-jobs/{id}/action`)
- `backend/app/schemas/chemical.py` (`JobActionRequest`, new statuses, `can_*`)
- `frontend/src/components/upload/UploadJobRow.tsx` (new)
- `frontend/src/components/upload/UploadQueue.tsx` (per-file rows + uploading)
- `frontend/src/components/upload/UploadSummary.tsx` (counts cancelled)
- `frontend/src/pages/AdminUploadPage.tsx` (actions + optimistic uploads)
- `frontend/src/lib/api.ts` (`jobAction`), `frontend/src/types/chemical.ts`

---

# Changes — Search typeahead / autocomplete (2026-07-14, part 5)

## What

The search box now shows a **live typeahead dropdown**. As the viewer types,
matching **chemical names / CAS numbers** and **suppliers** appear grouped under
the box (each with a listing count); picking one — click or ↑/↓ then Enter —
drops it into the box and runs the search **immediately** (skips the 300ms
free-text debounce). This is on top of the debounced free-text search that
already existed; ignoring the dropdown still works exactly as before.

## Backend

- **New `GET /suggest`** (`app/routers/search.py`, same `search` tag, guarded by
  `require_user`): params `q` (1–100 chars, required) and `limit` (1–15,
  default 8). Returns `{ suggestions: Suggestion[] }`.
- **`database.suggest(q, limit)`**:
  - Chemicals: one bounded `listings` query (`or_` ilike over
    `name_en` / `name_raw` / `cas_number`, cap 500 rows), grouped by English
    name (case-insensitive), most-listed first, top `limit`. Reuses
    `_sanitize_filter_value` (empty after sanitizing → `[]`).
  - Suppliers: scans the small `companies` table in Python (names contain
    `,`/`(` that break a PostgREST filter — same reasoning as `resolve_company`)
    and runs a capped **≤4** per-supplier `count="exact"` query so a broad prefix
    can't fan out.
- `Suggestion` / `SuggestResponse` added to `app/schemas/chemical.py`.

## Frontend

- **`components/search/SearchBox.tsx`** (new) — owns the input + dropdown:
  ~180ms local debounce, react-query (`staleTime: 30s`), keyboard nav
  (↑/↓/Enter/Esc), outside-click close, `onMouseDown` (not click) so a pick
  registers before blur, and bolds the matched substring. `combobox`/`listbox`
  ARIA roles.
- **`SearchFilters.tsx`** — the inline input was replaced by `<SearchBox>`; new
  `onCommitQ` prop threads a picked suggestion up.
- **`SearchPage.tsx`** — `commitQ()` sets `q` **and** `debouncedQ` at once so a
  pick searches instantly; still clears the letter filter and resets to page 1.
- `api.suggest()` + `Suggestion` type added.

## Verified

- Live HTTP against the real DB: no-auth `401`; `q='cal'` → Calcium* chemicals
  (with CAS) + suppliers with real counts; `q='64'` matches CAS substrings;
  nonsense → empty; empty `q` and `limit=101` → `422`.
- Frontend `tsc --noEmit` clean; `vite build` succeeds.

## Files (part 5)

- `backend/app/routers/search.py`, `backend/app/services/database.py`,
  `backend/app/schemas/chemical.py`
- `frontend/src/components/search/SearchBox.tsx` (new),
  `frontend/src/components/search/SearchFilters.tsx`,
  `frontend/src/pages/SearchPage.tsx`, `frontend/src/lib/api.ts`,
  `frontend/src/types/chemical.ts`

---

# Changes — Upload history & admin audit (2026-07-15, part 6)

## What

The Upload page now has a persistent **Upload history** card (below the live
queue). Unlike the in-memory queue (lost on backend restart), this reads the
`documents` ledger, so it shows **past uploads with their date, supplier, and
how many listings each added** — and survives restarts.

- **Managers** see their own uploads.
- **Admins** get an "Everyone / My uploads" toggle; the org-wide view adds a
  **"Uploaded by"** column (email, via the Admin Auth API) — who uploaded which
  PDF and when.
- **Any row expands** ("View listings") to show **exactly which listings that
  upload produced** — name (EN), as-printed, CAS, price, purity. Loaded lazily
  per row.

## How "which listings" is tracked

- New column **`documents.listing_ids uuid[]`** (migration
  `add_documents_listing_ids`). The worker collects the id of every listing it
  inserts for a job (`insert_listing` already returns the row) and passes them
  to `record_document(... listing_ids=...)`. This is **immutable per upload**:
  even if a later re-upload upserts the same listing (dedup key), the earlier
  document still records what *it* produced — more accurate than a reverse
  `listings.document_hash` pointer, which a later upload would overwrite.
- **Limitation:** the 10 documents that predate this change have empty
  `listing_ids`, so their "View listings" shows nothing (their date / who /
  count are all intact). The detail populates for every upload from now on. A
  backfill would be guesswork (multiple uploads share a company+uploader), so
  it was intentionally skipped.

## Backend

- `database.record_document(..., listing_ids)`; new helpers `list_documents`
  (own or org-wide), `get_document`, `get_listings_by_ids` (order-preserving),
  `get_user_emails`.
- `routers/upload.py`:
  - `GET /uploads/history` (uploader) — caller's own uploads.
  - `GET /uploads/history/all` (**admin**) — every upload + uploader email.
  - `GET /uploads/{content_hash}/listings` (uploader; admin sees any, a manager
    only their own → `403` otherwise, `404` for an unknown hash).
- Schemas: `UploadHistoryItem`, `UploadHistoryResponse`,
  `DocumentListingsResponse`.
- `jobs.py`: `UploadJob.listing_ids` (reset on restart), populated in `_process`,
  flushed to the ledger in `_finalize`.

## Frontend

- **`components/upload/UploadHistory.tsx`** (new) — history table, admin
  scope toggle, per-row lazy "View listings" expander.
- **`AdminUploadPage.tsx`** — history card added; `useRole()` gates the admin
  view; the history query is invalidated when the queue goes idle so finished
  uploads appear without a reload.
- `api.listUploadHistory(all)` / `api.getUploadListings(hash)`;
  `UploadHistoryItem` / `DocumentListings` types.

## Verified

- Migration applied to the live DB. Live HTTP (signed JWTs): `history` (own)
  `200`; `history/all` (admin) `200` with emails; non-admin → `403`; unknown
  hash → `404`; no-auth → `401`. Seeded a temp `documents` row with real
  `listing_ids` → the listings endpoint returned exactly those 3 rows
  (order preserved, supplier/name/CAS correct), then removed the temp row.
- Backend byte-compiles; frontend `tsc` + `vite build` clean.

## Files (part 6)

- `backend/app/services/jobs.py`, `backend/app/services/database.py`,
  `backend/app/routers/upload.py`, `backend/app/schemas/chemical.py`
- DB migration `add_documents_listing_ids`
- `frontend/src/components/upload/UploadHistory.tsx` (new),
  `frontend/src/pages/AdminUploadPage.tsx`, `frontend/src/lib/api.ts`,
  `frontend/src/types/chemical.ts`

---

# Changes — DB error-handling hardening (2026-07-15, part 7)

## Why

`database.py` had almost no error handling (one `try/except` in the whole file),
so a Supabase/PostgREST/network failure on a **synchronous request path**
(search, `/suggest`, `/uploads/history*`, `/users`) surfaced as a raw **500**.
The upload worker already caught DB errors; the read paths did not.

## What

- **`DatabaseError`** + a **`@_db_op`** decorator in `database.py`. Every
  data-access helper (17 of them) is wrapped: any underlying client exception
  (postgrest `APIError`, `httpx` network error, gotrue auth error, the
  Cloudflare **1101** edge bug) is logged once with a stack trace and re-raised
  as a single `DatabaseError`. Callers now face one predictable type instead of
  the provider's exception zoo. (It's an `Exception` subclass, so the upload
  worker's broad catch still handles it and marks the job failed.)
- **Global handler in `main.py`** maps `DatabaseError` → **503** with a generic
  `detail` ("temporarily unavailable"), so internal errors aren't echoed to
  clients and the frontend's `extractError` shows a sensible message.
- **Frontend `SearchBox`** no longer swallows `/suggest` failures — the dropdown
  shows "Suggestions unavailable — you can still press Enter to search" instead
  of silently vanishing (the exact thing that made an earlier stale-backend bug
  undiagnosable).

## Not done (by choice)

Full repository pattern / domain models / DB-swap interface — over-engineering
for an internal tool. `database.py` already is the single DB seam
(`get_client()` appears nowhere else); this part hardens it without adding
layers. Input validation was already strong at the API boundary (Query
regex/bounds, upload MIME+magic+size, `q` sanitized against PostgREST filter
injection) and was left as-is.

## Verified

- In-process (TestClient, DB forced to raise): `@_db_op` converts a raw
  `RuntimeError` → `DatabaseError`; `/search` and `/uploads/history/all` return
  **503** with the generic detail (not 500); after restoring, `/search` → **200**.
- Backend byte-compiles; frontend `tsc` + `vite build` clean.

## Files (part 7)

- `backend/app/services/database.py` (`DatabaseError`, `@_db_op` on all helpers)
- `backend/app/main.py` (global `DatabaseError` → 503 handler)
- `frontend/src/components/search/SearchBox.tsx` (surface suggest errors)

---

# Changes — Backend Docker + provider-doc fixes (2026-07-15, part 8)

## Docker (backend only)

- **`backend/Dockerfile`** — `python:3.11-slim`, deps installed from
  `requirements.txt` in a cached layer (all deps ship manylinux wheels — no
  compiler/system libs needed), runs `uvicorn app.main:app` on `0.0.0.0:8000`
  **without `--reload`** as a non-root user (uid 10001), with a `/health`
  HEALTHCHECK.
- **`backend/.dockerignore`** — keeps the context small and, crucially, keeps
  `.env` out of the image (config is injected at run time).
- **`docker-compose.yml`** (repo root) — `docker compose up --build` builds the
  backend, loads `backend/.env` via `env_file`, publishes `:8000`. Frontend is
  intentionally not containerized (static Vite build).
- **Verified with a real build/run**: `docker compose build` succeeds (all deps
  from wheels, ~455MB image); container comes up `healthy`, `/health` → 200,
  `/search` + `/suggest` → 401 without a JWT, and an authenticated `/search`
  through the container returned live Supabase data (200, real rows) — confirming
  env injection + DB reachability from inside the container.

## Provider-doc fixes

README + `backend/.env.example` said "two providers, Gemini default". Corrected
to reflect the code: **three** providers (`qwen` / `gemini` / `claude`), with
`qwen` the `config.py` default, and Qwen doing double duty (extraction provider
*and* the OCR engine for scanned PDFs on any provider). No code change.

## Files (part 8)

- `backend/Dockerfile`, `backend/.dockerignore`, `docker-compose.yml` (new)
- `readme.md`, `backend/.env.example` (provider docs)

---

# Changes — Forgot-password flow, viewer signups (doc fix), UI polish (2026-07-16, part 9)

## 1. Forgot-password / reset flow

- **LoginPage** now has three modes — sign in / sign up / **forgot password**
  (a "Forgot password?" link sits next to the password label). The forgot form
  sends a Supabase recovery email via
  `resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`.
- **New `/reset-password` page**
  (`frontend/src/pages/ResetPasswordPage.tsx`): the emailed link lands here;
  supabase-js consumes the recovery token from the URL hash
  (`detectSessionInUrl`) and signs the user into a temporary session, then the
  page shows a new-password + confirm form (`auth.updateUser`) and drops them
  on `/search`, signed in. Because the token is consumed **asynchronously**,
  the page waits ~1.5s (skeleton) before declaring a link invalid — otherwise
  every valid link would flash "expired" first. Truly invalid/expired links
  get a clear message and a button back to sign-in.
- `useAuth` gained `resetPassword(email)` and `updatePassword(password)`; the
  nav chrome is hidden on `/reset-password` (like `/login`).
- **⚠ Manual step (Supabase dashboard, one-time):** add
  `http://localhost:5173/reset-password` (and the production equivalent when
  deploying) under **Authentication → URL Configuration → Redirect URLs**,
  or the emailed link will bounce to the Site URL instead of the reset page.
  This is dashboard-only config — no SQL migration or env var can set it.

## 2. Signup default role — documentation fix (NO DB change)

The plan was to flip the new-signup role from `admin` to `viewer`.
**Investigation showed the live DB has ALWAYS defaulted to `viewer`**: the
applied `initial_schema` migration (2026-07-14) created both
`profiles.role default 'viewer'` and `handle_new_user()` inserting
`'viewer'`, and no later migration touched either (verified against
`pg_get_functiondef` + `information_schema` + the stored migration SQL). The
repo's `db/schema.sql` was edited to say `'admin'` at some point — and the
README, parts 1–2 of this file, and `changes.json` repeated it — but that
edit **was never applied to the live database**.

- **No migration needed** — live behaviour was already the safe one.
- `db/schema.sql` corrected back to `'viewer'` (column default + trigger).
- README roles section rewritten: viewer default + a "bootstrapping the first
  admin" one-liner (`update public.profiles set role='admin' where id=...`).
- Earlier claims in this file that "new signups default to admin" were wrong
  about the live DB — trust this section.

## 3. UI polish

- **New `ui/skeleton.tsx` primitive**; every "Loading…" text state replaced
  with skeletons: SearchPage results (`ResultsSkeleton` rows), AdminUsersPage
  rows, ProtectedRoute full-page shape.
- **Review-badge tooltip** (`ResultsTable`): hovering or keyboard-focusing the
  amber "review" badge now explains it — the AI matched the listing to its
  chemical by name similarity (no exact CAS/name hit) and an admin should
  verify. Pure-CSS tooltip (`group-hover`/`group-focus-within`), no library;
  `tabIndex` + `aria-label` for accessibility.
- **Responsive results**: below the `md` breakpoint the 6-column table is
  replaced by one card per listing (name + review badge + price on top;
  CAS / purity / supplier beneath), so nothing overflows on phones. `md+` is
  the unchanged table. Both views share the same `SupplierName`/`ReviewBadge`
  helpers.

## Verified

- Live-DB checks: `handle_new_user()` definition and `profiles.role` column
  default both already `'viewer'`; migration list contains no role-default
  change after `initial_schema`.
- Frontend: `tsc --noEmit` clean; `vite build` succeeds (13.6s; pre-existing
  chunk-size warning only).

## Files (part 9)

- `frontend/src/hooks/useAuth.tsx` — `resetPassword` / `updatePassword`
- `frontend/src/pages/LoginPage.tsx` — three modes (signin/signup/forgot)
- `frontend/src/pages/ResetPasswordPage.tsx` — **new**
- `frontend/src/App.tsx` — `/reset-password` route + nav hide
- `frontend/src/components/ui/skeleton.tsx` — **new**
- `frontend/src/components/search/ResultsTable.tsx` — tooltip + mobile cards
  + `ResultsSkeleton`
- `frontend/src/components/ProtectedRoute.tsx`,
  `frontend/src/pages/SearchPage.tsx`,
  `frontend/src/pages/AdminUsersPage.tsx` — skeleton loading states
- `db/schema.sql`, `readme.md`, `changes.json` — viewer-default corrections;
  README documents the reset-redirect allowlist step

---

# Changes — AI search agent, flexible details (JSONB), product page (2026-07-17, part 10)

## 1. AI search agent (`POST /search/ai`)

**Design rule (non-negotiable): the model only converts the user's sentence
into structured filters.** It never generates, states, or summarizes chemical
data — every result row comes from `database.search_listings()`, the *same*
function the manual filter search calls. There is exactly one query path.

- `app/prompts/nl_search_prompt.py` (**new**) — instructs the model to return
  ONLY the filter JSON (`name_query`, `cas_number`, `min_price`, `max_price`,
  `min_purity`, `max_purity`, `details_query`, `sort`). Attributes that aren't
  fixed columns (color, hazard class, storage, …) map to the free-text
  `details_query` — attribute names are NOT hardcoded into the schema.
- `app/services/nl_search.py` (**new**) — `parse_query()` calls the provider
  via `extraction.complete_text(...)` (**new** in `extraction.py`: text-only
  completion reusing the same three clients + retry policy — no fourth
  provider code path), parses with the same fence-tolerant JSON parser, and
  validates into `InterpretedFilters` (pydantic: trims/caps text, clamps
  numeric bounds, unknown sort → `price_asc`, extra keys ignored). Any
  failure → `NLSearchError` → clean **502** — it never "answers" instead.
- **`SEARCH_PROVIDER`** env (config.py + `.env.example`): provider for this
  text-only call; empty = same as `EXTRACTION_PROVIDER`.
- Router (`routers/search.py`): `POST /search/ai {query}` →
  `{interpreted_filters, count, page, page_size, total_pages, results}`.
  Auth = `require_user` (all three roles, same audience as `GET /search`);
  **rate-limited 20/min** via the shared slowapi limiter (each call hits the
  external LLM API — same budget-protection pattern as uploads). The LLM call
  runs via `asyncio.to_thread` so the event loop stays responsive.
- **`GET /search` gained matching manual params** (`cas`, `min_price`,
  `max_purity`, `details_q`) so the frontend can re-run an AI interpretation
  through the plain endpoint when the user edits chips — see frontend below.

## 2. Flexible details storage (JSONB) + supplier website

- **Migration `add_listing_details_and_website`** (tracked, applied):
  `listings.details jsonb`, `listings.company_website text`, GIN index on
  `details`, and a **PostgREST computed field** `details_text(listings)`
  (returns `details::text`, EXECUTE revoked from client roles / granted to
  `service_role`) so `details_q` filters **server-side** with correct
  pagination counts (`.ilike("details_text", "*q*")`) instead of Python
  post-filtering.
- **Extraction prompt** (the one shared `EXTRACTION_PROMPT` used by all three
  providers — it was already centralized, nothing to unify): products gain a
  `details` object ("whatever keys fit what's actually printed; omit absent
  fields — never null-fill") and the brochure gains `company_website` (only a
  URL actually printed; never guessed).
- Schemas: `ExtractedProduct.details`, `ExtractionResult.company_website`,
  `ListingOut.details/company_website` (None on search rows — only the detail
  endpoint selects them). `jobs._process` threads both into `insert_listing`.
  The dedup key is unchanged (details don't affect identity), so a re-upload
  of a revised brochure *updates* details via the existing upsert.
- **Limitation (same class as the part-6 one):** listings extracted before
  this change have `details = null` and no website — and their PDFs are
  content-hash-deduped, so re-uploading the same file won't re-extract.
  Backfill needs a "re-process" feature (already on the PROPOSAL roadmap).

## 3. Product detail page

- `GET /listings/{id}` (`require_user`) — full listing incl. details/website
  (`database.get_listing`, `DETAIL_COLUMNS`); non-UUID or unknown id → 404.
- `frontend/src/pages/ProductDetail.tsx` (**new**) at `/product/:id` (any
  authenticated user): fixed fields as a spec grid, then **`details` rendered
  dynamically** — loop over whatever keys exist, `snake_case`/`camelCase`
  humanized to labels, values formatted best-effort (arrays joined, nested
  objects flattened to "Key: value; …"), null/empty values dropped so a
  2-field listing shows 2 rows and a 10-field one shows 10, with no
  "null"/"{}" artifacts. The details card is omitted entirely when empty.
- **Supplier website link**: rendered only when present, labeled
  "Supplier website *(general site, as printed on the brochure)*" —
  deliberately NOT "view this product", and no URL guessing/construction.
  Opens `target="_blank" rel="noopener noreferrer"`; scheme-less printed URLs
  get `https://` prepended.
- Result rows (desktop table + mobile cards) link the product name to the page.

## 4. Frontend AI search UX

- `components/search/AISearchBar.tsx` (**new**) — free-text bar ABOVE the
  existing manual filters (additive; nothing removed), plus `FilterChips`:
  the interpretation rendered as removable chips (`“sodium hydroxide” ×`,
  `price ≤ 5 ×`, `purity ≥ 99% ×`, `details: “white” ×`) so the user verifies
  what was understood before trusting results.
- `SearchPage` — AI mode is a third mutually-exclusive mode next to typing /
  letter-browsing. The interpreted filters drive the normal `GET /search`
  (chips edits and page changes re-query the plain endpoint), results render
  through the **existing** `ResultsTable` — no new results-rendering logic.
  Empty AI results with a `details_query` chip show a "matched best-effort"
  hint, per the honest-limitation rule.

## Gotcha discovered (part 10)

- **`from __future__ import annotations` + slowapi decorator breaks FastAPI
  body params**: with postponed annotations, an endpoint wrapped by
  `@limiter.limit(...)` had its pydantic body model degrade into a *query*
  parameter (422 "Field required in query"). Same family as the part-1
  UploadFile gotcha. Fix: no future-annotations import in routers, period.

## Verified

- Live in-process suite (TestClient + real DB + signed JWTs,
  scratchpad/feature_test.py): **19/19 pass** — no-auth 401s; listing detail
  200 with seeded details/website; non-UUID + unknown-UUID 404; `details_q`
  via the computed field returns exactly the seeded row with `count == 1`
  (server-side proof); new manual params 200; **mocked-parser AI search
  returns row-identical results to `GET /search` with the same filters**
  (the acceptance rule, verified literally); live Qwen parse of "cheapest
  white PVC resin under 900 with purity over 90%" → `max_price 900`,
  `min_purity 90`, `details_query "white"`, `sort price_asc`; empty query
  422; 21st+ burst request → **429**. Seeded test details were removed after
  the run (fabricated data doesn't belong in the live DB).
- Backend byte-compiles; frontend `tsc --noEmit` + `vite build` clean.

## Files (part 10)

- Backend: `app/config.py` (SEARCH_PROVIDER), `app/schemas/chemical.py`
  (details/website fields, `InterpretedFilters`, `AISearchRequest/Response`),
  `app/prompts/extraction_prompt.py` (details + website),
  `app/prompts/nl_search_prompt.py` (**new**), `app/services/extraction.py`
  (`complete_text`), `app/services/nl_search.py` (**new**),
  `app/services/database.py` (`get_listing`, `DETAIL_COLUMNS`, new filters),
  `app/services/jobs.py` (thread details/website into inserts),
  `app/routers/search.py` (new endpoints/params), `backend/.env.example`
- DB: migration `add_listing_details_and_website`
- Frontend: `components/search/AISearchBar.tsx` (**new**),
  `pages/ProductDetail.tsx` (**new**), `pages/SearchPage.tsx` (AI mode),
  `components/search/ResultsTable.tsx` (product links; exports
  `formatPrice`/`ReviewBadge`), `App.tsx` (route), `lib/api.ts`
  (`aiSearch`/`getListing`/new params), `types/chemical.ts`

---

# Changes — Currency normalization (USD/PKR), listing edit/delete, undo upload (2026-07-17, part 11)

## 1. The price-sort bug, root-caused

User report: "most expensive" showed pages of chemicals with no price.
Two independent causes, both fixed:

1. **postgrest-py never emits `.nullslast`.** The pinned version's `order()`
   only appends `.nullsfirst` when `nullsfirst=True` — passing `False` (as the
   old code did) just drops the modifier, and Postgres defaults to **NULLS
   FIRST for DESC**. With 548 of 576 listings unpriced, `price_desc` page 1
   was 100% null rows. Fix: `database._order_nulls_last()` writes the order
   query param explicitly (`price_usd.desc.nullslast`).
2. **Mixed currencies made "cheapest" meaningless** (¥7600/ton sorted above
   $950/ton). Fix: price sorts/bounds now use a normalized `price_usd`.

## 2. Currency normalization (USD + PKR)

- **Migration `add_price_usd_and_exchange_rates`**: `listings.price_usd`
  (+index) and an `exchange_rates` snapshot table (code → units-per-USD).
- **New `services/rates.py`**: rates from **open.er-api.com** (free, no API
  key), cached in memory 12h → persisted to `exchange_rates` → falls back to
  the DB snapshot, then to a hardcoded seed — conversion never hard-fails.
  `normalize_currency()` handles what extraction actually produces
  (live data: `Yuan/ton`, `USD/ton`, `Yuan/mt`, symbols): token before "/",
  alias-mapped (Yuan/RMB/元/¥ → CNY, etc.).
- `insert_listing` (and admin edits) compute `price_usd` server-side; all 28
  existing priced rows were **backfilled** via the real service (166 rates
  fetched; CNY 6.78, PKR 277.9 at run time).
- **Responses carry `price_usd` (stored) + `price_pkr`** (computed at read
  time from the current rate, so it never goes stale). The UI shows
  "≈ $1,121 · ₨311,533" under the printed price (skipping whichever currency
  the original already is), with a "current rates" tooltip.
- **Semantics change:** `min_price`/`max_price` (manual filter AND the AI
  agent's bounds) now compare against **USD**; the UI label says
  "Max price (USD)" and the NL prompt says so too. Rows whose price can't be
  normalized are excluded when a bound is set.
- New `priced_only` param + "Only listings with a price" checkbox — directly
  addresses the flood of unpriced rows when browsing by price.
- Conversions are **current-rate approximations**, not historical values —
  deliberately, for comparison shopping.

## 3. Listing edit/delete (admin data-fix, no SQL)

- `PATCH /listings/{id}` (**admin**): change name_raw/name_en/CAS/price/
  currency/purity/needs_review — only fields present in the body change.
  Recomputes `dedup_key` and `price_usd` server-side; a collision with an
  existing identical listing → **409** with a clear message
  (`DuplicateListingError`, its own handler in main.py so it doesn't fall
  into the generic 503). Unchecking needs_review is the lightweight "review
  resolution" flow.
- `DELETE /listings/{id}` (**admin**).
- Endpoints live in **new `routers/listings.py`** (GET moved there from
  search.py).
- Frontend: **`components/listing/ListingAdminCard.tsx`** on the product
  page (admins only) — prefilled form, diff-only PATCH, delete with confirm,
  search cache invalidated.

## 4. Undo upload

- `DELETE /uploads/{content_hash}` (admin = any; manager = own): deletes the
  listings that upload produced **and** its ledger row, so the same PDF can
  be re-uploaded fresh. **Shared-listing safe**: ids that also appear in
  another document's `listing_ids` are kept (PostgREST `ov` array-overlap
  check) — deleting them would corrupt the other upload's audit. Returns
  `{deleted_listings, kept_shared}`.
- Frontend: red **Undo** button per history row (confirm dialog; toast shows
  deleted/kept counts; history + search caches invalidated).

## 5. "Find this product online" (product page)

Honest product lookup instead of guessed URLs: a web-search link scoped
`site:<supplier domain> "<product name>"` when the brochure printed a
website, else `<supplier name> "<product name>"`. No model, no API cost, no
fabricated deep links (brochures only ever print the general site).

## Housekeeping

- `testviewer@brochure-app.net` demoted to its intended **viewer** role (it
  was admin) — also gives permission tests a real viewer subject.

## Verified

- Live TestClient suite vs real DB (scratchpad/feature_test2.py): **26/26** —
  price_desc/asc page 1 fully priced and correctly USD-ordered (nulls last);
  `price_pkr ≈ price_usd × rate`; `priced_only` count == 28; `max_price=200`
  respected in USD; viewer PATCH/DELETE/undo → 403; admin PATCH recomputes
  price_usd (500 CNY → ~$73.7); PATCH into an identical listing → 409; empty
  PATCH → 400; unknown id → 404; delete → gone; undo with a shared listing
  deletes 1 / keeps 1, removes the ledger row, and the second undo cleans up;
  all temp rows removed after the run.
- Backfill run: 28/28 priced listings normalized, 0 skipped ("Yuan/ton",
  "USD/ton", "Yuan/mt" all recognized); 166-currency snapshot persisted.
- Backend byte-compiles; frontend `tsc --noEmit` + `vite build` clean; both
  servers restarted and healthy.

## Files (part 11)

- Backend: `app/services/rates.py` (**new**), `app/services/database.py`
  (price_usd everywhere, `_order_nulls_last`, `update_listing`,
  `delete_listing`, `delete_document_and_listings`, `DuplicateListingError`,
  PKR at read time), `app/routers/listings.py` (**new**),
  `app/routers/search.py` (priced_only; USD bounds; GET /listings moved out),
  `app/routers/upload.py` (undo endpoint), `app/main.py` (409 handler +
  router), `app/schemas/chemical.py` (`price_usd`/`price_pkr`,
  `ListingUpdate`, `UndoUploadResult`), `app/prompts/nl_search_prompt.py`
  (USD note), `requirements.txt` (httpx comment)
- DB: migration `add_price_usd_and_exchange_rates` + price_usd backfill
- Frontend: `components/listing/ListingAdminCard.tsx` (**new**),
  `components/search/ResultsTable.tsx` (`ConvertedPrice`),
  `components/search/SearchFilters.tsx` (USD label + priced-only checkbox),
  `components/upload/UploadHistory.tsx` (Undo), `pages/ProductDetail.tsx`
  (conversions, admin card, web-search link), `lib/api.ts`,
  `types/chemical.ts`

---

# Frontend design system + dark mode + admin dashboard (2026-07-18)

A **presentation-only** pass (no route/auth/extraction/search logic changed,
except one new read-only aggregate endpoint): a cohesive "Marine" design
system applied to every page, full light/dark theming, a persistent sidebar
shell, and a new admin dashboard.

## 1. Design system — the "Marine" kit

- **Typography**: **Geist** (all UI) + **Geist Mono** (all precise data),
  loaded via Google Fonts in `index.html`, committed in the base layer.
  Replaces the default browser/Tailwind font stack everywhere.
- **Two-layer color**:
  - *Raw palette* (fixed hex, `tailwind.config.js`): `ink` (cool neutral, NOT
    Tailwind slate), `brand` (deep teal-cyan accent), `success/warning/danger`.
  - *Semantic tokens* (`index.css`, CSS variables that FLIP light↔dark):
    `app, surface, elevated, muted, hover, fg, fg-muted, fg-subtle, line,
    line-strong, brand, brand-hover, on-brand, brand-text, brand-soft,
    brand-soft-text, danger*, warn-*, ok-*`. Exposed as Tailwind utilities via
    `@theme inline`. **Components use these**, so one `.dark` class re-themes
    the whole app.
- **Radii** (named): `chip 7px`, `btn 10px` (buttons+inputs), `card 14px`,
  `panel 18px`. **Shadows**: `card`, `card-hover`, `pop`. **Glass**: `.glass` /
  `.glass-strong` / `.scrim` (blur + translucency, theme-aware) reserved for
  the sidebar, modals, drawers, and dropdowns.
- **Data chips** (`ui/mono-chip.tsx`): CAS numbers and prices render as small
  monospace chips **everywhere** (search table + mobile cards, product page,
  upload history, dashboard). Price = filled brand chip (the decision datum);
  CAS = lighter outlined brand chip; other mono data = neutral chip.

### Tailwind v3 → v4 (build-config change)

The toolchain was a broken v3/v4 mix (v4 `@tailwindcss/vite` plugin +
`@import "tailwindcss"` but the core `tailwindcss` package still v3, plus the
v3 PostCSS plugin double-processing). **Consolidated to pure v4**: upgraded
`tailwindcss` to `4.3.3`; `index.css` loads the JS token config via
`@config "../tailwind.config.js"` (v4 doesn't auto-read it); `postcss.config.js`
emptied (the Vite plugin handles Tailwind + prefixing). The class-based dark
variant is declared with `@custom-variant dark (&:where(.dark, .dark *))`.

## 2. Dark mode (light / dark / system)

- **`hooks/useTheme.tsx`** (`ThemeProvider` in `main.tsx`): choice persisted to
  `localStorage`, `resolvedTheme` follows the OS while on "system", toggles the
  `.dark` class on `<html>`. An inline script in `index.html` sets the class
  **before first paint** (no flash of the wrong theme).
- **`ui/theme-toggle.tsx`**: flips light↔dark; placed in the sidebar footer
  (labelled), the mobile top bar, and the login/kit pages (icon). Sonner toasts
  follow the theme.
- Dark palette is a calm deep-ink surface with a brighter teal accent + dark
  on-accent text (a deep teal + white text would sink into a dark surface) —
  contrast-checked, not "near-black + neon".

## 3. App shell + role-based landing

- **`components/layout/AppShell.tsx`** replaces the old top `NavBar`. Persistent
  glass **left sidebar** (role-gated: Dashboard/Upload for admin+manager, Users
  for admin, Search for all) that collapses to a **drawer** behind a glass top
  bar on mobile. Brand lockup, user chip + role, theme toggle, sign out.
- `App.tsx` restructured: auth pages + the temp `/kit` render bare; everything
  else renders inside `<AppShell>` via a `ShellLayout` layout route (which also
  enforces the session). **Role-based landing**: `/` and unknown paths →
  `/admin/dashboard` for admin/manager, `/search` for viewers. Login/reset now
  navigate to `/` (was `/search`) so the landing rule applies.

## 4. Admin dashboard (`/admin/dashboard`)

- New default landing page for **admin + manager** (viewers keep `/search`).
- **Stat cards**: total listings, distinct suppliers, uploads in the last 7
  days, listings flagged "needs review" — from **one new aggregate endpoint**.
- **Recent uploads** (admin + manager): reuses `<UploadHistory>` (so per-row
  "View listings" + **Undo** come for free).
- **Users** (admin only): reuses the role editor, now extracted to a shared
  `components/admin/UsersTable.tsx` (used by both the dashboard and the Users
  page — logic lives in one place, not rebuilt).
- **Backend**: `GET /admin/dashboard/summary` (`routers/dashboard.py`), guarded
  by `require_uploader` (admin|manager) per the existing `dependencies.py`
  pattern. `database.dashboard_summary()` builds the four counts from the
  existing tables via PostgREST `count="exact"` queries (listings, companies,
  documents in the last 7 days, listings where `needs_review`). No new
  tables/columns.

## Temporary

- **`/kit`** (`pages/KitPreview.tsx`) is a public design-kit showcase used to
  review the tokens live (light + dark). **Remove after sign-off** — it's the
  only intentionally-temporary addition.

## Verified (part 12)

- Frontend: `tsc --noEmit` + `vite build` clean; dev server HMR'd every change
  with no errors; all routes serve.
- Backend: changed modules byte-compile; `app.main` imports and registers
  `/admin/dashboard/summary`; TestClient returns **401** without/with a bad
  token (role check + aggregate run once authenticated). The live-DB round-trip
  could not be exercised from the build shell (no network to Supabase at the
  time), but `dashboard_summary()` uses the same `count="exact"` / `gte` / `eq`
  patterns as the already-working `suggest()` and `search_listings()`.

## Files (part 12)

- Frontend tokens/theme: `tailwind.config.js`, `src/index.css`, `index.html`,
  `src/main.tsx`, `src/hooks/useTheme.tsx` (**new**),
  `src/components/ui/theme-toggle.tsx` (**new**)
- Kit (restyled): `ui/{button,card,badge,input,select,label,table,progress,
  skeleton,mono-chip,stat-card,empty-state,modal,sidebar-nav-item}.tsx`
  (`select, mono-chip, stat-card, empty-state, modal, sidebar-nav-item` **new**)
- Layout (**new**): `components/layout/{AppShell,PageHeader}.tsx`
- Shell + routing: `src/App.tsx` (AppShell + role landing, NavBar removed)
- Pages migrated: `pages/{LoginPage,ResetPasswordPage,SearchPage,ProductDetail,
  AdminUploadPage,AdminUsersPage}.tsx`, `pages/AdminDashboard.tsx` (**new**),
  `pages/KitPreview.tsx` (**new, temp**)
- Components migrated: `components/search/{ResultsTable,SearchFilters,SearchBox,
  AISearchBar,AlphabetBar,Pagination}.tsx`,
  `components/upload/{UploadHistory,UploadJobRow,UploadQueue,UploadSummary}.tsx`,
  `components/listing/ListingAdminCard.tsx`,
  `components/admin/UsersTable.tsx` (**new, shared**), `lib/api.ts`,
  `types/chemical.ts`
- Backend: `app/routers/dashboard.py` (**new**), `app/main.py` (router),
  `app/schemas/chemical.py` (`DashboardSummary`),
  `app/services/database.py` (`dashboard_summary()`)

---

# Changes — Search reach (supplier + details), slide-in product panel, list-position restore, bulk select/delete (2026-07-19, part 14)

## 1. Search now matches suppliers and description/details text

**Problem:** `q` only matched `name_en` / `name_raw` / `cas_number`. Searching
a supplier's name found nothing, and a chemical only mentioned inside a
product's details (grade **HR990** is titanium dioxide, but "titanium dioxide"
appears only in its details text, never its name) was unfindable.

**Fix — one broader match surface, not a second search path:**
- Migration **`add_listings_search_text`**: PostgREST computed field
  **`search_text(listings)`** = `concat_ws(' ', name_raw, name_en, cas_number,
  details::text, company_name, company_name_en)` (supplier names come from a
  scalar subquery on `companies`, so the function is STABLE, not IMMUTABLE).
  Same pattern + hardening as `details_text` (part 10): EXECUTE revoked from
  client roles, granted to `service_role`.
- `database.search_listings(q=…)` and `database.suggest()` now filter with a
  single `.ilike("search_text", "*q*")` instead of the old three-column `or_`.
  Server-side, so pagination counts stay correct; same
  `_sanitize_filter_value` sanitization; `*` wildcard (not `%` — the
  Cloudflare-1101 gotcha).
- The typeahead benefits automatically: typing "titanium dioxide" now suggests
  the TITANOS grades whose details mention it.
- `details_q` / the AI agent's `details_query` are unchanged (still
  `details_text`); the AI agent's `name_query` flows into `q`, so AI search
  gains the wider surface with no prompt change.

**Verified live:** "titanium dioxide" → 10 rows including HR990;
"TITANOS INDUSTRY" → exactly and only that supplier's 23 listings (count
matches a direct DB count). **Honest limitation:** "TiO2" matches the rows
whose record actually contains that string (e.g. R906 via its
`tio2_content_percent` key) but NOT HR990 — HR990's brochure record never
prints "TiO2", and search deliberately matches only what extraction stored,
never synonyms it invents.

## 2. Product detail opens in a right-side slide-in panel

Clicking a product in the search results no longer navigates to
`/product/:id`. Instead a **glass drawer slides in from the right**
(`components/listing/ListingPanel.tsx`) over the still-mounted list, so the
list's scroll position, filters, and page survive automatically. Close = X
button, scrim click, or Escape; clicking a different product while it's open
just swaps the panel's content (the `id` prop changes — no close/reopen).

- The old page's rendering moved to a shared
  **`components/listing/ListingDetailBody.tsx`**; `pages/ProductDetail.tsx` is
  now a thin frame around it. **The `/product/:id` route is kept** for
  direct/shareable links (the panel has a "Full page" link to it) and browser
  history.
- `ListingAdminCard` gained an optional `onDeleted` callback: deleting from
  the panel closes the panel; deleting from the full page still navigates back
  to `/search`.
- New `slide-in-right` keyframe in `tailwind.config.js` (220ms, same easing
  family as `pop-in`; killed by the global `prefers-reduced-motion` rule).

## 3. List position restored on full navigations too

The panel keeps the list alive for the primary flow, but full navigations
still exist: opening `/product/:id` directly, the panel's "Full page" link,
and browser back/forward. For those, `SearchPage` now persists its **complete
search state** (q, filters, applied filters, letter, AI chips, page) and the
**window scroll offset** to `sessionStorage` (per-tab, gone when the tab
closes), restoring both on mount — scroll is restored once, only after the
first page of results has rendered (scrolling before rows exist would clamp
to 0). Returning to `/search` by any route lands exactly where the user left
off. (Side effect worth knowing: clicking "Search" in the sidebar within the
same tab session also restores the previous search — accepted as desirable
for an internal tool.)

## 4. Bulk select + delete (search results, upload history, per-upload listings)

One shared mechanism, three views — not three implementations:

- **`hooks/useSelection.ts`** — set-of-ids selection state (toggle row,
  toggle-all-for-page, clear).
- **`ui/checkbox.tsx`** — the styled native checkbox the forms already used
  inline, extracted as a kit primitive.
- **`ui/selection-bar.tsx`** — "N selected" bar with the scope hint, the bulk
  action button(s), and Clear.
- **Select-all scope:** the header checkbox selects **the rows shown on the
  current page** (its aria-label/title says "Select all N shown"; the bar's
  hint spells it out). Selections **persist across pages** and are **cleared
  whenever the filter/scope/range changes** (a selection only makes sense in
  the result set it was made in). Every destructive action gets a
  confirmation modal stating the exact count before anything is removed.

Where it appears:
1. **Search results** (`SearchPage` + `ResultsTable`, **admins only** — same
   role as single delete): checkbox column (desktop table + mobile cards),
   "Delete selected" → confirm modal → **new `POST /listings/bulk-delete`**
   (`{ids: [...]}`, admin, max 200, one `.in_()` delete via
   `database.bulk_delete_listings`; unknown ids are skipped and the response
   reports rows actually deleted). The search page now also clamps `page`
   after the set shrinks (same guard UploadHistory had), and closes the panel
   if the product it's showing was just bulk-deleted.
2. **Upload history** (`UploadHistory`, admin + manager — same audience as the
   per-row Undo): select uploads, "Undo selected" → one confirm modal → the
   uploads run through the existing `DELETE /uploads/{hash}` **one at a time,
   sequentially** — deliberately reusing the per-upload endpoint so the
   "keep listings shared with another upload" rule and the admin-any /
   manager-own permission checks apply unchanged, and each undo sees the
   previous one's ledger removal (two selected uploads sharing a listing end
   up fully deleted, correctly). Failures are counted and reported, not
   silently swallowed.
3. **Per-upload listings** (the "View listings" expander, **admins only**):
   select individual listings from one upload and bulk-delete just those —
   e.g. strip a few bad extractions without undoing the whole upload. Uses the
   same `POST /listings/bulk-delete`. The ledger row's `product_count` stays
   as-recorded (it documents what the upload produced); the expander's list
   drops deleted rows automatically (`get_listings_by_ids` already skips
   missing ids).

The upload **queue** (transient jobs) already had per-row remove +
"Clear finished" and deletes no database data, so it deliberately did not get
the selection treatment.

## Verified (part 14)

- Live TestClient suite vs the real DB (scratchpad `uiux_fix_test.py`,
  **15/15**): "titanium dioxide" returns HR990; "TiO2" matches
  details-bearing rows (R906); supplier search returns only/all of one
  supplier's listings (count == direct DB count); bulk-delete: no-auth 401,
  viewer 403, malformed id 400, empty ids 422, unknown-but-valid uuid → 200
  `{deleted: 0}`, two seeded rows deleted in one call and gone from the DB and
  from a follow-up search. Seeded rows cleaned up.
- Existing backend pytest suite still green (38/38); changed modules
  byte-compile.
- Frontend `tsc --noEmit` + `vite build` clean (pre-existing chunk-size
  warning only).

## Files (part 14)

- DB: migration `add_listings_search_text` (computed field `search_text`)
- Backend: `app/services/database.py` (`search_text` filter in
  `search_listings` + `suggest`, `bulk_delete_listings`),
  `app/routers/listings.py` (`POST /listings/bulk-delete`),
  `app/routers/search.py` (q description), `app/schemas/chemical.py`
  (`BulkDeleteRequest`/`BulkDeleteResult`)
- Frontend new: `components/listing/ListingPanel.tsx`,
  `components/listing/ListingDetailBody.tsx`, `hooks/useSelection.ts`,
  `components/ui/checkbox.tsx`, `components/ui/selection-bar.tsx`
- Frontend changed: `pages/SearchPage.tsx` (panel + sessionStorage restore +
  selection + confirm modal + page clamp), `pages/ProductDetail.tsx` (thin
  frame), `components/search/ResultsTable.tsx` (onOpen + selection columns),
  `components/search/SearchFilters.tsx` + `SearchBox.tsx` (labels),
  `components/listing/ListingAdminCard.tsx` (`onDeleted`),
  `components/upload/UploadHistory.tsx` (upload selection + bulk undo +
  admin listing selection in the expander), `lib/api.ts`
  (`bulkDeleteListings`), `tailwind.config.js` (`slide-in-right`)

---

# Changes — Suppliers directory + review queue, manager write access (2026-07-19, part 15)

## 1. Suppliers page (`/suppliers`, all roles)

A paginated directory of every extracted supplier —
`pages/SuppliersPage.tsx`, "Suppliers" in the sidebar for every role.

- **Backend**: `GET /suppliers` (new `routers/suppliers.py`, `require_user`,
  `page`/`page_size` ≤ 50) → `database.list_suppliers()`: one page of
  `companies` (ordered by English name) + ONE bounded listings query for just
  that page's supplier ids, aggregated in Python into `listing_count` and the
  distinct printed `websites` (website lives per-listing — that's where
  extraction sees it). Schemas `SupplierOut` / `SuppliersResponse`.
- **Shown per supplier**: English + original-script names, email, phone,
  website link(s), first-seen date, listing count, and a **"View products"**
  link that jumps into the normal search (the part-14 `search_text` surface).
- **Link mechanics (non-obvious)**: the search sanitizer strips
  commas/parens from the *query* but not the indexed text, so a full
  "…CO.,LTD." name would fail to match itself. `supplierSearchQuery()` cuts
  the name at the first such character ("SHANGHAI TITANOS INDUSTRY CO."),
  which IS a substring of the stored name. `SearchPage` now consumes a
  **`?q=` URL param** (once — then stripped from the URL; it overrides the
  sessionStorage-restored state and skips the scroll restore, since arriving
  with `?q=` is a fresh search, not a return).
- **Extraction now captures printed contact details**: `company_email` +
  `company_phone` added to `EXTRACTION_PROMPT`'s shape, `_COMPANY_PROMPT`
  (the cover/footer identity pass), `_merge_page_results`, both identity
  backfill blocks, and `ExtractionResult`. `resolve_company()` stores them on
  new suppliers and **backfills missing ones on reuse — never overwrites**
  (first printed value wins). Migration **`companies_contact_text`** changed
  `companies.contact_number` bigint→text (phones are formatted strings; the
  column was verified all-NULL, nothing lost).
- **Honest limitation**: all 9 existing suppliers predate this capture, so
  their email/phone show "—" (their PDFs are content-hash-deduped — a
  re-upload won't re-extract). The page says so. Websites/names/counts are
  fully populated today.

## 2. Review queue (`/admin/review`) — dashboard "Needs review" is now a button

Built **on the existing `needs_review` flag only** — the
`cas_checksum_failed` / uncertain-mapping flags belong to the decoupled
reference pipeline (`app/pipeline/`, part 12) and never reach the live DB, so
there is no second flagging system to build on (checked before building).

- **Backend**: `GET /admin/review` (in `routers/dashboard.py`,
  `require_uploader`, paginated ≤ 50/page) → `database.list_review_listings()`:
  flagged listings newest first, each annotated with its **source upload**
  (`source_content_hash`/`source_filename`) by inverting the small `documents`
  ledger's `listing_ids` in Python (cheaper than per-listing array-contains
  queries). Listings from pre-part-6 uploads get null source (shown as
  "Unknown source (older upload)", no file actions). Schemas `ReviewItemOut`
  (extends `ListingOut`) / `ReviewQueueResponse`.
- **Frontend**: `pages/ReviewQueuePage.tsx` — flagged listings **grouped by
  source PDF** (per the user's decision: the queue is file-centric), with:
  - **"Mark verified"** per row (and bulk, sequential) → the existing
    `PATCH /listings/{id}` with `needs_review: false` — the same lightweight
    resolution part 11 established, no new semantics;
  - **"Open"** → the part-14 slide-in `ListingPanel` (edit card inside for
    corrections);
  - row checkboxes + per-file select-all → **"Delete selected"**
    (`POST /listings/bulk-delete`, confirm modal);
  - **"Delete file"** per group → the existing `DELETE /uploads/{hash}` undo
    (confirm modal spells out that it removes ALL of that upload's listings,
    not just flagged ones; shared-listing safe; managers only their own).
  - Reuses the shared selection kit (`useSelection`/`SelectionBar`/`Checkbox`)
    and clamps the page as the queue shrinks. Resolving invalidates the
    queue, search, dashboard summary, and upload history caches.
- **Dashboard**: the "Needs review" stat card is now wrapped in a link to
  `/admin/review`; "Review" also sits in the sidebar for admin + manager.

## 3. Permissions change — managers can now edit/delete listings

Per the user's explicit choice ("Admins + managers resolve"):
`PATCH /listings/{id}`, `DELETE /listings/{id}` and
`POST /listings/bulk-delete` moved from `require_admin` to
**`require_uploader`** (admin | manager). Frontend gates follow: the edit
card on the product page/panel and the search bulk-select now show for
managers too, and the upload-history expander's selection is unconditional
(its pages are already uploader-gated). **Not widened**: user management
(admin), org-wide upload history (admin), and `DELETE /uploads/{hash}` keeps
its admin-any / manager-own ownership rule — a manager's "Delete file" on
someone else's upload still returns 403.

## Verified (part 15)

- Live TestClient suite (scratchpad `uiux_fix67_test.py`, **21/21**):
  suppliers 401/200, directory count == companies count, every
  `listing_count` matches a direct DB count, every supplier's "View products"
  query returns at least all of that supplier's rows, websites aggregated;
  `resolve_company` backfills email/phone onto an existing supplier, serves
  them via `/suppliers`, and never overwrites an existing value (all reverted
  after the run); review queue 401/403(viewer)/200(admin+manager), count ==
  DB flagged count, rows all flagged and all carrying their source filename,
  page 2 disjoint; a manager (temporarily promoted test user, restored after)
  can PATCH a flag clear and bulk-delete; a viewer still gets 403. Existing
  pytest suite 38/38; frontend `tsc --noEmit` + `vite build` clean.

## Files (part 15)

- DB: migration `companies_contact_text` (contact_number bigint→text)
- Backend: `app/routers/suppliers.py` (**new**), `app/routers/dashboard.py`
  (`GET /admin/review`; prefix now `/admin`), `app/routers/listings.py`
  (write access → `require_uploader`), `app/services/database.py`
  (`list_suppliers`, `list_review_listings`, `resolve_company` contact
  backfill), `app/services/jobs.py` (threads email/phone),
  `app/services/extraction.py` (identity + merge carry email/phone),
  `app/prompts/extraction_prompt.py` (company_email/company_phone),
  `app/schemas/chemical.py` (`SupplierOut`, `SuppliersResponse`,
  `ReviewItemOut`, `ReviewQueueResponse`, `ExtractionResult` contact fields),
  `app/main.py` (suppliers router)
- Frontend new: `pages/SuppliersPage.tsx`, `pages/ReviewQueuePage.tsx`
- Frontend changed: `App.tsx` (routes), `components/layout/AppShell.tsx`
  (Suppliers + Review nav), `pages/AdminDashboard.tsx` (stat card → link),
  `pages/SearchPage.tsx` (`?q=` consumption + manager gate),
  `components/listing/ListingDetailBody.tsx` +
  `components/listing/ListingAdminCard.tsx` (manager gate, copy),
  `components/upload/UploadHistory.tsx` (expander selection ungated),
  `lib/api.ts` (`listSuppliers`, `listReviewQueue`), `types/chemical.ts`
  (`Supplier`, `SuppliersResponse`, `ReviewItem`, `ReviewQueueResponse`)

---

# Changes — Activity/audit log, editable technical details, pop-open edit form, supplier panel (2026-07-19, part 16)

## 1. Activity log — who uploaded / edited / deleted what

- Migration **`add_audit_log`**: `audit_log` table (identity PK, `actor uuid`,
  `action text`, `details jsonb`, `created_at`; index on created_at DESC; RLS
  on with NO client policies — service-role only).
- `database.record_audit()` + a **never-raises `database.audit()`** wrapper —
  an audit failure logs and moves on, it can never break the operation being
  audited. `database.list_audit()` paginates newest-first.
- **Written on**: upload processed (`jobs._finalize`, after the ledger write),
  `PATCH /listings/{id}` (name + which fields changed),
  `DELETE /listings/{id}` (**the listing's name/company is captured BEFORE
  deletion** so the log can answer *what* was deleted),
  `POST /listings/bulk-delete` (count + first 25 names, captured before),
  `DELETE /uploads/{hash}` (filename, deleted/kept counts).
- **`GET /admin/audit`** (in `routers/dashboard.py`, **admin only**,
  paginated ≤ 50) — actor emails resolved at read time via the Admin Auth
  API. Frontend: `pages/AuditLogPage.tsx` at `/admin/audit`, "Activity" in
  the sidebar (admin), humanized action badges + detail sentences.

## 2. Technical details are now editable (add / change / remove)

- `ListingUpdate` gained `details: dict | None` — the edit form sends the
  whole edited object; the PATCH replaces the column (dedup key unaffected;
  the part-14 `search_text` surface picks changes up instantly since it's a
  computed field).
- `ListingAdminCard` gained a **details editor**: one row per entry
  (key + value inputs, per-row remove, "Add detail"). Type-safety rules:
  an **untouched row keeps the original value byte-for-byte** (rows render
  non-string values as JSON; rebuilding reuses the original when the text is
  unchanged — no type drift, no false "dirty"), edited/new values parse as
  JSON when they look like it (`{…}`, `[…]`, numbers, true/false) else store
  as text. The PubChem `reference_data` block is excluded from the editor and
  re-attached untouched on save.

## 3. Edit UX — the form pops open; explicit Edit buttons everywhere

- `ListingDetailBody` now renders the edit form **collapsed behind an
  "Edit listing" button** (admin/manager) on both the product page and the
  slide-in panel; `defaultEdit` opens it pre-expanded.
- **Edit buttons** added to: search-result rows (desktop + mobile cards,
  admin/manager), review-queue rows, and the upload-history "View listings"
  expander rows — each opens the slide-in panel with the form expanded
  (`ListingPanel edit` prop). Name clicks still open the panel in view mode.
- **Every destructive action now confirms via the kit Modal** — replaced the
  remaining `window.confirm`s (edit-card delete, upload-history row Undo).

## 4. Supplier slide-in panel + shared drawer shell

- The drawer shell was extracted to **`ui/side-panel.tsx`** (portal, scrim,
  Escape/outside-click/X, body-scroll lock, focus-in); `ListingPanel` is now
  a thin wrapper over it.
- **`components/supplier/SupplierPanel.tsx`**: clicking a supplier's name on
  the Suppliers page slides in its details from the right — names, contact
  rows, first-seen, listing count, plus a **live product preview** (first
  search page for that supplier) whose rows swap to the product panel;
  "View in search" jumps to the full list. `supplierSearchQuery()` moved
  here (exported; the page imports it).

## 5. Ops note — stale-backend strikes again (documented gotcha)

Mid-review the user saw 404s for `/suppliers`+`/admin/review` and "HR990 not
found" on the frontend: the uvicorn on :8000 was still serving pre-part-14
code. The old process was killed and relaunched from `backend/` with
`.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port
8000`; after restart all new routes 401 correctly without auth and a real
HTTP `GET /search?q=titanium dioxide` with a viewer JWT returns HR990
(count 10). Same lesson as always on this machine: **restart uvicorn after
backend edits, never trust --reload.**

## Verified (part 16)

- Live TestClient suite (scratchpad `uiux_audit_test.py`, **12/12**): audit
  401/403(viewer)/200(admin); PATCH details stored + immediately searchable
  via `search_text` ("23 °C" finds the seeded row); update/delete/bulk-delete
  each produce the right audit entry (with names captured pre-delete); actor
  emails resolved; newest-first ordering. Test listings AND the audit rows
  the test actions created are cleaned up after the run.
- Existing pytest 38/38; frontend `tsc --noEmit` + `vite build` clean; the
  restarted :8000 server verified serving every new route over real HTTP.

## Files (part 16)

- DB: migration `add_audit_log`
- Backend: `app/services/database.py` (`record_audit`/`audit`/`list_audit`),
  `app/services/jobs.py` (upload audit), `app/routers/listings.py` (audit on
  update/delete/bulk), `app/routers/upload.py` (undo audit),
  `app/routers/dashboard.py` (`GET /admin/audit`), `app/schemas/chemical.py`
  (`AuditEntryOut`, `AuditLogResponse`, `ListingUpdate.details`)
- Frontend new: `pages/AuditLogPage.tsx`, `components/ui/side-panel.tsx`,
  `components/supplier/SupplierPanel.tsx`
- Frontend changed: `components/listing/ListingAdminCard.tsx` (details
  editor + Modal delete confirm), `components/listing/ListingDetailBody.tsx`
  (collapsed edit + `defaultEdit`), `components/listing/ListingPanel.tsx`
  (SidePanel + `edit` prop), `components/search/ResultsTable.tsx` (`onEdit`
  column), `pages/SearchPage.tsx` + `pages/ReviewQueuePage.tsx` (edit-intent
  state), `components/upload/UploadHistory.tsx` (Modal undo confirm + Edit
  buttons + panel), `pages/SuppliersPage.tsx` (supplier/product panels),
  `App.tsx` + `components/layout/AppShell.tsx` (Activity route/nav),
  `lib/api.ts` (`listAuditLog`), `types/chemical.ts` (`AuditEntry`,
  `AuditLogResponse`, `ListingUpdate.details`)

---

## Part 17 — DB-worker extraction pipeline (2026-07-26)

Re-architected extraction from the in-memory `jobs.py` queue to a **crash-safe,
Postgres-backed worker pipeline** per `IMPLEMENTATION_BRIEF.md` /
`nasir-data-indexing-architecture.md`. Upload no longer extracts inline; it
retains the PDF and creates a work-queue row, and a **standalone worker process**
(`python -m app.worker`) splits + extracts it. All state lives in the DB, so a
reload or backend restart loses nothing.

### Schema (merge migrations, applied live)
- **`documents` evolved from the content-hash ledger into the work-queue table**
  (not a second table — its own spec already carried `content_hash`). Added
  `id uuid` (unique key; `content_hash` stays PK so all existing dedup/history/
  undo queries keep working), `status` machine, `running_context jsonb`,
  `page_count`, `claimed_by`, `claimed_at`, `cancel_requested`. Statuses:
  `pending | splitting | split | claimed | extracting | paused | done | failed |
  cancelled`. `company_id` kept **bigint** (matches live `companies.id`).
- **`pages`** (new): one row per page image — `status` (`pending | claimed |
  extracting | done | failed | dead`), `attempts`, `image_path`,
  `markdown_output`, `raw_json`, unique `(document_id, page_number)`.
- **`listings`**: `document_id`, `source_page_id`, `characteristics jsonb`,
  `cas_number_raw`, `review_reason`.
- **`companies`**: `website`, `website_domain` (partial-unique), `extra_details`.
- **`brochure-pages`** private Storage bucket (source PDFs + page PNGs).
- **`claim_next_document(worker_id)`** RPC — atomic longest-job-first claim
  (`FOR UPDATE SKIP LOCKED`, not expressible via PostgREST); claims `pending`/
  `split`, skips `cancel_requested`/`paused`, sets `extracting`.

### Extraction (two-stage, config-driven)
- **`services/page_extract.py`** — `extract(image, context) -> PageExtraction`:
  stage 1 image→markdown (reuses `VLM_TRANSCRIPTION_PROMPT` + `running_context`),
  stage 2 markdown→JSON. Model chosen by `PAGE_EXTRACT_PROVIDER` (`qwen` now /
  `claude` for prod) in one function. **Claude uses genuine forced `tool_use`;
  Qwen uses `response_format=json_object` + Pydantic** — Dashscope's OpenAI-
  compatible endpoint rejects a forced `tool_choice` on the vision models, and
  json_object is the same guaranteed-structured pattern the repo already uses.
- **`services/cas.py`** — deterministic CAS normalize + checksum (raw always
  kept). Pure, unit-tested (`tests/test_cas.py`, 13 cases).
- **`services/supplier.py`** — domain-first supplier resolution: website domain →
  email domain → rapidfuzz name (conservative; ambiguous → new row, never a
  false merge). Verified live: an incoming ECHEMI identity resolved to the
  existing `companies.id` by `website_domain=echemi.com`.

### Worker + lifecycle
- **`app/worker.py`** — claim → (lazy split if no pages) → resolve supplier →
  sequential page loop with `running_context` carry-forward → CAS normalize +
  the §6 review triggers → `insert_listing` (keeps the `chemicals` canonical
  layer via `dedup.resolve_chemical`). Crash-safe: resumes at the first non-done
  page. Fixed a null-claim spin bug (the RPC returns an all-null row when the
  queue is empty — now guarded on a null `id`).
- **PDF retention**: the source PDF is stored on upload and **kept until every
  page is terminal (`done`/`dead`)**, then deleted. Retained for `failed`/
  `cancelled`/`paused`. Split moved into the worker (lazy) so a crash before
  split just re-splits from the retained PDF.
- **Pause/resume**: pause sets `status='paused'` (claim excludes it; in-flight
  page finishes, no page reprocessed). Resume → claimable (`split` if pages
  exist, else `pending`).
- **Cancel**: worker stops at the next page boundary; already-written listings +
  resolved supplier are kept (never rolled back).
- **Restart** (`failed`/`cancelled`): resumes at the first incomplete page if
  pages exist (no re-split); re-splits from the retained PDF only if zero pages.
- **`services/pipeline_db.py`** — queue + Storage helpers (claim, page CRUD,
  source-PDF store/download/delete, `request_pause`/`resume_document`/
  `request_cancel`/`restart_document`/`should_stop`/`all_pages_terminal`,
  `list_documents_status`). **`services/splitter.py`** — PDF→page images +
  `pages` rows (reuses `pdf_utils.render_pages`; worker owns status).

### Upload path + UI (replaced the in-memory queue)
- **`routers/upload.py`**: `POST /upload-jobs` creates the doc, retains the PDF,
  flips to `pending` in the background (so a worker never claims a PDF-less doc).
  `GET /upload-jobs` returns document status with derived `pages_done`. New
  per-doc controls: `POST /upload-jobs/{id}/{pause|resume|cancel|restart}`.
  History/undo endpoints unchanged (still work on the merged `documents`).
  **`services/jobs.py` retired** (no longer imported).
- **Frontend**: `AdminUploadPage` + `UploadQueue` + `UploadJobRow` +
  `UploadSummary` repointed from in-memory jobs to `DocumentStatus`, with a
  **real pages-done progress bar** and pause/resume/cancel/restart buttons.
  `api.ts` (`cancel/restart/pause/resumeDocument`, new list shape),
  `types/chemical.ts` (`DocumentStatus`/`DocumentStatusValue`, dropped
  `UploadJob`).

### Decisions kept (from the brief)
- Keep all current listing fields + the `chemicals` canonical layer (user calls).
- Qwen for both prod/test until a funded Sonnet 5 key exists.
- Pause built after confirming; **reconciler loop still TODO** (stalled-claim
  reset, page dead-lettering).

### Files (part 17)
- DB migrations: `pipeline_documents_pages_merge`, `pipeline_bucket_and_claim_rpc`,
  `pipeline_cancel_support`, `pipeline_pause_and_pdf_retention`
  (`schema-additions.sql` rewritten as the ALTER-based merge).
- Backend new: `app/worker.py`, `app/services/{page_extract,cas,pipeline_db,
  splitter,supplier}.py`, `tests/test_cas.py`.
- Backend changed: `app/config.py` (`page_extract_provider`), `app/routers/
  upload.py`, `app/schemas/chemical.py` (`DocumentStatusOut`,
  `DocumentStatusListResponse`).
- Frontend changed: `pages/AdminUploadPage.tsx`, `components/upload/{UploadQueue,
  UploadJobRow,UploadSummary}.tsx`, `lib/api.ts`, `types/chemical.ts`.
- Verified: `tests/test_cas.py` 13/13; frontend `tsc --noEmit` clean; backend
  byte-compiles + imports; live pilot (ECHEMI, 3pg) split→claim→extract→48
  products→supplier dedup, cleaned up after.

---

## Part 18 — Reconciler + PDF retention / pause (2026-07-26)

Two related pieces landed on top of Part 17: the **lifecycle refinement** (commit
`ce4987b`, already in Part 17) and the **reconciler** (this part).

### Reconciler (`app/reconciler.py`)
Single standalone self-healing loop — `python -m app.reconciler` (one instance,
unlike the workers). Every `reconciler_interval_seconds` (30) it sweeps and:
1. **Dead-letters** pages that failed `>= max_page_attempts` (3) → `dead`
   (surfaced in review, not retried forever).
2. **Finishes** any non-terminal document whose every page is terminal
   (done/dead) → `done` + deletes the retained source PDF.
3. **Retries** `failed` documents that still have retriable pages → back to a
   claimable status (worker resumes at the first non-done page).
4. **Resets stalled claims**: a document `extracting` past
   `document_stale_seconds` (300) with no page heartbeat (dead worker) → back to
   claimable.
- **Guard**: a no-pages document with **no retained PDF** is left `failed`
  instead of looping `failed→pending→failed` forever (added after leftover
  pre-retention junk surfaced exactly this).
- Never deletes listings or resolved suppliers — only status/page transitions
  and the already-superseded PDF.

### Worker heartbeat
- `pipeline_db.touch_claim(doc_id)` after each page refreshes `documents.
  claimed_at`, so the reconciler distinguishes a live worker on a long document
  from a dead one (stall detection). `pipeline_db.source_pdf_exists()` added for
  the reconciler's recoverability guard.

### Config
- `reconciler_interval_seconds=30`, `document_stale_seconds=300`,
  `max_page_attempts=3`.

### Files (part 18)
- Backend new: `app/reconciler.py`.
- Backend changed: `app/config.py` (reconciler settings), `app/services/
  pipeline_db.py` (`touch_claim`, `source_pdf_exists`, `_now_iso`),
  `app/worker.py` (per-page heartbeat).
- Verified: imports clean; a live reconcile sweep correctly detected + re-queued
  genuinely-stuck documents. **Reconciler/worker left stopped pending go-ahead.**

> Note: the live `listings` catalog was intentionally cleared during testing on
> 2026-07-25 (353 → 28 rows, all from an 11:16–11:20 UTC test run); the 28 rows
> are the current baseline. `companies` 11, `chemicals` 730.
