# Architecture — BrochureDB

**Single source of truth.** Every statement here was verified against the code on
**2026-07-26** (extraction/prompt sections re-verified **2026-07-30**). Where the code
and an older document disagreed, the code won; where the code disagrees with itself,
§12 says so explicitly.

Supporting docs: [PRODUCT.md](PRODUCT.md) (why), [DESIGN.md](DESIGN.md) (visual
system), [manual_test.md](manual_test.md) (QA checklists). Everything else has been
moved to [docs/archive/](docs/archive/) and is historical — do not treat it as current.

---

## 0. Read this first — three extraction paths, only one is live

The repo contains **three** brochure-extraction implementations. They look
comparably finished. Only the first one runs when a user uploads a PDF. Confusing
them wastes hours and, once, cost us real data (see the incident below).

| | **A. Per-page worker** | **B. Whole-document** | **C. Reference CLI** |
|---|---|---|---|
| Entry | `worker.py` → `page_extract.extract()` | `jobs.py` → `extraction.extract_brochure()` | `python -m app.pipeline` |
| **Status** | ✅ **LIVE — this is production** | ❌ orphaned, zero importers | ⚠️ offline tool only |
| Reachable from the API? | yes | **no** | no |
| Unit of work | one page per call | whole PDF per call | whole PDF |
| Queue state | Postgres (`documents`/`pages`) | in-memory dict | none |
| Survives a restart? | yes | **no** | n/a |
| Providers | `qwen`, `claude` | claude, gemini, qwen, gpt, glm, nuextract | qwen only |
| JSON guaranteed by | forced `tool_use` / `json_object` | prompt + tolerant parsing | guided decoding (`guided_json`) |
| Prompt it uses | `STAGE2_SYSTEM` | `EXTRACTION_PROMPT` | `EXTRACTION_PROMPT` |

**Why A replaced B:** B held an entire PDF in memory, so one failure lost the whole
document and a backend restart lost the queue. A stores each page as a DB row with a
status machine, so a crash resumes and a bad page fails alone. A's tradeoff is that
cross-page context must be threaded explicitly (`context_for_next_page`) — no single
call sees the whole document.

**C is not a lesser version of A.** It uses vLLM guided decoding, which constrains
generation token-by-token against the JSON schema — a stronger correctness guarantee
than A has. It also carries a `formula` field and `RepairStats` accuracy telemetry
that production lacks. If extraction accuracy remains the bottleneck, porting guided
decoding into A's stage 2 is more principled than further prompt tuning.

Detail on all three: §12.2 (dead code) and §12.3 (`app/pipeline/*`).

### Prompts: one package, one copy of each rule

**All prompt text lives in [`backend/app/prompts/`](backend/app/prompts/).** Service
modules import prompts; they never define them.

Shared extraction rules live exactly once in
[`app/prompts/_rules.py`](backend/app/prompts/_rules.py) as composable blocks, and
both `STAGE2_SYSTEM` (path A) and `EXTRACTION_PROMPT` (paths B and C) compose from the
same tuple. **Edit a rule there and every path gets it.** Never copy a rule between
prompt files. `app.prompts.PROMPT_REGISTRY` enumerates every prompt with a
live/not-live flag.

This structure exists because of a specific failure. A Dairen Chemical brochure
printed `Vinyl acetate-ethylene (VAE) emulsion` **once**, as a merged full-width row
inside a spec table, above ~14 grade rows (`DA-100`, `DA-100L`, …). Every row was
stored as a bare code with no family name, so searching "Vinyl acetate-ethylene"
returned nothing for products we hold. Two independent causes, one per stage:

- **Stage 1** — a merged full-width cell cannot be expressed in a markdown table, so
  the label stopped being attached to the rows beneath it.
- **Stage 2** — the live prompt's only inheritance rule covered labels "printed on an
  earlier page". This one was on the *same* page, so no rule applied.

The rule that would have prevented it **already existed** — in `EXTRACTION_PROMPT`,
which path A never calls. The rule had been written twice by hand and only the dead
copy got improved. That duplication was the bug, and `_rules.py` is the fix.

---

## 1. What the system is

An internal tool for **BosTech Polymer** (Dubai chemical supplier). Staff collect
600–2,000 scanned supplier brochures per trade expo. The system extracts structured
product data (name, CAS, purity, specifications, supplier) from those PDFs so a buyer
can search a chemical and immediately see who sells it and on what specification.

> **Price is a bonus field, not the spine.** Most brochures are specification sheets
> and print no price — **zero listings in the live catalog carry one**. That is a fact
> about the source documents, not an extraction bug. Price is captured faithfully when
> printed and null otherwise; nothing ranks, gates, or filters by it by default
> (§10, §14.3). The comparison axis is specification. See
> [PRODUCT.md](PRODUCT.md) → "Price is not the product". The metric that actually
> matters is **identity completeness** — whether a listing carries the full name of
> what it is (§0).

The load profile shapes the whole design: **idle for weeks, then thousands of pages
in a few hours.** Throughput after a spike matters; steady-state cost does not.

- **Frontend** — React 18 + Vite + Tailwind v4 + TanStack Query + Supabase JS, in `frontend/`
- **Backend** — FastAPI (Python), in `backend/`
- **Data** — Supabase (Postgres + Auth + Storage)
- **Extraction** — a two-stage VLM pipeline run by standalone worker processes

## 2. Runtime topology

Three backend processes, plus the frontend. **All shared state is in Postgres** —
no process holds queue state in memory, so any of them can be restarted at any time.

| Process | Command | Instances |
|---|---|---|
| API | `uvicorn app.main:app` | 1 |
| Extraction worker | `python -m app.worker` | 1–N (concurrency *is* the replica count) |
| Reconciler | `python -m app.reconciler` | exactly 1 |
| Frontend | `npm run dev` (dev) / static build (prod) | 1 |

Locally, `./run.sh [start N | workers N | status | logs | stop]` runs all four;
`workers N` rescales the pool mid-batch without bouncing the API. Running the API
alone accepts uploads that nothing will ever process — the most common local
mistake, which is why `run.sh status` calls out a missing worker or reconciler
explicitly.

```
Browser ──POST /upload-jobs──▶ FastAPI          (repeat per file — free, no AI)
                                │ 1. validate + SHA-256 + dedup
                                │ 2. INSERT documents (status='splitting')
                                │ 3. background: retain PDF in Storage
                                │    ──▶ flip status='staged'   ◀── NOT claimable
                                ▼
                          [ user presses "Start processing" ]
                       POST /upload-jobs/start → 'pending'
                                ▼
                    documents  ◀── the work queue (Postgres)
                        ▲   │
      reconciler ───────┘   │ claim_next_document()  [FOR UPDATE SKIP LOCKED,
      (30s, heals)          ▼                         longest-job-first]
                       Worker process
                         1. lazy split → pages rows + PNGs in Storage
                         2. resolve supplier (first 2 + last 2 pages)
                         3. per page, in order: extract() → INSERT listings
                            → delete that page's image
                         4. finalize → delete retained PDF
                                │
                                ▼
              listings · companies · chemicals · audit_log
                                │
                                ▼
              Search · Dashboard · Review queue · Suppliers UI
```

