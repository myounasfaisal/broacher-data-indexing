> **SUPERSEDED — historical.** The single source of truth for how this system
> works is [ARCHITECTURE.md](../../ARCHITECTURE.md). Current-state description of the DB-worker pipeline, folded into `ARCHITECTURE.md` (which corrects it on the `characteristics`/`details` column and the missing `claim_next_document` SQL).

---

# New Architecture — DB-worker extraction pipeline

**Status:** implemented and running (2026-07-26). This documents the system **as
built**, replacing the in-memory `jobs.py` queue described in `ARCHITECTURE.md`.
Source design: `IMPLEMENTATION_BRIEF.md` / `nasir-data-indexing-architecture.md`.
Change log: `CHANGES.md` Parts 17–18.

---

## 1. Overview

Brochures (PDFs) are uploaded, split into per-page images, and extracted into
structured product **listings** by a pool of **stateless worker processes**. All
work state lives in **Postgres** (Supabase) — there is no in-memory queue — so a
reload, crash, or restart loses nothing. A single **reconciler** loop heals
stalled/failed work.

```
Browser ──upload PDF──▶ FastAPI (/upload-jobs)
                          │  create documents row (splitting)
                          │  retain PDF in Storage ──▶ flip to 'pending'
                          ▼
                     documents (Postgres work queue)
                          ▲                     │ claim (longest-job-first,
        reconciler ───────┘                     ▼  FOR UPDATE SKIP LOCKED)
        (~30s heals)                       Worker process(es)
                                             1. lazy split → pages + Storage PNGs
                                             2. resolve supplier (first/last pages)
                                             3. per page: extract() → listings
                                             4. finish → delete retained PDF
                                                   │
                                                   ▼
                                   listings / companies / chemicals
                                                   │
                                                   ▼
                                     Search · Dashboard · Review UI
```

The **search, dashboard, review-queue, and suppliers** UIs are unchanged — they
read `listings`/`companies`/`chemicals`, which the worker writes to.

---

## 2. Data model

