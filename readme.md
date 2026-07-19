# Chemical Brochure Extraction Platform

Internal web tool that extracts structured product data from chemical supplier
brochure PDFs (scanned, any language) using AI models, and lets viewers search
the resulting database to compare suppliers and find the cheapest option for a
given chemical — even when listed under different trade names.

- **Admin**: pick a local folder of brochure PDFs; each is sent to the
  configured extraction model (Qwen, Gemini, or Claude) and saved. The
  original PDF is never stored — processed in memory then discarded.
- **Viewer**: search/filter chemicals by name, CAS number, **supplier name,
  or any text in the product's description/details** (a chemical mentioned
  only inside a brochure's details still surfaces the product), plus price
  and purity — or ask in plain language via the **AI search** bar, which
  converts the sentence into the same filters (the model never generates
  data itself). Clicking a result opens it in a right-side slide-in panel,
  so the list keeps its scroll position and filters.

## Repository layout

```
brochure-platform/
├── frontend/   # React + Vite + TypeScript + shadcn/ui
├── backend/    # FastAPI (extraction, dedup, search, auth)
└── db/         # schema.sql — run once in Supabase
```

Each backend concern (extraction, dedup, database, auth) lives in its own
service file, so changing one job means editing exactly one file.

## Extraction pipeline

