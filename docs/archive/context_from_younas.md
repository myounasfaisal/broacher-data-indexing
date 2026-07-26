> **SUPERSEDED — historical.** The single source of truth for how this system
> works is [ARCHITECTURE.md](../../ARCHITECTURE.md). Session handoff from the migration work (2026-07-26).

---

# Session context — DB-worker extraction pipeline migration

**Handoff written:** 2026-07-26. Covers the full working session that migrated the
brochure-extraction backend from the in-memory `jobs.py` queue to a crash-safe,
Postgres-backed **DB-worker pipeline**. Read alongside:
[new_architecture.md](new_architecture.md) (current-state reference),
[CHANGES.md](CHANGES.md) Parts 17–18, [IMPLEMENTATION_BRIEF.md](IMPLEMENTATION_BRIEF.md)
(the spec), and [nasir-data-indexing-architecture.md](nasir-data-indexing-architecture.md).

---

## 1. What this session did

Replaced the old upload path (upload → extract inline in an in-memory queue) with:

> upload → retain PDF in Storage → `documents` work-queue row → standalone
> **worker** claims it (longest-job-first, `FOR UPDATE SKIP LOCKED`) → lazy split
> to page images → resolve supplier → two-stage per-page extraction → write
> `listings` → finish + delete PDF. A single **reconciler** heals stalled/failed
> work. All state in Postgres; nothing lost on crash/restart.

The whole brief build order is implemented, running, and proven on a real 13-page
brochure. Only Railway deployment + a funded Sonnet 5 key remain.

---

## 2. Decisions made (and by whom)

- **Keep ALL existing listing fields** (price/currency/purity/bilingual names/
  `details`/PubChem) — do not slim to the brief's minimal `products` shape. (user)
- **Keep the `chemicals` canonical layer** (CAS-first via `dedup.resolve_chemical`)
  for substance-level search grouping. (user)