**Uploading and processing are separate steps.** A user can upload 50 brochures
across several selections; they sit in `staged`, costing nothing, until the
explicit go-ahead. This is the spend gate — no AI call happens before it.

The read-side UIs (search, dashboard, review, suppliers) were untouched by the
pipeline migration — they read `listings`/`companies`/`chemicals`, which the worker
writes.

## 3. Data model

Six tables carry the product data, two carry pipeline state.

### `documents` — one row per uploaded PDF (work queue **and** dedup ledger)

| Column | Notes |
|---|---|
| `content_hash` text **PK** | SHA-256 of the PDF — the upload dedup guard |
| `id` uuid, unique | FK target for `pages` / `listings` (PK stays `content_hash`) |
| `status` text | `splitting · staged · pending · split · claimed · extracting · paused · done · failed · cancelled` — `staged` is uploaded-but-not-released (the claim query ignores it) |
| `running_context` jsonb | table headers / product family carried across pages |
| `page_count` int | written at split |
| `claimed_by`, `claimed_at` | worker ownership + stall heartbeat |
| `cancel_requested` bool | set by the cancel endpoint |
| `company_id` bigint FK | resolved supplier, stamped before listings are written |
| `product_count` int, `listing_ids` uuid[] | ledger fields for upload history + undo |
| `filename`, `uploaded_by`, `created_at` | |
| `error` text | plain-English reason the last `failed` outcome happened; read by `GET /upload-jobs`, shown in the upload UI (2026-07-29) |
| `fatal` bool | set alongside `error` when the worker stopped for an unrecoverable reason (bad key, no credit, unknown model) — tells the reconciler not to auto-retry; a manual Restart clears it (2026-07-30) |

### `pages` — one row per page image

`id` uuid PK · `document_id` uuid FK (cascade) · `page_number` int (unique with
`document_id`) · `image_path` text (Storage key) · `status`
(`pending·claimed·extracting·done·failed·dead`) · `attempts` int (drives
dead-lettering) · `markdown_output` text and `raw_json` jsonb (stage-1/2 outputs,
kept for audit) · `error_message` · `claimed_at` · `created_at`.

### `listings` — one supplier's offer for one product

