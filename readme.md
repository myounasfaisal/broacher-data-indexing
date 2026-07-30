# BrochureDB — Chemical Brochure Extraction Platform

Internal web tool for **BosTech Polymer**. It extracts structured product data from
scanned chemical-supplier brochure PDFs (any language) and lets staff search the
result to compare suppliers and specifications — even when the same substance is sold
under different trade names.

- **Admin / manager** — upload a folder of brochure PDFs. Each is split into page
  images and extracted by a pool of worker processes into product listings.
- **Everyone** — search by name, CAS, supplier, purity, or anything printed in a
  product's details; or ask in plain language via the AI search bar, which converts
  the sentence into the same filters (the model never invents rows).

> **Price is a bonus field, not the spine.** Most brochures are spec sheets and print
> no price at all — zero listings in the live catalog carry one. Price is captured
> when printed and null otherwise; nothing ranks, gates, or filters by it by default.
> The comparison axis is specification. See [PRODUCT.md](PRODUCT.md) → "Price is not
> the product".

## Documentation map

| Doc | What it covers |
|---|---|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | **Single source of truth** — how the system actually works, verified against the code |
| [PRODUCT.md](PRODUCT.md) | Users, goals, product rationale |
| [DESIGN.md](DESIGN.md) | Visual system, tokens, theming |
| [manual_test.md](manual_test.md) | Per-feature QA checklists |
| [docs/archive/](docs/archive/) | Superseded design docs, session handoffs, change logs — historical only |

## Repository layout

```
├── frontend/   React 18 + Vite + TypeScript + Tailwind v4
├── backend/    FastAPI — API, extraction worker, reconciler
├── db/         schema.sql  (INCOMPLETE — see ARCHITECTURE.md §12.1)
└── docs/       archive/
```

## Prerequisites