The platform supports **four** extraction providers (GPT, Qwen, Gemini, Claude)
and a Qwen OCR layer for scanned documents. With `EXTRACTION_PROVIDER=gpt`,
**Qwen OCRs the brochure page images and GPT (OpenAI) turns that text into the
product JSON** — every PDF goes image → Qwen OCR → text → GPT (GPT never does
vision; it needs `OPENAI_API_KEY` + `OPENAI_MODEL`, and Qwen's key for OCR):

```
PDF upload
  ├── Text-based PDF
  │     ├── provider=claude → native PDF document block
  │     ├── provider=gemini → native PDF (inline data)
  │     └── provider=qwen   → render pages to PNG → Qwen vision model
  └── Scanned PDF (detected automatically)
        → Qwen vision OCR (page images → text)
        → send OCR text to the configured provider (qwen / gemini / claude)
```

- **Provider selection**: set `EXTRACTION_PROVIDER=gpt`, `qwen`, `gemini`, or
  `claude` in the backend `.env` (see [`config.py`](backend/app/config.py)).
  `gpt` = Qwen OCR → GPT JSON (both keys needed); the others send the PDF /
  OCR text to that one model.
- **Scanned PDF detection**: PyMuPDF checks if pages have extractable text.
  When most pages are image-only, pages are rendered to PNG and run through
  Qwen's vision model for OCR before extraction — regardless of which provider
  does the final extraction.
- **Qwen**: uses the OpenAI-compatible API (Dashscope or a local vLLM / Ollama
  deployment) with the `qwen-vl-max` model. It serves double duty — it can be
  the extraction provider itself (Qwen has no native PDF input, so pages are
  sent as images) **and** it is always the OCR engine for scanned PDFs. So
  `QWEN_API_KEY` is required whenever `EXTRACTION_PROVIDER=qwen` or any scanned
  PDF is processed.

### Reference two-model pipeline (`app/pipeline/`)

Alongside the single-shot provider path above, the repo ships a **reference,
schema-first, two-model pipeline** built to the original brief. It is
self-contained (own package, own richer `Product` schema that carries
`formula`) and intentionally **decoupled from the live upload path** so it can
evolve without destabilising the running app. Run it standalone:

```
python -m app.pipeline path/to/brochure.pdf --out result.json
```

Five stages, each owning specific failure-mode guards (full map in the
docstring at the top of [`orchestrator.py`](backend/app/pipeline/orchestrator.py)):

```
Qwen VLM  →  Qwen3 8B  →  JSON-schema constrained decoding  →  Pydantic  →  chemical validation
 (vlm.py)   (extraction) (extraction.py, guided_json)        (schema.py)  (validation.py)
```

| Stage | File | Guards |
|-------|------|--------|
| 1 · VLM transcription | `pipeline/vlm.py` | keeps `Category: a, b, c` lines and table/bullet hierarchy intact so later stages can split/anchor |
| 2 · structured extraction | `pipeline/extraction.py` | prompt judgment: bundle-splitting, formula-vs-grade, footer/cert noise excluded, purity-in-parens |
| 3 · Pydantic | `pipeline/schema.py` | types, required fields, CAS/formula/currency regex shapes |
| 4 · bundle splitting | `pipeline/schema.py` (`split_bundled_product`) | safety-net split of unsplit bundles; leaves real comma names alone |
| 5 · chemical validation | `pipeline/validation.py` | demote catalog codes out of `formula`; flag CAS-checksum failures; every repair **logged + counted** (`RepairStats`) |

- **Constrained decoding**: driven through the existing OpenAI-compatible Qwen
  client via `PIPELINE_GUIDED_DECODING` — `guided_json` (vLLM native, true
  token-level constraint), `json_schema` (OpenAI structured outputs), or
  `json_object` (Dashscope-safe default; schema still enforced by Pydantic in
  stage 3). No new serving dependency is introduced. The open-ended `details`
  dict is relaxed in the schema sent to the decoder (grammar decoders handle
  unbounded-key objects poorly) but still validated by Pydantic.
- **Tests**: `backend/tests/` — unit tests for `is_valid_cas`,
  `looks_like_valid_formula`, `split_bundled_product`, and an integration test
  running the full pipeline against the **Bostech Polymer** fixture (mocking
  only the stage-2 model call) asserting no unsplit bundles, no catalog code as
  a formula, and null CAS/price/currency. Run with `python -m pytest tests/`.

## Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project (Postgres + Auth)
- At least one extraction API key (match it to `EXTRACTION_PROVIDER`):
  - **Qwen/Dashscope** (default provider): from [Alibaba Cloud](https://dashscope.aliyuncs.com)
  - **Gemini** (alternative): from [ai.google.dev](https://ai.google.dev)
  - **Claude** (alternative): from [console.anthropic.com](https://console.anthropic.com)
  (The Qwen/Dashscope key is also required for scanned/image-only PDFs with any
  provider, since Qwen does the OCR.)

## Setup

### 1. Database

Open the Supabase SQL editor and run [`db/schema.sql`](db/schema.sql) once.

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS/Linux:         source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in the values
uvicorn app.main:app --reload
```

Backend runs on http://localhost:8000.

#### Run the backend with Docker (alternative to the venv above)

The backend is containerized ([`backend/Dockerfile`](backend/Dockerfile)); the
frontend is not (it's a static Vite build). Requires Docker Desktop **running**.

```bash
# from the repo root — reads backend/.env, publishes http://localhost:8000
docker compose up --build
```

Or without compose:

```bash
cd backend
docker build -t brochure-backend .
docker run --rm -p 8000:8000 --env-file .env brochure-backend
```

Notes:
- Config comes entirely from environment variables — **no `.env` is baked into
  the image** (`.dockerignore` excludes it); it's supplied at run time via
  `--env-file` / compose `env_file`.
- The container runs uvicorn **without** `--reload` (production) as a non-root
  user, and exposes a `/health` HEALTHCHECK.
- Keep `ALLOWED_ORIGIN` in `backend/.env` pointing at wherever the frontend is
  served (e.g. `http://localhost:5173`), or CORS will block it.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env        # then fill in the values
npm run dev
```

Frontend runs on http://localhost:5173.

> **UI primitives note:** the shadcn-compatible UI primitives (button, input,
> select, table, card, badge, progress, label, skeleton, plus kit pieces like
> `mono-chip`, `stat-card`, `empty-state`, `modal`) are hand-written in
> [`src/components/ui/`](frontend/src/components/ui/), styled with the design
> system's tokens (see [Design system & theming](#design-system--theming)), so
> the app runs after a bare `npm install`. Styling uses **Tailwind v4** (via the
> `@tailwindcss/vite` plugin); tokens are loaded from `tailwind.config.js` with
> `@config` in `src/index.css`.

### 4. Supabase Auth — password-reset redirect

The sign-in page has a **"Forgot password?"** flow: Supabase emails a link
that lands on `/reset-password`, where the user sets a new password. For that
link to work, allowlist the URL in the Supabase dashboard under
**Authentication → URL Configuration → Redirect URLs**:
`http://localhost:5173/reset-password` (plus the production equivalent when
you deploy). This is dashboard-only config — no env var or migration.

## User roles

Three roles (see [`CHANGES.md`](CHANGES.md) for full details):

| Role    | Search | Upload PDFs | Manage users |
|---------|--------|-------------|--------------|
| admin   | ✅     | ✅          | ✅           |
| manager | ✅     | ✅          | ❌           |
| viewer  | ✅     | ❌          | ❌           |

New users default to the **`viewer`** role (set by the `on_auth_user_created`
Postgres trigger — see `db/schema.sql`), so a fresh signup can search but
cannot upload or manage users until an admin promotes them.

After sign-in, **admins and managers land on the dashboard**
(`/admin/dashboard`); **viewers land on search** (`/search`). The sidebar only
shows links a role can actually use.

Admins change roles in-app on the **Users** page (`/admin/users`) — no SQL
needed. (You cannot change your own role, so the last admin can't lock
themselves out.) SQL alternative:

```sql
update public.profiles set role = 'manager' where id = '<user-uuid>';
```

**Bootstrapping the first admin:** the very first account has no admin to
promote it, so run this once in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where id = '<your-user-uuid>';
```

Then sign out and sign back in so the frontend re-fetches the role.

## Environment variables

See `frontend/.env.example` and `backend/.env.example`. Key backend values that
must be kept server-side only, never in the frontend or version control:

| Variable | Purpose |
|---|---|
| `EXTRACTION_PROVIDER` | `qwen` (default), `gemini`, or `claude` |
| `SEARCH_PROVIDER` | Provider for the AI search agent (text-only); empty = same as `EXTRACTION_PROVIDER` |
| `GEMINI_API_KEY` | Google AI API key (needed when provider=gemini) |
| `ANTHROPIC_API_KEY` | Anthropic API key (needed when provider=claude) |
| `QWEN_API_KEY` | Dashscope/local Qwen API key (needed when provider=qwen **and** for scanned PDFs on any provider) |
| `QWEN_API_BASE` | OpenAI-compatible base URL for Qwen |
| `SUPABASE_SERVICE_KEY` | Full database access (bypasses RLS) |
| `SUPABASE_JWT_SECRET` | Verifies user access tokens on protected routes |

## Design system & theming

The frontend uses a cohesive in-house design system (the "Marine" kit) built on
**Tailwind v4**:

- **Typography** — [Geist](https://vercel.com/font) for the UI and **Geist
  Mono** for precise data (CAS numbers, prices, counts), loaded via Google
  Fonts in `frontend/index.html`.
- **Tokens** — a fixed palette (`ink` cool-neutral, `brand` deep-teal accent,
  `success`/`warning`/`danger`) in `frontend/tailwind.config.js`, plus
  **semantic theme tokens** (`surface`, `fg`, `line`, `brand`, …) defined as CSS
  variables in `frontend/src/index.css` and exposed as utilities via
  `@theme inline`. Components use the semantic tokens, so a single `.dark` class
  re-themes the whole app.
- **Light / dark / system theme** — pick from the toggle in the sidebar (or the
  mobile top bar / login page). The choice is saved to `localStorage`; "system"
  follows the OS. An inline script in `index.html` applies the theme before
  first paint (no flash). Respects `prefers-reduced-motion`.
- **Data chips** — CAS numbers and prices render as small monospace chips
  everywhere they appear, so precise data is visually distinct from prose.

The app shell is a persistent, role-aware sidebar
([`components/layout/AppShell.tsx`](frontend/src/components/layout/AppShell.tsx))
that collapses to a drawer on mobile. The kit's primitives and pieces live in
[`src/components/ui/`](frontend/src/components/ui/).

> **Tailwind version:** this project is on Tailwind **v4** via
> `@tailwindcss/vite`. `src/index.css` starts with `@import "tailwindcss";` and
> `@config "../tailwind.config.js";` (v4 does not auto-read the JS config), and
> `postcss.config.js` is intentionally empty (the Vite plugin handles Tailwind
> and vendor-prefixing). Don't re-add the v3 `tailwindcss` PostCSS plugin.

## Security notes (see spec §5)

- Service role key + JWT secret live **only** in the backend `.env`.
- Every protected backend route re-verifies the caller's JWT and role
  ([`dependencies.py`](backend/app/dependencies.py)); the frontend route guards
  are UX only.
- CORS is locked to the exact `ALLOWED_ORIGIN` (no wildcard).
- Uploads are validated server-side by MIME type **and** `%PDF-` magic bytes,
  and capped at `MAX_UPLOAD_SIZE_MB` on both client and server.
- The upload endpoint is rate-limited (`slowapi`) to protect the API budget.
- Row Level Security is enabled on all tables; viewers can only read, and the
  search API never exposes `uploaded_by`.
- The original PDF is processed in memory and never written to disk.

## Build status

All phases complete (schema, backend auth/search/extraction/dedup, frontend
auth/search/upload, security pass, multi-provider support), plus: 3-tier
roles with in-app user management, a reload-safe server-side upload queue
with live progress, signup auto-login, and paginated search with sort
options and A–Z alphabet tabs (max 15 results per page). Search also has a
**live typeahead** (chemical / CAS / supplier suggestions), and the Upload page
has a persistent **upload history** — past uploads with date, supplier and
listing count, plus an **admin audit** of who uploaded which PDF, when, and
exactly which listings it added. Auth includes a **forgot-password / reset
flow** (`/reset-password` — see setup step 4), and the UI has loading
skeletons, an explanatory tooltip on the "review" badge, and a **mobile card
layout** for search results. Search gained an **AI search bar**
(`POST /search/ai`: an LLM converts the sentence into structured filters —
shown as removable chips — and the rows come from the same trusted search
path as the manual filters; rate-limited). Extraction now also captures a
**flexible `details` JSONB** per listing (flash point, hazard class, storage,
MOQ, … whatever the brochure prints) plus the printed **supplier website**,
and every result links to a **product detail page** (`/product/:id`) that
renders those details dynamically. Prices are **normalized to USD** for
sorting and price filters (mixed-currency brochures now rank correctly, and
unpriced listings sort last — both were bugs), with **≈ USD · PKR
conversions** shown under every printed price (free exchange-rate API, no
key, DB-snapshot fallback). Admins can **edit or delete any listing in-app**
(product page — fixes extraction mistakes without SQL, including clearing the
"review" flag), every upload in the history has an **Undo** button (removes
exactly the listings it added, keeping ones shared with other uploads), and
the product page has an honest **"Find this product online"** web-search
link. The frontend now uses a cohesive **design system** with **light / dark
theming** (see [Design system & theming](#design-system--theming)) applied to
every page, a persistent role-aware **sidebar shell**, and a new **admin /
manager dashboard** (`/admin/dashboard`) — stat cards (total listings, distinct
suppliers, uploads in the last 7 days, listings needing review) from a single
`GET /admin/dashboard/summary` aggregate, plus recent uploads (with Undo) and,
for admins, the in-place user role editor. Free-text search matches a **single
broad surface** — product names, CAS, the flexible details text, and the
supplier's bilingual names (computed field `search_text`, migration
`add_listings_search_text`) — so supplier searches and description-only
chemicals (e.g. "titanium dioxide" → grade HR990) work. Product details open
in a **right-side slide-in panel** over the still-mounted list (Escape /
outside-click / X to close; `/product/:id` remains for shareable links), and
the search page restores its **state + scroll position** across full
navigations via sessionStorage. All three data views (search results, upload
history, per-upload listings) share one **bulk select + delete** mechanism
(checkboxes, page-scoped select-all, visible count, confirm dialog;
`POST /listings/bulk-delete` for listings, sequential per-upload undo for
uploads). A **Suppliers directory** (`/suppliers`, all roles) lists every
extracted supplier — bilingual names, printed email/phone (captured from
uploads going forward), website(s), listing count — with a slide-in supplier
panel and a link into that supplier's products via search. The dashboard's
"Needs review" card opens a **review queue** (`/admin/review`,
admin + manager) built on the existing `needs_review` flag, grouped by
source PDF: mark verified, edit, delete selected listings, or delete the
whole file. **Managers can now edit/delete listings** (PATCH/DELETE/bulk
moved to admin+manager). The listing edit form pops open on demand, covers
the flexible **technical details** (add/change/remove entries), and every
delete confirms via a dialog. An admin-only **Activity log**
(`/admin/audit`) records who uploaded, edited, and deleted what. Backend
modules byte-compile; the frontend typechecks and builds cleanly.

> **No new environment variables** were introduced by the typeahead or upload
> history features. The only DB change is the `documents.listing_ids uuid[]`
> column (migration `add_documents_listing_ids`), already applied to the live
> database. See [`CHANGES.md`](CHANGES.md) parts 5–6.

**Change log / architecture notes:** [`CHANGES.md`](CHANGES.md) (narrative:
flow, API surface, gotchas) and [`changes.json`](changes.json) (structured
file-by-file summary). Read these before refactoring — they document the live
DB shape (which differs from `db/schema.sql` history) and two
environment-specific gotchas (Supabase `%`-wildcard edge bug, unreliable
`uvicorn --reload` on this machine).