Identity/price: `name_raw`, `name_en`, `cas_number` (canonical), `cas_number_raw`
(exact as printed), `price`, `currency`, `price_usd` (computed at insert), `purity`,
`details` jsonb, `company_website`.
Links: `chemical_id`, `company_id`, `document_id`, `source_page_id`.
Review: `needs_review` bool, `review_reason` text.
Dedup: `dedup_key` (unique) — an identical offer from the same company **upserts**
rather than duplicating ([database.py:546](backend/app/services/database.py#L546)).

### `companies` — suppliers

`company_name`, `company_name_en`, `website`, `website_domain` (partial-unique,
the primary dedup key), `email`, `contact_number`, `extra_details` jsonb.

### `chemicals` — canonical substance identity

CAS-first dedup layer so the same substance sold under different trade names groups
together in search.

### `profiles`, `audit_log`, `exchange_rates`

Roles (`viewer` / `manager` / `admin`), the activity feed, and the cached FX snapshot.

### Storage

Private bucket **`brochure-pages`**: `{doc_id}/source.pdf` (the retained PDF) and
`{doc_id}/NNNN.png` (page images). The backend writes with the service-role key;
the UI reads via signed URLs.

> ⚠️ The repo's SQL does not fully describe this schema. See §12.1.

## 4. Upload path — [`routers/upload.py`](backend/app/routers/upload.py)

`POST /upload-jobs` (admin/manager, rate-limited 120/min):

1. Validate content-type, read fully into memory (never to disk), reject empty,
   over `MAX_UPLOAD_SIZE_MB` (20), or missing `%PDF-` magic bytes.
2. SHA-256 → **dedup**: a known `content_hash` returns immediately as a duplicate,
   no work performed.
3. `create_document(...)` inserts the row as **`splitting`** — deliberately not a
   claimable status.
4. A FastAPI background task retains the PDF in Storage, **then** flips the status to
   **`staged`**. Ordering matters: a released document always has its PDF.

`POST /upload-jobs/start` (the "Start processing" button) flips the caller's
`staged` documents to `pending`, which is the only thing standing between an
uploaded PDF and the worker's claim query. It is scoped to the caller's own
documents, so one user's press can't release another's batch, and it skips
anything already flagged for cancellation — releasing one would produce a
document no worker will ever claim. An optional `document_ids` body narrows it to
a subset.

`POST /upload-jobs/{id}/discard` deletes a `staged` document outright, PDF and
all. Safe precisely because `staged` means nothing has run: no pages, no
listings, no supplier. It refuses (`409`) once the document has moved past
`staged` — from there the path is cancel, then undo-upload.

The upload response is `202` with the document's status; the client polls
`GET /upload-jobs`, which returns the caller's recent documents with derived
`pages_done`/`page_count` progress. Because progress lives in the DB, a browser
reload or backend restart loses nothing.

Per-document controls: `POST /upload-jobs/{id}/{pause|resume|cancel|restart|discard}`.
History and undo: `GET /uploads/history`, `/uploads/history/all`,
`GET /uploads/{hash}/listings`, `DELETE /uploads/{hash}`.

## 5. The worker — [`app/worker.py`](backend/app/worker.py)

A standalone process. **Concurrency = number of worker processes.** There is no
in-process page scheduler and no rate-limit tuning: each worker has exactly one
extraction call in flight at a time.

**Claim** — atomic and contention-safe via the `claim_next_document(worker_id)`
Postgres RPC (`FOR UPDATE SKIP LOCKED` can't be expressed through PostgREST).
Longest-job-first (`order by page_count desc`) so the tail shrinks during a spike.

**Per document** ([worker.py:167](backend/app/worker.py#L167)):

1. **Lazy split** — if the document has no `pages`, download the retained PDF, render
   each page to PNG, upload, insert `pages` rows. Idempotent: images upsert on a
   deterministic path and `pages` is unique on `(document_id, page_number)`, so a
   crash mid-split re-splits safely ([splitter.py:27](backend/app/services/splitter.py#L27)).
2. **Supplier resolution** — a focused pass over the **first two + last two** pages
   (cover/footer, where company identity usually lives). On the `claude` pipeline the
   pages go to Claude directly as images (native vision, no OCR step); every other
   pipeline OCRs them with Qwen first, then runs the company prompt. If that narrow
   pass finds nothing, one wider retry runs over the next few not-yet-tried pages
   (capped at 8 pages total) before giving up — see
   `_extract_identity`/`_identity_pass` ([worker.py:62](backend/app/worker.py#L62)).
   `supplier.resolve_company` then resolves/creates the company row, and the
   resulting `company_id` is stamped on the document *before* any listing is written.
3. **Page loop**, in order, skipping pages already `done` (crash-resume):
   - `page_extract.extract(image, running_context)` → write listings;
   - update the page (`done`, markdown, raw JSON, attempt count);
   - **delete that page's image** — see §8;
   - **heartbeat `claimed_at`** so the reconciler can tell a live worker on a long
     document from a dead one;
   - persist the returned `running_context` for the next page;
   - **between pages only** — never mid-page — check for pause or cancel.
   A page whose extraction raises is marked `failed` with the error. If the failure
   is **fatal** (bad/expired key, no credit, unknown model — see §6) the document
   stops right there with `documents.error` set to a plain-English reason and
   `documents.fatal = true`, instead of failing every remaining page one at a time.
   A non-fatal failure (schema-invalid output after retries) just moves to the next
   page.
4. **Finalize** ([worker.py:277](backend/app/worker.py#L277)) — status becomes
   `cancelled` if cancelled, `failed` if any page is still non-terminal, else `done`.
   A `failed` finalize also writes `documents.error` from the last page's error
   message, so a document that finished its run without a clean pass still has a
   visible reason rather than a bare "failed". Only on `done` is the retained PDF
   deleted and an `upload` audit entry written. `product_count` / `listing_ids` are
   recomputed **from the DB**, not from the in-run list, so they stay complete across
   a crash + resume.

A crash anywhere loses at most the page in flight. A bad document can't kill the
worker — the loop catches, marks it `failed`, and continues.

## 6. Extraction — [`services/page_extract.py`](backend/app/services/page_extract.py)

`extract(image, context) -> PageExtraction` is **the one place the model is chosen.**

Prompt text and the stage-2 tool schema live in
[`app/prompts/`](backend/app/prompts/), not in this module — see §0.

**Stage 1 — image → markdown.** The VLM transcribes the page faithfully, tables and
all. The document's `running_context` is injected as a *continuation hint*, so a
table header printed several pages back is not lost. On the Claude path the static
half of the prompt is sent as its own content block marked
`cache_control: ephemeral`, so it bills at 0.1x base input after the first page of a
document; the per-page continuation hint stays uncached and is omitted entirely on
page 1.

A merged full-width label row inside a table (a family/category name spanning every
column) is transcribed as a **markdown heading followed by a fresh table**, not as a
table row — markdown cannot express a merged cell, and transcribing it as a row
silently detaches the label from the rows it describes. See §0 for the incident.

**Stage 2 — markdown → JSON.** Structured per-listing output: `name_raw`, `name_en`,
`product_family`, `cas_number_raw`, `price`, `currency`, `purity`, `characteristics`,
`confidence`, plus `context_for_next_page`. Retried up to 2 attempts; every listing
from a page that needed more than one attempt is flagged for review. The system
prompt and tool schema are both `cache_control: ephemeral` — identical on every page,
so they bill at 0.1x after page 1.

`product_family` carries the category/family label a row inherits from a heading,
merged table row, or continuation context (e.g. `Vinyl acetate-ethylene (VAE)
emulsion` for a `DA-100` row). The model must put the full label in the *name* **and**
in this field; the worker merges it into `listings.details` via `_build_details()`
using `setdefault`, so an explicit `characteristics.product_family` is never
clobbered. Without it a bare grade code is unfindable by anyone searching for the
substance.

**Provider routing** (`PAGE_EXTRACT_PROVIDER`, only `qwen` or `claude` accepted):

| Provider | Stage 1 | Stage 2 |
|---|---|---|
| `qwen` *(current / testing)* | `qwen-vl-max` vision call | `response_format={"type":"json_object"}` + Pydantic validation |
| `claude` *(production)* | Claude vision call | genuine forced `tool_use` (`record_page_listings`) |

The Qwen path uses `json_object` rather than tool-calling because Dashscope's
OpenAI-compatible endpoint does not reliably honor a forced `tool_choice` on its
vision models. Both paths receive the same image and the same schema; switching is a
config change, never a new code path. A blank stage-1 transcription is treated as a
legitimately empty page, not an error.

Low-level clients and the retry policy are reused from `services/extraction.py`
(`_get_qwen`, `_get_anthropic`, `_parse_json`) so there is one client abstraction —
see §11 for what else in that module is and isn't live.

**Error classification** (`extraction.friendly_provider_error`,
`extraction._is_transient_claude_error`) — a provider exception is sorted into
transient (rate limit, connection drop, 5xx — retried automatically, up to
`api_max_retries`) or fatal (invalid/expired key, no credit, unknown model — never
retried, since the same call fails identically every time). `PageExtractError`
carries a `fatal: bool`; the worker uses it to stop a document immediately instead of
retrying a dead end across every remaining page (§5). The classifier covers both SDKs
the app drives directly (Anthropic; OpenAI — also what Qwen's DashScope endpoint
speaks) and always returns a plain-English message naming the feature and what to do
about it, never a status code or raw SDK text. The same classifier backs the chat
assistant (§14) and AI search (`nl_search.py`) error paths.

## 7. CAS, supplier, and review

**CAS** — [`services/cas.py`](backend/app/services/cas.py), pure and unit-tested. The
model transcribes the CAS exactly as printed into `cas_number_raw`; application code
strips label prefixes, extracts digits, re-hyphenates to canonical `(2–7)-(2)-(1)`,
and validates the check digit. Canonical → `listings.cas_number`; the raw string is
always kept. Out-of-range digit counts leave `cas_number` null.

**Supplier** — [`services/supplier.py`](backend/app/services/supplier.py), domain-first:
1. normalized website domain, exact match against `companies.website_domain`;
2. email domain, exact — only when no website was found;
3. fuzzy name (rapidfuzz `token_sort_ratio`), conservative — **ambiguous creates a new
   row rather than risking a false merge**.

A matched row is backfilled with newly-learned details (first printed value wins).
A company created with no name at all gets the placeholder `"Unknown supplier"`; that
placeholder specifically (not just a blank field) is also backfillable, so a later
brochure from the same domain/email that prints a real name corrects it.

**Manual override** — when detection finds nothing, or the wrong supplier, an
admin/manager can fix it from the listing editor: `PATCH /listings/{id}` accepts
`company_id` (reassign to an existing supplier, searched via `GET /suppliers`) or
`new_company_name` (create one). This is the only recourse for an already-`done`
document — its page images are deleted as each page completes (§8), so nothing is
left to auto-retry supplier detection from after the fact.

**Chemicals** — [`services/dedup.py`](backend/app/services/dedup.py): CAS is
authoritative when present; with no CAS, an exact English-name match is confident and
a fuzzy match at ≥97 is accepted **but flagged for review**.

**`needs_review` triggers** (joined into `review_reason`,
[worker.py:91](backend/app/worker.py#L91)): CAS checksum failed · product name empty ·
CAS blank while sibling rows on the same page have one · page needed a stage-2 retry ·
model self-reported `confidence: low` · ambiguous chemical-name match.

## 8. Lifecycle: retention, pause, cancel, restart

All of these are status/flag transitions in
[`services/pipeline_db.py`](backend/app/services/pipeline_db.py) — no work is destroyed.

- **PDF retention** — kept until every page is terminal (`done`/`dead`), then deleted.
  Retained for `staged`, `failed`, `cancelled`, and `paused` so a restart can resume
  or re-split without a re-upload.
- **Page-image retention** — a page's PNG is deleted **the moment that page reaches
  `done`**, inside the worker's loop, not at document completion. Peak Storage
  therefore tracks work-in-progress rather than the whole corpus. This is safe
  because a `done` page is never reprocessed.
  **Images for pages that are not `done` are never deleted** — that's a correctness
  constraint, not a preference: restart deliberately doesn't re-split when page rows
  exist, so a missing image would fail that page repeatedly until it dead-letters.
  A `failed` document thus retains exactly the images it needs and nothing more.
  Debugging doesn't depend on the image: `markdown_output` (what the model read) and
  `raw_json` (what it produced) persist on the page row.
- **Pause / resume** — pause sets `status='paused'`, which the claim query excludes;
  the in-flight page finishes and the worker stops. Resume returns it to a claimable
  status (`split` when pages exist, else `pending`). **No page is ever reprocessed.**
- **Cancel** — the worker stops at the next page boundary. **Listings already written
  and the resolved supplier are never rolled back** — cancel means "stop spending",
  not "undo". Use the undo-upload endpoint to remove the data.
- **Restart** (from `failed`/`cancelled`) — if page rows exist, resume at the first
  incomplete page: `done` pages are kept, `failed`/`dead` reset to `pending`, **no
  re-split**. Only a document with zero page rows re-splits from the retained PDF.

## 9. Reconciler — [`app/reconciler.py`](backend/app/reconciler.py)

One instance, sweeping every `RECONCILER_INTERVAL_SECONDS` (30). Each sweep:

1. **Dead-letter** pages that have failed `>= MAX_PAGE_ATTEMPTS` (3) → `dead`, so they
   surface in review instead of retrying forever.
2. **Finish** any non-terminal document whose pages are all terminal → `done`, and
   delete the retained PDF.
3. **Retry** `failed` documents that still have retriable pages → claimable again.
   Skipped when `documents.fatal` is true — the worker set that when it stopped the
   document for a reason retrying can't fix (§5/§6); only a manual Restart (which
   clears the flag) tries it again.
4. **Reset stalled claims** — a document `extracting` past `DOCUMENT_STALE_SECONDS`
   (300) with no page heartbeat means its worker died → claimable by another worker.

Guard: a document with no pages **and** no retained PDF is left `failed` rather than
looped forever. The reconciler never deletes listings or suppliers — only status/page
transitions and an already-superseded PDF.

## 10. Read side

**Auth** ([`dependencies.py`](backend/app/dependencies.py)) — Supabase JWTs verified
locally (ES256 via JWKS, or HS256 with the project JWT secret), no round-trip to the
auth server. `require_user` → any logged-in user; `require_uploader` → admin *or*
manager; `require_admin` → admin only. Table-level RLS restricts direct client reads;
all backend writes use the service-role key and bypass RLS.

**Search** ([`database.py:913`](backend/app/services/database.py#L913)) — one function
serves both the filter UI and the AI search bar; there is no second query path. Axes:
free text `q` (matched against the `search_text` computed field — product names, CAS,
flattened `details`, *and* supplier names), `supplier` (resolved name → company ids →
`company_id IN (...)`), `cas_number`, USD price bounds against the normalized
`price_usd`, `priced_only`, `details_query`, `letter` (A–Z bar), sort, and server-side
pagination. **Purity is the exception**: it is free text, so purity bounds are applied
in Python *after* pagination and a page may render slightly fewer rows than
`page_size`.

**AI search** (`POST /search/ai`) — [`nl_search.py`](backend/app/services/nl_search.py)
asks a text model to turn a plain-language query into `InterpretedFilters`, validates
it with Pydantic, then calls the same `search_listings`. Provider =
`SEARCH_PROVIDER` or, when unset, `EXTRACTION_PROVIDER`.

**Sourcing assistant** (`POST /chat/...`) —
[`chat_agent.py`](backend/app/services/chat_agent.py). A tool-calling chat
docked in the Search screen, for questions the filter UI can't express ("what
do we stock for floor coatings?", "X is banned, what else works?").

*Providers*: `CHAT_PROVIDER` selects `anthropic` | `gpt` | `qwen` — one per
deployment, not a fallback chain. Three options, **two** loops
([`chat_providers.py`](backend/app/services/chat_providers.py)): Qwen's
DashScope endpoint is OpenAI-compatible, so `gpt` and `qwen` share one loop and
differ by base URL / key / model. Anthropic needs its own (different tool-use
wire format). Tools are declared once in
[`agent_tools.py`](backend/app/services/agent_tools.py) and rendered into both
formats.

*Tools* wrap the same trusted read path as everything else:
`search_catalog` (→ `search_listings` with `columns=AGENT_COLUMNS`),
`compare_suppliers`, `list_detail_keys`, `get_listing_provenance`.

**The agent's tool surface is deliberately narrower than the search API.**
`priced_only` is not exposed: most listings have no printed price, and in
testing the model set the flag unprompted despite an explicit instruction not
to, turning "we stock one flooring admixture" into "the catalog has nothing for
floor coatings". A silent false negative on availability is the worst answer
this assistant can give. The manual filter UI still offers it, where the user
turns it on knowingly and can see that it is on.

A `CallGuard` (one per turn) rejects a repeat of an identical tool call —
models re-issue the same failing search rather than varying it, burning the
iteration budget.

**Query widening.** `search_listings` matches a phrase as a literal substring,
so "hydrocarbon resins" misses "Hydrocarbon Resin C5&C9" on the plural `s`
alone — 25 products reported as none. Both models tested failed this
identically, which makes it a retrieval bug, not a prompting one.
`_search_catalog` therefore retries progressively: the phrase, then
singularised, then individual words, choosing the **rarest** non-empty match
(for "floor coatings", `floor` at 1 hit reads the question far better than
`coatings` at 8).

When widening drops a word the substance can change — "calcium carbonate"
widens to "carbonate" and matches *dimethyl* carbonate. Those hits are returned
under `related_rows` with `rows` empty, so the primary answer is unambiguously
zero while the near-misses stay visible and citable. Returning them as ordinary
rows produced "we stock zinc oxide, but neither is in the catalog"; withholding
them entirely produced a false negative on flooring. Neither extreme is right,
and no lexical rule separates a compound name from an application phrase —
that is precisely what the P3 embedding layer is for.

*Ranking is not by price.* Most brochures print none, so the assistant ranks by
fit to the stated requirement using the `details` blob. `AGENT_COLUMNS` exists
precisely because `SEARCH_COLUMNS` omits `details` — without it the model would
see names and mostly-null prices and have nothing to reason with.

*Trust boundary*: the model cites products as `[[uuid]]` markers; the backend
intersects those with ids its tools actually returned, drops the rest, strips
the markers, and returns the surviving rows fetched from the database. The UI
renders those rows — so a hallucinated price in the prose can never reach the
user as data.

*Lifetime*: threads are ephemeral, held in process memory
([`chat_session.py`](backend/app/services/chat_session.py)) and destroyed when
the panel closes or after `CHAT_TTL_MINUTES`. Capped at 20 messages (hard stop,
not a rolling window). **This binds a thread to one backend process** — moving
to multiple workers requires Redis or a TTL table. The durable record is one
`chat_query` row in `audit_log` per exchange.

*Progress events*: `POST /chat/threads/{id}/messages/stream` is SSE. Both loops
take an `on_event` callback and emit `thinking` / `tool` / `tool_done` /
`done` / `error`; the UI renders a live activity trail. The agent runs in a
worker thread and events cross back through a queue. **Errors after the stream
opens arrive as an `error` event, not an HTTP status** — a stream that ends
without `done` is a failure. The non-streaming `POST .../messages` remains for
scripted callers.

*Not in P1*: token-level streaming (per-provider delta normalisation),
embeddings/semantic similarity, web search.

**Currency** ([`rates.py`](backend/app/services/rates.py)) — `price_usd` is computed
and stored at insert time so cross-currency sorting works on one column. PKR is
converted at read time (a stored PKR would go stale). Rate source, in order:
12h in-memory cache → live `open.er-api.com` fetch (snapshotted to `exchange_rates`)
→ last DB snapshot → hardcoded seed. Conversion never hard-fails; the UI marks
converted values `≈`.

**Dashboard** — counts via PostgREST exact-count queries. The status distribution is
three **disjoint** slices that sum to the total: `needs_review` wins, `missing_price`
is the unflagged price-null remainder, `complete` is what's left.

**Review queue** — listings with `needs_review = true`, newest first, each annotated
with the upload that produced it by inverting the `documents.listing_ids` arrays in
Python (PostgREST has no efficient array-contains for this shape).

## 11. Configuration — [`app/config.py`](backend/app/config.py)

Pydantic-settings, loaded from `backend/.env`.

**Live and load-bearing:**

| Setting | Default | Role |
|---|---|---|
| `supabase_url` / `supabase_service_key` / `supabase_anon_key` / `supabase_jwt_secret` | — | data + auth |
| `page_extract_provider` | `qwen` (code default; this deployment overrides to `claude` via the DB settings table) | **the** extraction switch (`qwen` \| `claude`) |
| `page_extract_claude_model` / `claude_model` | `""` / `claude-haiku-4-5-20251001` (code default; deployed as `claude-sonnet-5`) | stage-2 model when provider is `claude` |
| `qwen_api_key` / `qwen_api_base` / `qwen_model` | `qwen-vl-max` | stage 1+2 on the Qwen path, and OCR |
| `anthropic_api_key` | — | Claude path |
| `extraction_provider` / `search_provider` | `qwen` / `""` (code default; deployed as `claude` / `""`) | **AI search only** (and the identity pass's text call) |
| `page_concurrency` | 5 | OCR fan-out in the supplier-identity pass only |
| `reconciler_interval_seconds` / `document_stale_seconds` / `max_page_attempts` | 30 / 300 / 3 | reconciler |
| `max_upload_size_mb` | 20 | upload gate |
| `split_dpi` | 200 | render resolution for page PNGs. Trades extraction recall for image size — small print (CAS digits) degrades first, so measure against `test file/` before lowering |
| `allowed_origin` | `http://localhost:5173` | CORS (exact origin, no wildcard) |
| `api_max_retries` | 3 | tenacity retry cap on external calls |

**Present but not reachable from any live path** — see §12.2: `openai_*`,
`gemini_*`, `openrouter_*` / GLM, `nuextract_*`, `pubchem_enrichment`,
`pubchem_cas_lookup`, and the `pipeline_*` / `qwen_vlm_model` / `qwen_text_model`
group (which belongs to the offline CLI in §12.3).

## 12. Known gaps between this document and the repo

These are real and were confirmed by reading the code. They are **not** fixed here —
this section exists so nobody rediscovers them the hard way.

### 12.1 The SQL in the repo does not describe the live database

`db/schema.sql` predates several migrations, and `schema-additions.sql` only
`ALTER`s tables it assumes already exist.

**Closed 2026-07-30** by `20260730000002_backfill_missing_functions.sql`, captured
from the live project with `pg_get_functiondef` so it reproduces production exactly:

- ~~**`claim_next_document`**~~ — the RPC the worker's claim loop depends on. Now in
  version control.
- ~~`search_text` / `details_text`~~ — now in version control. Note these are
  PostgREST **computed fields (functions taking the row type)**, *not* columns, so
  they never appear in `information_schema.columns`. Auditing for them as columns
  reports them missing when they are fine.

Still missing from version control:

- The `CREATE TABLE` for `documents`, `audit_log`, and `exchange_rates`.
- The remaining generated columns: `price_usd`, `dedup_key`,
  `listings.company_website`.
- Creation of the `brochure-pages` Storage bucket and its policies.

**A fresh environment still cannot be provisioned from this repo alone** — the
function backfill removes the worker-crashes-on-first-claim failure, not the
missing tables. The durable fix is a baseline dump (`supabase db dump --schema
public`) committed as an initial migration.

Newer schema changes live in `supabase/migrations/` (mirrored to `db/migrations/`).
`supabase/migrations/` is what the Deploy Supabase migrations workflow reads —
`db/migrations/` is documentation only and applies nothing.

### 12.2 Dead code that still looks live

- [`services/jobs.py`](backend/app/services/jobs.py) (516 lines) — the old in-memory
  queue. **Zero importers.** It is the system the pre-migration architecture doc
  described.
- `extract_brochure` and the whole multi-provider path in
  [`services/extraction.py`](backend/app/services/extraction.py) — GPT, Gemini, GLM,
  NuExtract, bundle-splitting, page-merging. Reachable only from `jobs.py`, so
  unreachable. **The rest of that module is live**: `page_extract`, `worker`, and
  `nl_search` all use its clients, prompts, retry policy, JSON parsing, and — as of
  2026-07-29 — its `friendly_provider_error` error classifier and
  `complete_claude_vision` (used by `worker._extract_identity` for the Claude
  pipeline). Those additions live in the same module as the dead
  multi-provider path but are called from live code; `extract_brochure` itself
  is not.
- **PubChem enrichment** (`services/enrich.py`) is called only from
  `extract_brochure` — so it **no longer runs**. Listings receive no reference data
  and no name→CAS lookup, despite `pubchem_enrichment` / `pubchem_cas_lookup`
  defaulting to true. This is a silent functional regression from the migration.

### 12.3 `app/pipeline/*` is a separate offline tool

A two-model reference pipeline (Qwen VLM transcription → Qwen text model →
schema-constrained JSON) with its own CLI, `python -m app.pipeline <brochure.pdf>`.
It is **not** part of the running service — nothing in `app/main.py`, `app/worker.py`,
or `app/reconciler.py` imports it. Three test files cover it. Keep it or delete it
deliberately, but don't mistake it for the production path.

### 12.4 Smaller code/behaviour mismatches

- The worker writes the model's `characteristics` into **`listings.details`**, not
  `listings.characteristics` — `details` is the column the search index, product
  detail page, and admin editor actually read. The `characteristics` column exists
  and is never read ([worker.py:149](backend/app/worker.py#L149)).
- `review_reason` is written by the worker but **not selected** by the review queue
  (`SEARCH_COLUMNS` omits it), so the UI cannot show why a listing was flagged.
- `list_review_listings`' docstring still claims `needs_review` comes only from the
  fuzzy chemical match; there are six triggers now (§7).
- Uploading a PDF whose hash is already known always returns `status: "done"`, even
  if that document actually ended `failed` or `cancelled`
  ([upload.py:131](backend/app/routers/upload.py#L131)).
- `docker-compose.yml` builds and runs **only the API** — no worker, no reconciler.
  Following it alone gives a system that accepts uploads and never processes them.
- `price` being null is **expected, not a defect** — most brochures are spec sheets
  that print no price, and zero listings in the live catalog carry one. Do not treat it
  as an extraction bug or try to prompt around it (§1, PRODUCT.md → "Price is not the
  product"). If a listing has `price_usd` set while `price` is null, *that* pair is a
  real inconsistency worth chasing; as of 2026-07-30 no rows are in that state.
- Some `name_en`/`name_raw` values have historically arrived already truncated with
  `…`. Not reproduced in the current catalog (0 rows as of 2026-07-30), but the
  extraction path has not changed in a way that would explain the fix, so treat it as
  unconfirmed rather than closed.

## 13. Scaling posture

- **All state in Postgres.** A crash mid-document loses no completed page; the next
  worker resumes at the first incomplete page with the persisted `running_context`.
- **One worker owns one document** and walks its pages in order. Ordering is local to
  a worker; the pool is not coordinated beyond the atomic claim.
- **Scale = replica count** — target up to 6 workers during an event spike, ~1
  between events. The reconciler stays at exactly 1.
- **Backpressure** is the 20 MB per-file cap plus the claim rate; there is no global
  queue-size limit, because the queue is a Postgres table rather than RAM.
- Dead-lettered and low-confidence products route to the human review queue rather
  than entering the catalog silently.

## 14. Chat assistant — design history

Why this section exists: the assistant's shape was decided partly by testing
against the real catalog, and several decisions look arbitrary without the
failure that produced them. Recorded so nobody "simplifies" a guard back out.

### 14.1 What was intended

A conversational sourcing assistant docked in Search, answering questions the
filter UI cannot express — "what do we stock for floor coatings?", "X is
banned, what else works?". The design ([docs/AI_SEARCH_ARCHITECTURE.md](docs/AI_SEARCH_ARCHITECTURE.md),
[docs/AI_CHAT_P1_PLAN.md](docs/AI_CHAT_P1_PLAN.md)) rejected both fine-tuning
(no dataset; the catalog changes every upload) and classic RAG (the data is
typed rows with a working query path, not prose), settling on **tool-calling
over `search_listings`** with a hard rule that the model never produces
chemical data.

Planned but deliberately deferred: token streaming, embeddings (P3), web
search (P2), curated substitution notes (P4).

### 14.2 What was built

Per plan: two provider loops behind three options, ephemeral in-memory threads
(20-message cap), citation markers validated against real tool output,
one `audit_log` row per exchange, all three roles, shipped behind
`CHAT_ENABLED`.

Two departures, both upward in scope:

- **Progress-event streaming shipped.** Token streaming stayed deferred, but
  progress events turned out to be a different, much cheaper thing: both loops
  already know when a model call starts and which tool is next, so one
  `on_event` callback per loop feeds a real SSE stream. The UI reports the
  actual search terms, which also makes a misread question visible before the
  answer lands.
- **`AGENT_COLUMNS` became load-bearing, not an optimisation.** `SEARCH_COLUMNS`
  omits `details`; combined with 14.3's price finding, without it the model has
  essentially nothing to reason about.

### 14.3 What changed after testing, and why

Every item below replaced a *prompt instruction that did not hold*. That is
the pattern: instructions regressed under a different question, structural
fixes stayed fixed.

| Change | The failure that caused it |
|---|---|
| `priced_only` removed from the agent's tool schema | The model set it unprompted despite an explicit instruction not to. **Zero of 387 listings have a price**, so it silently returned nothing — "we stock one flooring admixture" became "the catalog has nothing for floor coatings". A silent false negative on availability is the worst answer this assistant can give. |
| Ranking by fit, never by price | Same root cause: price ordering ranks the catalog by which supplier happened to print a number. This *used* to contradict PRODUCT.md's "what a chemical costs across suppliers"; that framing was wrong and PRODUCT.md was corrected on 2026-07-30 — price is a bonus field, specification is the comparison axis (§1). The assistant's behaviour here was right all along and is now the documented product position. |
| Query widening (phrase → singular → rarest word) | "hydrocarbon resins" matched nothing because the catalog stores "Hydrocarbon Resin" — 25 products reported as none. **Both models tested failed identically**, which is what makes it a retrieval bug rather than a prompting one. Prompting models to "use short terms" was asking them to work around broken search. |
| `related_rows` for widened matches | Widening "calcium carbonate" to "carbonate" matches *dimethyl* carbonate — a different substance the model duly offered. Returning them as normal rows produced "we stock zinc oxide, but neither is in the catalog"; withholding them produced a false negative on flooring. Primary count stays zero; near-misses stay visible and citable. |
| `CallGuard` (no repeated identical tool calls) | The model ran `search_catalog('solvent')` five times in one turn, burning the iteration budget on an unchanged result. |
| `failed` / `duplicate` flags on progress events | A failed lookup and an empty result both rendered "0 rows". That ambiguity hid the `priced_only` bug for two rounds of debugging. |
| Substitution = think first, then verify by name | Asked what replaces titanium dioxide, the model searched "pigment" and offered dispersants, emulsifiers and binders — every row real, the claim chemically false, so citation validation passed it. It now derives candidates from chemistry (zinc oxide, kaolin, barium sulphate) and searches each **by name**, which a dispersant cannot satisfy. Naming candidates we do *not* stock is a feature: it tells the team what to source. |
| System prompt restructured, 1634 → ~880 words | Growing the prompt pushed the citation rules to the bottom, where the model stopped emitting markers entirely and reverted to markdown bullets — the trust boundary degraded to plain prose. Output contract now sits first. |

### 14.4 What is still not solved

- **Prompt adherence varies run to run** on `gpt-4o-mini`, most visibly the
  "attribute not recorded" rule (flammability, REACH), which sometimes answers
  "we have none" instead. `gpt-4o` was tested and is *not* a straight upgrade:
  better at supplier reasoning, worse at search breadth, slower, dearer.
- **The Anthropic/Sonnet 5 path has never executed** — the key in `.env` is a
  one-character placeholder. The code is written and unverified.
- **No lexical rule separates a compound name from an application phrase**
  ("calcium carbonate" vs "floor coatings"). That is the semantic-search
  problem and is exactly what P3 is for.
- **The frontend is verified only by `tsc` and API-level tests.** The panel,
  streaming trail, cited-row rendering and message cap have not been driven in
  a browser.

### 14.5 Roadmap change

P3 (embeddings) and P4 (substitution notes) **swapped**. Testing showed the
titanium-dioxide answer needed judgement, not retrieval — the correct answer
was "nothing does that job", and semantic neighbours would have returned the
same dispersants with a confident similarity score attached, making the failure
*more* persuasive. A curated `substitution_notes` table is deterministic,
cannot hallucinate, and captures knowledge no competitor can buy.

## 15. House knowledge (P4) — [`routers/notes.py`](backend/app/routers/notes.py)

The curated layer from
[docs/AI_SEARCH_ARCHITECTURE.md](docs/AI_SEARCH_ARCHITECTURE.md) §1c and §6.3,
built next because §14.5 swapped it ahead of the embedding work: the failures
that mattered needed judgement, not better retrieval.

Two tables, `substitution_notes` and `regulatory_notes` (DDL in
[db/migrations/2026-07-26_house_knowledge.sql](db/migrations/2026-07-26_house_knowledge.sql),
repeated in `schema-additions.sql`). Both key on the canonical **chemical**,
never on a listing — a substitution holds for a substance, not for one
supplier's packaging of it.

**Reads open, writes manager-only.** Viewers see the notes (knowledge nobody
can read is not captured), but writing one is BosTech asserting a judgement the
assistant will then repeat, so it needs `require_manager`. Every write is
audited.

**Captured in the Inspector**, not on an admin screen —
[`HouseNotesCard`](frontend/src/components/listing/HouseNotesCard.tsx) sits in
the listing panel, which is the one place someone is already looking at the
product while holding the decision in their head. A separate page would collect
nothing.

Three schema decisions that are not cosmetic:

| decision | why |
|---|---|
| `to_chemical_id` nullable, `to_name` always stored | The most valuable note often names a substance we do **not** stock — that is a sourcing instruction, not missing data (§14.3). Keying only on an id would make those notes unwritable. |
| `verdict` — `works` / `conditional` / `avoid` | A note recording a swap that **failed** is house knowledge too. Without the column every note reads as an endorsement, and the assistant would hand back the exact substitution the team already rejected. |
| `regulatory_notes.jurisdiction` + `effective_date` as columns, not prose | §6.3: bans are jurisdiction-specific, dated, and usually partial. A status without a where and a when is the flattened claim the whole rule exists to prevent. |

**On the agent side**, two tools —`lookup_substitution_notes` and
`lookup_regulatory_notes` — and the system prompt now ranks house notes above
the model's own chemistry, with the substitution flow calling the notes tool
*before* it reasons. The precedence rule is also attached to every tool result
payload, not left to the prompt alone: §14.3's pattern is that instructions
regress under a competing instruction, while a rule travelling with the data it
governs does not.

The regulatory path changes shape here. Previously the assistant could only
refuse; now an empty lookup returns an explicit "you have no source, do not
imply one in either direction" — *not banned* is as unfounded as *banned* — and
a recorded note is quoted with its jurisdiction, date and author.

**Notes are not citable rows.** `collect_listing_ids` sees nothing in a notes
result, so a note can never be rendered as a product row; the assistant
attributes it in prose instead. The trust boundary in §4 of the design doc is
unchanged — the model still cannot put a number on screen.

**Not built:** the structured `claims[]` / `basis` payload from the design
doc's §4. Attribution rides in the prose today. That is the right next step if
house knowledge and model opinion ever need to render as visibly separate
blocks.

## 16. Semantic index (P3) — [`services/embeddings.py`](backend/app/services/embeddings.py)

The narrow vector index from
[docs/AI_SEARCH_ARCHITECTURE.md](docs/AI_SEARCH_ARCHITECTURE.md) §1b. It exists
for **one** job keyword search cannot do — "find me chemicals *like* this one".
It is not a retrieval path for facts: neighbours are resolved back to live
listing rows before anything is shown, so prices are never stale inside the
index and the trust boundary in §4 of the design doc is untouched.

The failure it closes is the one recorded in §14.3: no lexical rule separates
*calcium carbonate* (one substance) from *floor coatings* (two application
words), so the widening heuristic had to choose between a false negative and
offering dimethyl carbonate as a substitute.

**One row per canonical chemical**, not per listing — the same substance
repeated across twelve suppliers would otherwise return twelve copies of one
product and cost twelve times as much to index.

| piece | where |
|---|---|
| `chemical_embeddings` + `match_chemicals` RPC | [db/migrations/2026-07-26_chemical_embeddings.sql](db/migrations/2026-07-26_chemical_embeddings.sql) |
| compose / embed / refresh | [`services/embeddings.py`](backend/app/services/embeddings.py) |
| `find_similar_chemicals` tool | [`services/agent_tools.py`](backend/app/services/agent_tools.py) |
| incremental refresh after an upload | [`worker.py`](backend/app/worker.py) `_finalize_document` |
| one-off backfill | `python -m app.embed_backfill` |

**Provider**: configurable via `embedding_provider` (`qwen` or `openai`) — Anthropic
has no embeddings API, so Claude was never an option here despite driving every
other pipeline (see §17.4). Deployed as `openai` (`text-embedding-3-small`) since
2026-07-30; `qwen` (`text-embedding-v3` on the DashScope OpenAI-compatible endpoint)
remains supported and was the original default. Either way the call requests
exactly `embedding_dim` dimensions (`services/embeddings.py`), matching the fixed
`vector(1024)` column, so switching provider is a settings change, not a migration.

Decisions worth not undoing:

- **`source_text` is stored, and it is deterministic.** It doubles as the
  change detector: `refresh_chemicals` skips any chemical whose composed text
  is byte-identical, so re-running the backfill over a settled catalog costs
  nothing. Everything composed into it is sorted — set-iteration order leaking
  in would re-embed the whole catalog on every run.
- **Logistics keys are stripped** (`packaging`, `moq`, `price`, …). Two
  unrelated substances must not look alike for shipping in the same sack.
- **Vectors are matched to inputs by the provider's own `index`**, never by
  arrival order. An off-by-one there attaches each chemical's vector to its
  neighbour, and nothing downstream would notice.
- **Cosine, not L2.** Source texts vary wildly in length; under L2 a chemical
  with twelve listings' worth of details would dominate on magnitude alone.
- **`min_similarity` floor.** §14.5's warning applies directly — a confident
  similarity score attached to an unrelated substance makes a wrong answer
  *more* persuasive, so weak neighbours are dropped rather than ranked.

**Degradation is the load-bearing behaviour.** With the feature off, the index
unbuilt, or the provider down, `find_similar_chemicals` falls back to a name
search and returns `degraded: true` with a note saying the rows are a name
match and that absence proves nothing. "Similarity is unavailable" and "nothing
is similar" are different answers; serving the second when the first is true is
a false negative on availability, which §14.3 identifies as the worst answer
this assistant gives. Same reason the refresh never raises: a finished upload
must not be held back by an embedding provider.

**The widening heuristic in `_search_catalog` stays.** It is deterministic and
free, it works with the index off, and it fixes the plural/singular case
("hydrocarbon resins") more exactly than a vector search would. P3 answers the
*application-phrase* case, which is a different failure; the `related_rows`
note now routes it onward.

**Ranking (§5) is wired, not just documented.** A neighbour result carries a
hard ceiling of medium confidence, and when a house note exists for the queried
substance the payload says so and points at `lookup_substitution_notes` —
curated knowledge outranks a similarity score.

### 16.1 What the live catalog changed

Applied and backfilled against production on 2026-07-26. Three things only the
real data showed:

- **Two thirds of `chemicals` is unbuyable.** 1005 chemical identities, but
  only **324** have any listing — the rest are CAS-lookup identities no
  brochure ever priced. Indexing them would have let unbuyable rows fill the
  top-N of every search, to be dropped downstream, so results would get *worse*
  as the index grew. `refresh_chemicals` now skips any chemical with no
  listings, and the index holds exactly the 324 buyable ones. It is
  self-correcting: the worker embeds a chemical the moment a brochure lists it.
- **`list_chemicals()` silently truncates at 1000 rows** (PostgREST's default
  cap, no error). The first backfill therefore missed five chemicals while its
  progress counter read "1000/1000" — the failure looked like success. The
  backfill now pages via `list_all_chemical_ids()`. ⚠️ **`list_chemicals()`
  itself is still capped and is used by the dedup path** — out of scope here,
  but it means fuzzy dedup only ever sees the first 1000 chemicals.
- **Similarity scores do not separate a hit from a miss on this corpus.** Every
  query lands in a 0.55–0.66 band, *including* ones the catalog cannot serve:
  "food-grade gelatin" (we stock none) returned a full slate at 0.55–0.60,
  while a genuine epoxy-hardener match scored 0.62. No threshold in that band
  discriminates, and raising `min_similarity` drops real matches first. So the
  score is **not** presented as a verdict: the tool's note states plainly that
  it always returns its closest rows even when nothing suitable exists, and
  relevance is enforced by the prompt's evidence test instead. This is §14.5's
  warning arriving exactly as predicted — a confident number attached to an
  unrelated substance makes a wrong answer more persuasive, not less.

**Not built:** re-embedding on a manual listing edit (only uploads and the
backfill refresh the index), pruning an embedding when a chemical loses its
last listing, and any UI surface for similarity outside the chat.

## 17. Claude-only pipeline, error handling, and manual supplier fix — 2026-07-29/30

### 17.1 Before

The `claude` extraction pipeline still leaned on Qwen for two things it didn't need
to: a scanned page went through Qwen OCR before Claude ever saw it, and the
supplier-identity pass (cover/footer OCR) always used Qwen regardless of which
provider was doing the actual extraction. A Claude-only deployment therefore still
needed a working Qwen key, silently.

Provider failures were undifferentiated. `_CLAUDE_RETRYABLE` treated every Anthropic
`APIStatusError` — a genuine rate limit as much as an invalid key or an empty
account — as worth retrying, so an unrecoverable failure (bad key, no credit, unknown
model) still cost ~14s of exponential backoff per page before it surfaced, and it
surfaced as a generic `"Extraction failed — restart to try again."` in the UI with no
way to tell a key problem from a bad PDF from a rate limit. `documents` had no column
to hold a reason even if one had been produced.

A document that finished with no resolvable supplier had no path to a fix: the worker
tried the cover/footer once and gave up, and page images are deleted the moment each
page completes, so by the time a document is `done` there is nothing left to retry
supplier detection from. There was also no admin UI for assigning or correcting a
supplier at all — `ListingAdminCard` edited name/CAS/price/purity/details but not the
supplier. Separately, a company created from an identity pass with a website/email but
no printed name got the literal string `"Unknown supplier"` as its name, and the
backfill logic (`supplier._backfill_for`) only ever filled *blank* fields — so that
placeholder could never be corrected by a later, better-identified brochure.

The settings page listed six providers flat with no default, and technical labels
("Extraction provider", "Page extract provider" as a separate, easy-to-miss control)
assumed a developer reader.

### 17.2 What changed

- **Claude reads brochures end to end.** `extraction.complete_claude_vision` sends
  page images straight to Claude (native vision); `worker._extract_identity` uses it
  on the `claude` pipeline instead of Qwen OCR. A Claude-only deployment no longer
  needs a Qwen key anywhere in the live path. Supplier detection also widened: a
  cover/footer miss now retries once over a few more not-yet-tried pages (capped at 8
  total) before giving up, instead of stopping after the first narrow pass.
- **Provider failures are classified, not blanket-retried.** `_is_transient_claude_error`
  restricts retries to rate limits, connection drops, and 5xx; everything else (auth,
  permission, not-found, bad-request/no-credit) fails on the first attempt.
  `friendly_provider_error` turns the exception into a plain-English message naming
  the affected feature and what to do, covering both SDKs the app drives directly
  (Anthropic, and OpenAI — which is also what Qwen's DashScope endpoint speaks).
  `PageExtractError.fatal` carries that classification into the worker, which stops
  the document immediately on a fatal error (§5) instead of failing every remaining
  page the same way. A new `documents.error` column holds the reason and a new
  `documents.fatal` column tells the reconciler not to auto-retry it (§9) — only a
  manual Restart, which clears both, tries again. Applied consistently to brochure
  extraction, the chat assistant, and AI search — one classifier, three surfaces.
- **Manual supplier fix.** `PATCH /listings/{id}` accepts `company_id` (reassign to an
  existing supplier) or `new_company_name` (create one); the listing editor gained a
  `SupplierPicker` field that searches the directory as you type. The backfill fix
  (§7) means a corrected supplier name can also propagate automatically to future
  brochures from the same domain/email.
- **Settings page reads as a decision, not a config file.** Claude is now the
  first/default option in every provider choice; labels use plain language via a
  frontend copy override (`settingsCopy.ts`) that leaves the underlying setting
  keys/DB rows untouched; the visible extraction-provider control and the pipeline's
  own `qwen`/`claude`-only switch (`page_extract_provider`) now stay in sync
  automatically. A new "Add an AI key" dialog (`AddKeyDialog.tsx`) walks through
  picking a service, pasting a key, and testing it, with plain-English hints on
  common mistakes (`keySuggestions.ts`).

### 17.3 What's still open

- The classifier's "fatal" list (auth / permission / not-found / bad-request) is a
  judgment call, not exhaustive — an Anthropic or OpenAI failure mode outside those
  four categories still falls through to a generic, non-fatal message and gets
  retried like a transient error.
- Renaming a company away from the `"Unknown supplier"` placeholder through the
  manual picker creates a **new** company row rather than renaming the existing one
  in place, if the typed name doesn't fuzzy-match anything already in the directory.
  The old placeholder row is left behind (harmless if it backfills correctly later
  via §7, orphaned if it doesn't).
- `extract_brochure`'s scanned-PDF branch also gained a Claude-vision path
  (`_call_claude_images`) during this work, but that function is dead code (§12.2) —
  reachable only from the unused `jobs.py` — so it exists but nothing calls it.

### 17.4 Embedding provider switched to OpenAI — 2026-07-30

The "switch everything to Claude" push in §17.2 stopped at the embedding index
(§16) because Anthropic has no embeddings product — `find_similar_chemicals` was
left on `qwen` by default while every other feature moved to Claude, which was an
inconsistency worth resolving deliberately rather than leaving implicit. `embedding_provider`
is now set to `openai` (`EMBEDDING_MODEL=text-embedding-3-small`) in both `.env`
and the `app_settings` DB row; `embedding_dim` stays `1024` since OpenAI's API
truncates to a requested width, so no migration or re-backfill was structurally
required. **Still needs an `OPENAI_API_KEY`** — the provider switch alone doesn't
supply credentials, and without one `find_similar_chemicals` keeps degrading to
the name-match fallback described in §16.