- Node.js 18+, Python 3.11+
- A Supabase project (Postgres + Auth + Storage)
- A **Qwen/Dashscope** API key ([Alibaba Cloud](https://dashscope.aliyuncs.com)) — the
  current extraction provider. An `ANTHROPIC_API_KEY` is needed only when switching
  `PAGE_EXTRACT_PROVIDER=claude`.

## Setup

### 1. Database

Run [`db/schema.sql`](db/schema.sql) then [`schema-additions.sql`](schema-additions.sql)
in the Supabase SQL editor, and create a **private Storage bucket named
`brochure-pages`**. Anything added after those two files lives in
[`db/migrations/`](db/migrations/) — run them in date order on an existing
database (each is idempotent; `schema-additions.sql` already folds them in for
a fresh one).

The assistant's optional layers need one extra step each:

- **House knowledge (P4)** — `2026-07-26_house_knowledge.sql`. No config.
- **Semantic search (P3)** — `2026-07-26_chemical_embeddings.sql`, then set
  `EMBEDDINGS_ENABLED=true` and run `python -m app.embed_backfill` once. Until
  the backfill runs, `find_similar_chemicals` degrades to a name match and says
  so.

> ⚠️ These files do **not** fully describe the live database. The
> `claim_next_document` RPC, several tables, and the computed search/price columns
> are not in version control — a fresh environment cannot be provisioned from this
> repo alone. See ARCHITECTURE.md §12.1.

### 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env        # then fill in the values
```

**Three processes must run**, not just the API:

```bash
uvicorn app.main:app --reload     # API      → http://localhost:8000
python -m app.worker              # extraction worker (run 1–6 of these)
python -m app.reconciler          # self-healing loop (exactly one instance)
```

Uploads are accepted by the API but **only processed by a worker**, and
**concurrency is the worker count** — one worker extracts one document at a
time. Without the reconciler, stalled or failed documents are never retried.

The easy path is [`run.sh`](run.sh), which starts all four processes (API,
frontend, reconciler, N workers) from the repo root:

```bash
./run.sh              # everything, 4 workers
./run.sh start 6      # everything, 6 workers
./run.sh workers 6    # rescale workers mid-batch, leave the rest running
./run.sh status       # what's running
./run.sh logs         # tail every log
./run.sh stop         # stop all four
```

`docker compose up --build` still builds **only the API container** — it does
not run workers or the reconciler.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                       # → http://localhost:5173
```

Typecheck with `npx tsc --noEmit`; build with `npm run build`.

### 4. Supabase Auth — password-reset redirect

The sign-in page has a "Forgot password?" flow. Allowlist
`http://localhost:5173/reset-password` (plus the production URL) under
**Authentication → URL Configuration → Redirect URLs**. Dashboard-only config.

## User roles

| Role | Search | Upload | Manage users |
|---|---|---|---|
| admin | ✅ | ✅ | ✅ |
| manager | ✅ | ✅ | ❌ |
| viewer | ✅ | ❌ | ❌ |

New signups default to `viewer` via the `on_auth_user_created` trigger. Admins and
managers land on `/admin/dashboard`; viewers land on `/search`. Admins change roles
in-app at `/admin/users` (you cannot change your own role, so the last admin can't
lock themselves out).

**Bootstrapping the first admin** — run once in the Supabase SQL editor, then sign
out and back in:

```sql
update public.profiles set role = 'admin' where id = '<your-user-uuid>';
```

## Environment variables

Full list with defaults in [`backend/app/config.py`](backend/app/config.py); the
settings that matter are tabulated in ARCHITECTURE.md §11. The ones you must set:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | Data access (service key bypasses RLS — backend only) |
| `SUPABASE_JWT_SECRET` | Verifies user tokens on protected routes |
| `PAGE_EXTRACT_PROVIDER` | `qwen` (current) or `claude` (production) — **the** extraction switch |
| `QWEN_API_KEY`, `QWEN_API_BASE` | Dashscope / local Qwen endpoint |
| `ANTHROPIC_API_KEY` | Only when `PAGE_EXTRACT_PROVIDER=claude` |
| `ALLOWED_ORIGIN` | Exact frontend origin for CORS (no wildcard) |
| `MAX_UPLOAD_SIZE_MB` | Per-file upload cap (default 20) |

`config.py` also carries settings for OpenAI, Gemini, OpenRouter/GLM, NuExtract and
PubChem. **These are not reachable from any live code path** — see ARCHITECTURE.md §12.2.

## Frontend design system

The "Marine" kit on Tailwind v4: Geist + Geist Mono, semantic CSS tokens in
`src/index.css` flipping on two axes (light/dark via `.dark`, Teal/Ember accent via
`data-accent`), hand-written shadcn-compatible primitives in `src/components/ui/`.
Full rules in [DESIGN.md](DESIGN.md).

> **Tailwind version:** v4 via `@tailwindcss/vite`. `src/index.css` starts with
> `@import "tailwindcss";` and `@config "../tailwind.config.js";`, and
> `postcss.config.js` is intentionally empty. Don't re-add the v3 PostCSS plugin.

## Security

- Service-role key and JWT secret live **only** in `backend/.env`.
- Every protected route re-verifies the caller's JWT and role
  ([`dependencies.py`](backend/app/dependencies.py)); frontend guards are UX only.
- CORS locked to the exact `ALLOWED_ORIGIN`.
- Uploads validated server-side by MIME type **and** `%PDF-` magic bytes, size-capped
  on both client and server, and rate-limited (`slowapi`).
- RLS is enabled on all tables; the search API never exposes `uploaded_by`.
- Uploaded PDFs are **retained** in the private `brochure-pages` bucket until every
  page of the document is processed, then deleted. (Earlier versions of this README
  said PDFs were never stored — that stopped being true with the DB-worker pipeline.)

## Tests

```bash
cd backend && python -m pytest tests/
```

Covers CAS normalization and the offline `app/pipeline/` reference tool. The live
worker/reconciler path has no automated coverage — verification is manual, per
[manual_test.md](manual_test.md).