Existing tables kept: `profiles`, `chemicals` (canonical CAS-deduped identity),
`companies` (suppliers), `listings` (one supplier's product offer), plus
`audit_log`, `exchange_rates`. The pipeline **merged the old content-hash ledger
into a work-queue `documents` table** and added `pages`.

### `documents` — one row per uploaded PDF (work queue + dedup ledger)
| column | notes |
|---|---|
| `content_hash` text **PK** | SHA-256 of the PDF; dedup guard (unchanged upload dedup) |
| `id` uuid **unique** | referenced by `pages`/`listings` (FK target; PK stays content_hash) |
| `status` text | `pending·splitting·split·claimed·extracting·paused·done·failed·cancelled` |
| `running_context` jsonb | table headers / product family carried across pages |
| `page_count` int | filled at split |
| `claimed_by` text, `claimed_at` timestamptz | worker ownership + stall heartbeat |
| `cancel_requested` bool | set by the cancel endpoint |
| `company_id` bigint FK | resolved supplier (**bigint**, matches `companies.id`) |
| `product_count` int, `listing_ids` uuid[] | ledger fields for upload history / undo |
| `filename`, `uploaded_by`, `created_at` | |

### `pages` — one row per page image
| column | notes |
|---|---|
| `id` uuid PK, `document_id` uuid FK (cascade) | |
| `page_number` int, unique `(document_id, page_number)` | |
| `image_path` text | Supabase Storage key |
| `status` text | `pending·claimed·extracting·done·failed·dead` |
| `attempts` int | retry counter (drives dead-lettering) |
| `markdown_output` text, `raw_json` jsonb | stage-1/2 outputs, kept for audit |
| `error_message` text, `claimed_at`, `created_at` | |

### `listings` — added columns
`document_id`, `source_page_id` (traceability), `characteristics` jsonb,
`cas_number_raw` (exact printed CAS), `review_reason`. Existing fields
(`name_raw`/`name_en`, `cas_number`, `price`/`price_usd`/`currency`, `purity`,
`details`, `needs_review`, `chemical_id`, `company_id`) are all kept.

### `companies` — added columns
`website`, `website_domain` (partial-unique, primary supplier dedup key),
`extra_details` jsonb. Existing `company_name`/`company_name_en`, `email`,
`contact_number` kept.

### Storage
Private bucket **`brochure-pages`**: `{doc_id}/source.pdf` (retained PDF) and
`{doc_id}/NNNN.png` (page images). Service-role writes; reads via signed URLs.

---

## 3. Upload path (`routers/upload.py`)

`POST /upload-jobs` (admin/manager):
1. Validate PDF (type, size, `%PDF-` magic), read into memory.
2. SHA-256 → **dedup**: a known `content_hash` returns immediately as a
   duplicate (no work).
3. `create_document(...)` → row in **`splitting`** (non-claimable "preparing").
4. Background task: **retain the PDF** in Storage, then flip status to
   **`pending`** — so a worker never claims a document before its PDF exists.

`GET /upload-jobs` returns the caller's recent documents with derived
`pages_done`/`page_count` progress (drives the Upload UI).

Per-document controls: `POST /upload-jobs/{id}/{pause|resume|cancel|restart}`.
Upload history + undo endpoints are unchanged (they operate on the merged
`documents`).

---

## 4. The worker (`app/worker.py`)

Run as a **standalone process**, `python -m app.worker`. **Concurrency = number
of worker processes** — there is no in-process page scheduler and no tuning
against provider rate limits; each worker has exactly one extraction call in
flight at a time.

**Claim** — atomic, contention-safe, longest-job-first, via the
`claim_next_document(worker_id)` RPC (`FOR UPDATE SKIP LOCKED` can't be expressed
through PostgREST):

```sql
update documents set status='extracting', claimed_by=$w, claimed_at=now()
where id = (select id from documents
            where status in ('pending','split')
              and coalesce(cancel_requested,false)=false
            order by page_count desc nulls last
            limit 1 for update skip locked)
returning *;
```

**Per document:**
1. **Lazy split** — if the document has no `pages`, download the retained PDF and
   split it (render → upload PNGs → insert `pages`). A crash before split just
   re-splits from the retained PDF.
2. **Supplier resolution** — one focused pass over the first two + last two pages
   (cover/footer) → `supplier.resolve_company` (§6). Stamped as `company_id`
   before listings are written.
3. **Page loop**, in order, resuming at the first non-`done` page (crash-safe):
   - `extract(image, running_context)` (§5) → write listings (§6–7);
   - update the page (`done` + markdown/raw_json), **heartbeat `claimed_at`**;
   - carry `running_context` forward (persisted, so a crash resumes with the
     same table/family context);
   - **between pages** (never mid-page) check for **cancel** or **pause**.
4. **Finish** — set the terminal status and, when genuinely finished (every page
   terminal), **delete the retained PDF**.

---

## 5. Extraction — two-stage, config-driven (`services/page_extract.py`)

`extract(image, context) -> PageExtraction` is the one place the model is chosen.

1. **Stage 1 — image → markdown.** The VLM transcribes the page (tables and all)
   faithfully; the prompt includes `running_context` so a header printed pages
   back isn't lost. (Reuses `VLM_TRANSCRIPTION_PROMPT`.)
2. **Stage 2 — markdown → JSON.** Structured output matching the per-listing
   schema: `name_raw`, `name_en`, `cas_number_raw` (exact, never reformatted by
   the model), `price`, `currency`, `purity`, `characteristics`, `confidence`,
   plus `context_for_next_page`. Retried up to a small cap; a >1-attempt page
   flags its listings for review.

**Model routing** (`PAGE_EXTRACT_PROVIDER`): **`claude`** (production) uses
genuine forced **`tool_use`**; **`qwen`** (current) uses
`response_format=json_object` + Pydantic — Dashscope's OpenAI-compatible endpoint
doesn't honor a forced `tool_choice`, and json_object is the same
guaranteed-structured pattern the repo already uses. Switching models is a config
change; both receive the same image + schema. (No Anthropic Batches — live
concurrent calls, wall-clock over cost.)

---

## 6. CAS normalization + supplier resolution + review

**CAS (`services/cas.py`, pure + unit-tested).** The model transcribes the CAS
exactly as printed into `cas_number_raw`; application code then strips label
prefixes → digits → re-hyphenates to canonical `(2–7)-(2)-(1)` and validates the
check digit. Canonical form → `listings.cas_number`; raw always kept. Out-of-range
digit counts leave `cas_number` null (raw still stored).

**Supplier (`services/supplier.py`), domain-first dedup:**
1. website domain (normalized, exact) → `companies.website_domain`;
2. email domain (only if no website);
3. fuzzy name (rapidfuzz, conservative — ambiguous → **new row**, never a false
   merge).
Matched rows are backfilled with newly-learned details. `company_id` +
denormalized `company_name` stamped onto every listing from the document.

**`needs_review` triggers** (recorded in `review_reason`): CAS checksum fails
(when present) · `name_raw` empty · CAS blank while sibling rows on the page have
one (contextual absence) · page needed a stage-2 retry · model self-reported
`confidence: low` · ambiguous chemical-name match.

The `chemicals` canonical layer is kept (CAS-first via `dedup.resolve_chemical`),
so substance-level grouping in search still works.

---

## 7. Lifecycle: retention, pause, cancel, restart

- **PDF retention** — the source PDF is kept until **every page is terminal
  (`done`/`dead`)**, then deleted. Retained for `failed`/`cancelled`/`paused`, so
  a restart can resume or re-split.
- **Pause / resume** — pause sets `status='paused'` (claim excludes it); an
  in-flight page finishes, then the worker stops. Resume → claimable (`split` if
  pages exist, else `pending`). **No page is reprocessed.**
- **Cancel** — worker stops at the next page boundary; `status='cancelled'`.
  **Already-written listings and the resolved supplier are never rolled back.**
- **Restart** (`failed`/`cancelled`) — if page rows exist, resume at the first
  incomplete page (**no re-split**; `done` pages kept, `failed`/`dead` reset to
  `pending`). Only re-split from the retained PDF if there are **zero** page rows.

All of these are status/flag transitions only (`services/pipeline_db.py`); the
Upload UI exposes pause/resume/cancel/restart per document with a real
pages-done progress bar.

---

## 8. Reconciler (`app/reconciler.py`)

A **single** standalone loop, `python -m app.reconciler`, sweeping every
`RECONCILER_INTERVAL_SECONDS` (30). Each sweep:
1. **Dead-letter** pages that failed `>= MAX_PAGE_ATTEMPTS` (3) → `dead`
   (surfaced in review, not retried forever).
2. **Finish** any non-terminal document whose every page is terminal → `done`
   + delete the retained PDF.
3. **Retry** `failed` documents that still have retriable pages → claimable.
4. **Reset stalled claims** — a document `extracting` past
   `DOCUMENT_STALE_SECONDS` (300) with no page heartbeat (dead worker) →
   claimable for another worker.

Guard: a no-pages document with **no retained PDF** is left `failed` (not looped
forever). The reconciler never deletes listings or suppliers — only status/page
transitions and the already-superseded PDF. The worker's per-page `claimed_at`
heartbeat lets it tell a live worker on a long document from a dead one.

---

## 9. Reliability & concurrency summary

- **All state in Postgres.** A crash mid-document loses no completed pages; the
  next worker (via the reconciler) resumes at the first incomplete page using the
  persisted `running_context`.
- **One worker owns one document at a time**, walking its pages in order
  (ordering is local to a worker's loop, not coordinated across the pool). Chosen
  for low complexity at hundreds-of-documents scale (longest-job-first shrinks the
  tail).
- **Scale = replica count** (target: up to Railway Hobby's 6 during an event
  spike, scaled to ~1 between events). The reconciler is a separate single
  instance.
- **Dead-lettered / low-confidence products** route to the human review queue
  rather than entering the catalog silently.

---

## 10. Config (`app/config.py`)

`page_extract_provider` (`qwen` now / `claude` prod), `page_extract_claude_model`;
`reconciler_interval_seconds` (30), `document_stale_seconds` (300),
`max_page_attempts` (3); plus existing Supabase/provider keys and
`max_upload_size_mb`.

## 11. Processes to run

| Process | Command | Instances |
|---|---|---|
| API | `uvicorn app.main:app` (no `--reload` on this Windows box) | 1 |
| Worker | `python -m app.worker` | 1–6 |
| Reconciler | `python -m app.reconciler` | exactly 1 |
| Frontend | `npm run dev` (dev) / static build (prod) | 1 |

## 12. Still open

- **Deployment** to Railway (worker replica scaling) + a full event-scale pilot.
- Production model: a funded **Claude Sonnet 5** key (currently Qwen for both
  test and prod).