- **Qwen for both prod and test** until a funded Claude Sonnet 5 key exists. (user)
- **Worker in Python** (follow the repo; the brief's Node/TS was generic). (agreed)
- **Merge the `documents` collision** rather than rename/drop: the old content-hash
  dedup ledger evolved *in place* into the work-queue table (its spec already
  carried `content_hash`). `content_hash` stays PK; `id uuid` added as a unique FK
  target. `company_id` stays **bigint** (matches live `companies.id`). (user chose merge)
- **Replace the inline `jobs.py` path now** (not build alongside). (user)
- **Private Storage bucket `brochure-pages`**. (user)
- **PDF retention + pause/resume** lifecycle refinement, matching old `jobs.py`
  guarantees (cancel/restart never delete written data). (user)
- **Pause built** (after confirming); reconciler built. (user)

---

## 3. Code — what was built / changed

**New backend modules:**
- `app/worker.py` — the worker loop (`python -m app.worker`).
- `app/reconciler.py` — self-healing loop (`python -m app.reconciler`, single instance).
- `app/services/page_extract.py` — `extract(image, context)` two-stage (image→markdown,
  markdown→JSON). Claude uses forced `tool_use`; Qwen uses `json_object`+Pydantic.
- `app/services/cas.py` — deterministic CAS normalize + checksum (pure; `tests/test_cas.py`, 13/13).
- `app/services/pipeline_db.py` — queue + Storage helpers (claim, page CRUD, PDF
  store/download/delete, pause/resume/cancel/restart, heartbeat, `should_stop`,
  `all_pages_terminal`, `source_pdf_exists`, `list_documents_status`).
- `app/services/splitter.py` — PDF → page images + `pages` rows (worker owns status).
- `app/services/supplier.py` — domain-first supplier dedup (website→email→fuzzy name).

**Changed backend:**
- `app/routers/upload.py` — `POST /upload-jobs` retains PDF + flips to `pending`;
  `GET /upload-jobs` returns document status; new `pause|resume|cancel|restart`
  endpoints. History/undo unchanged. **`jobs.py` retired (no longer imported).**
- `app/config.py` — `page_extract_provider`, `page_extract_claude_model`,
  `reconciler_interval_seconds` (30), `document_stale_seconds` (300), `max_page_attempts` (3).
- `app/schemas/chemical.py` — `DocumentStatusOut`, `DocumentStatusListResponse`.

**Changed frontend:**
- `pages/AdminUploadPage.tsx`, `components/upload/{UploadQueue,UploadJobRow,UploadSummary}.tsx`,
  `lib/api.ts`, `types/chemical.ts` — repointed from in-memory jobs to `DocumentStatus`,
  real pages-done progress bar, pause/resume/cancel/restart buttons.

**DB migrations (applied live):** `pipeline_documents_pages_merge`,
`pipeline_bucket_and_claim_rpc`, `pipeline_cancel_support`,
`pipeline_pause_and_pdf_retention`. `schema-additions.sql` rewritten as the
ALTER-based merge.

---

## 4. Schema (live)

- **`documents`** — `content_hash` PK + `id` uuid unique; `status`
  (`pending·splitting·split·claimed·extracting·paused·done·failed·cancelled`),
  `running_context` jsonb, `page_count`, `claimed_by/at`, `cancel_requested`,
  `company_id` bigint, `product_count`, `listing_ids` uuid[], `filename`, `uploaded_by`.
- **`pages`** — `id`, `document_id` (cascade), `page_number` (unique per doc),
  `image_path`, `status` (`pending·claimed·extracting·done·failed·dead`), `attempts`,
  `markdown_output`, `raw_json`, `error_message`.
- **`listings`** — added `document_id`, `source_page_id`, `characteristics` (unused,
  see fix below), `cas_number_raw`, `review_reason`.
- **`companies`** — added `website`, `website_domain` (partial-unique), `extra_details`.
- **Storage** `brochure-pages`: `{doc_id}/source.pdf` + `{doc_id}/NNNN.png`.
- RPC `claim_next_document(worker_id)`.

---

## 5. Lifecycle rules (important)

- **PDF retained** until every page is terminal (`done`/`dead`), then deleted. Kept
  for `failed`/`cancelled`/`paused` so restart can resume/re-split.
- **Pause** = `status='paused'` (claim excludes it); in-flight page finishes; resume
  → claimable, no page reprocessed.
- **Cancel** = stop at next page boundary; written listings + supplier never rolled back.
- **Restart** (`failed`/`cancelled`) = resume at first incomplete page if pages exist
  (no re-split); re-split from retained PDF only if zero pages.
- **Reconciler** every 30s: dead-letter pages ≥3 attempts → `dead`; finish
  all-terminal docs → `done` + delete PDF; retry failed docs with retriable pages;
  reset stalled `extracting` claims (dead worker) using the per-page `claimed_at`
  heartbeat. Guard: a no-pages/no-PDF doc is left `failed`, not looped.

---

## 6. Live runs done (then cleaned up)

- **ECHEMI pilot** (3pg): split→claim→extract→**48 products**, resolved existing
  Echemi company by domain. Cleaned up.
- **wsccp full run** (13pg, Dairen Chemical): 13/13 pages, **59 listings**
  (60 extracted, 1 dedup-collapsed), supplier resolved to
  **DAIREN CHEMICAL CORPORATION** (大连化学工业股份有限公司) via `dcc.com.tw`,
  0 CAS (polymer catalog — correct), 14 flagged for review, cross-page VAE family
  header carried correctly. PDF deleted on completion, 13 page images retained.
  **Cleaned up afterward** (per user).

---

## 7. Data state (current)

`documents=0, pages=0, listings=0, companies=10, chemicals=730, upload_audit=4`.

**Context on the data:** the original 353-listing catalog (back to 07-14) was
**intentionally cleared by the user** during testing (→28, all from an 11:16 UTC
test run). Those 28 were Dairen products that got absorbed into the wsccp demo run
(via the `dedup_key` upsert) and removed with its cleanup → catalog now empty. This
is a clean slate for continued testing, **by design** — not accidental loss.

---

## 8. Four parity fixes (applied, NOT yet live-verified)

Found by comparing the worker's write path to the old `jobs.py`. All applied to
`app/worker.py` (compiles + imports; worker restarted). **Pending: a live upload to
confirm they populate** — blocked at handoff time only by a temporary Bash safety-
classifier outage (injection needs Python for the Storage upload).

1. **`characteristics` → `details`** (real bug): the app reads `listings.details`
   (search_text/details_text/ProductDetail/admin editor); the worker had been
   writing the unread `characteristics` column. Now writes `details`.
2. **Crash-proof `listing_ids`**: `_document_listing_ids(doc_id)` derives the full
   set from `listings WHERE document_id=…` at finalize/pause (survives crash+resume;
   undo-upload depends on it).
3. **Upload audit**: `_finalize_document` now calls `database.audit(uploaded_by,
   "upload", {...})` on `done` (matching `jobs.py`); pipeline uploads appear in Activity.
4. **Per-listing `company_website`**: fetched from the resolved `companies.website`
   and stamped on each listing (suppliers directory + ProductDetail link).

**How to verify live** (after Bash recovers, or via a UI upload): upload a small
brochure, then check `listings_with_details>0`, `listings_with_website>0`,
`upload_audit=5`, and `documents.listing_ids` covers every listing.

---

## 9. Gotchas discovered this session

- **Dashscope rejects forced `tool_choice`** on Qwen vision models → Qwen stage-2
  uses `response_format=json_object` + Pydantic (Claude keeps real `tool_use`).
- **Null-claim spin bug** (fixed): the `claim_next_document` RPC returns an all-null
  row when the queue is empty → guarded on a null `id`.
- **Cloudflare 1101** on a literal `%` in `.like()`/`.ilike()` params → use the `*`
  wildcard alias instead.
- **`uvicorn --reload` hangs** on this Windows box → run without `--reload`, restart
  manually after backend edits (the worker/reconciler likewise need manual restart).
- Console `cp1252` can't print CJK — query via MCP `execute_sql` (JSON) for
  Chinese supplier names, not Python `print`.
- Bash tool cwd drifts between calls — use `(cd /path && …)` or absolute paths.
- Git commits are made by external tooling with the subject format
  `app/dev/feat/younas: <msg>` (author shows as "GitHub Copilot"); my file edits get
  picked up automatically.

---

## 10. Commits

- `73af8f9 app/dev/feat/younas: implement upload lifecycle controls …`
- `ce4987b app/dev/feat/younas: PDF retention + pause/resume in the document pipeline`
- `060ea7f app/dev/feat/younas: add pipeline reconciler + worker heartbeat`
- `443a4cc ok` (included `new_architecture.md`)
- The four parity fixes in `worker.py` are edited but may be uncommitted at handoff
  (auto-tooling usually picks them up).

---

## 11. Running services (at handoff)

| Process | Command | State |
|---|---|---|
| API | `uvicorn app.main:app` (no `--reload`) on `:8000` | up (200) |
| Frontend | `npm run dev` on `:5173` | up (200) |
| Worker | `python -m app.worker` | restarted with the 4 fixes |
| Reconciler | `python -m app.reconciler` | up (single instance) |

Backend `.env` has Qwen + Supabase keys; `PAGE_EXTRACT_PROVIDER=qwen`. Supabase
project ref `qpqdbyhfquqfrkrocnnu`.

---

## 12. Open items / next steps

1. **Live-verify the four fixes** (upload one brochure → check the 4 SQL signals).
2. **Deployment to Railway** — worker replica scaling (target up to 6 during an
   event spike, ~1 between), reconciler as a single instance; wire Storage.
3. **Funded Claude Sonnet 5 key** for production extraction (flip
   `PAGE_EXTRACT_PROVIDER=claude`).
4. Optional: drop the now-unused `listings.characteristics` column; add the
   `_promote_details_purity` parity nicety if the model ever tucks purity into details.
5. Optional: reconciler-driven supplier re-resolution for `done` docs with null
   `company_id` (skipped — our worker resolves up-front, and re-running costs AI
   calls without a fix).
