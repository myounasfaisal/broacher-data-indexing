# Data indexing architecture — from stored images onward

**Audience:** written for a senior backend engineer reviewing this design (with or without AI assistance), not the original stakeholder discussion. Language here is technical, not simplified.

**Scope:** this document starts at the point where a document's page images already exist in Supabase Storage (upload and PDF-splitting are covered in a separate document) and covers extraction, cross-page context, supplier resolution, and writing structured product/supplier data.

---

## 0. Context for reviewers

**System purpose.** Internal tool for a company that collects 600–2,000 physical chemical-supplier brochures per trade expo, several times a year. Brochures are scanned to PDF and uploaded in bulk. The system extracts structured product data (name, CAS number, supplier) from scanned pages via a vision-language model (VLM) so staff can search a product and immediately see its supplier, instead of manually cross-referencing thousands of paper brochures.

**Workload profile — this is the key constraint shaping the design.** Usage is not steady-state; it is idle for weeks/months, then spikes to thousands of pages within a few hours after an event. The system is optimized for **fast turnaround after a spike**, not for continuous throughput. Production runs use Claude Sonnet 5; Qwen (self-hosted/cheaper) is used during development and testing. For the production run, speed is prioritized over per-call cost — this trades off against Anthropic's Batch API, which is cheaper but not latency-optimized (see §2).

**Where this fits.** Upstream of this document: a user uploads a PDF, it lands in Supabase Storage, a worker splits it into one image per page and deletes the source PDF. This document begins once those page rows exist with `status = 'pending'`.

**Alternatives considered and rejected**, for reviewer context:
- *Sending the whole PDF to the model in one call* (rejected) — loses per-page retryability, and Qwen cannot consume PDFs directly, so the pipeline would fork by model instead of routing on a single interface.
- *Batching multiple page images into one API call for table context* (rejected) — inflates output tokens per request, makes retries coarse-grained (one bad page invalidates the whole batch), and doesn't scale the way per-page parallelism does.
- *Carrying cross-page context in worker process memory* (rejected) — this was the original MVP's approach (sequential-only; broke under concurrency; lost all state on restart). Replaced with a DB-persisted running-context column (§2), which is crash-safe.
- *Cross-document page-claim query, where any worker can pick up any document's next eligible page* (considered, superseded) — this maximizes theoretical parallelism but adds real coordination complexity (contention on a shared claim query across hundreds of workers) for a workload where the simpler alternative below performs nearly identically. Superseded by one-worker-per-document (§2), chosen deliberately for lower implementation and operational complexity given the document counts involved.
- *Anthropic Message Batches API for the production run* (rejected) — 50% cheaper, but optimized for "finishes within an hour or so," not for the tightest possible wall-clock time on a single event-day spike. Since cost is secondary here, live concurrent calls were chosen instead, with concurrency intentionally fixed and small (§2.4) rather than tuned toward any theoretical rate-limit ceiling.

---

## 1. Starting state (schema, this stage's inputs)

```sql
documents (
  id                uuid primary key,
  supplier_id       uuid references suppliers,      -- null until resolved
  status            text,        -- split | claimed | extracting | done | failed
  running_context   jsonb,       -- carries table headers / product family across pages
  page_count        int,
  claimed_by        text,        -- worker id currently owning this document
  claimed_at        timestamptz  -- used by the reconciler to detect stalled workers
)

pages (
  id              uuid primary key,
  document_id     uuid references documents,
  page_number     int,
  image_path      text,          -- already in Supabase Storage
  status          text,          -- pending | claimed | extracting | done | failed | dead
  attempts        int default 0,
  claimed_at      timestamptz,
  markdown_output text,
  raw_json        jsonb,
  error_message   text
)
```

Every `pages` row starts at `status = 'pending'`.

---

## 2. Parallelization and time-saving strategy

**Chosen model: one worker owns one document at a time, and walks its pages sequentially.** This was deliberately chosen over a finer-grained cross-document page-claim scheme for lower implementation and operational complexity, on the reasoning below — it is not the maximum-theoretical-throughput design, it is the one judged to give the best complexity-to-benefit ratio for this workload.

### 2.1 The workload is I/O-bound, not CPU-bound

Each unit of work is: send an image + prompt to a model API, await a response. Wall-clock cost is dominated by network/model latency, not local computation — an awaited HTTP call consumes negligible CPU. This means concurrency is not limited by core count, and it's deliberately not tuned against model-provider rate limits either (see §2.4) — under the model below, concurrency is simply the number of worker processes running, fixed to the hosting plan's replica ceiling, since each worker has exactly one call in flight at a time.

### 2.2 One worker, one document, sequential pages

Product tables can span multiple pages, with headers defined once and rows continuing without repetition. Rather than solving continuity with a cross-document, cross-worker claim query, each worker claims an entire document and processes all of its pages in order itself — so ordering is a local property of one worker's loop, not something coordinated across the pool.

**Document claim, longest-job-first:**

```sql
update documents
set status = 'claimed', claimed_by = $worker_id, claimed_at = now()
where id = (
  select id from documents
  where status = 'pending'
  order by page_count desc
  limit 1
  for update skip locked
)
returning *;
```

Ordering by `page_count desc` (longest job first) is a standard scheduling technique to minimize tail latency: large documents start early, while there is still a deep queue of other documents to keep every other worker busy in parallel, rather than being left for last when nothing remains to overlap with.

**Worker loop:**

```
loop forever:
  1. claim one pending document (query above)
  2. find its first page with status != 'done' (crash-resume point)
  3. for each page from there to the end, in order:
       - call extract(image, running_context)
       - write the page's result and updated running_context to the DB
  4. mark document done, trigger supplier resolution
  5. return to step 1
```

Because each page's result is written immediately (not batched at document end), a worker crashing mid-document loses no completed pages — the next worker to pick it up (via the reconciler, §7) resumes at the first incomplete page rather than reprocessing the document from scratch.

### 2.3 Why this doesn't meaningfully cost throughput at this workload's scale

The theoretical risk is load imbalance: a worker stuck on a 40-page catalog while others finish 4-page flyers and idle. This risk is a function of the ratio of documents to workers, not an inherent property of the design. With hundreds of documents queued against a much smaller worker count (e.g., 600 documents, 25 workers), a worker finishing early always has another document to claim immediately — idle time only appears in the final tail, once the queue is nearly empty, and longest-job-first (§2.2) shrinks that tail further by front-loading the large documents. This does not hold at low document-to-worker ratios (e.g., 30 documents, 25 workers) — worth re-evaluating if usage patterns change substantially.

**Deployment implication:** concurrency = worker replica count, with no separate in-flight cap or async scheduler required. On Railway this is a direct replica-count setting on one worker service — N identical processes running the loop above.

### 2.4 Worker count: fixed and small, by design

Deliberately not tuned against Anthropic rate limits — the worker count is kept small and fixed, sized to the hosting plan rather than to any theoretical throughput ceiling.

**Railway Hobby plan supports a maximum of 6 replicas per service**, with a pooled cap of 48 GB RAM / 48 vCPU across them, billed per-minute for actual resource consumption on top of the $5/month base. Since each worker here is I/O-bound (mostly waiting on the extraction API, negligible CPU/RAM per replica), the practical choice is:

- **Run 6 replicas during an active processing run** (the Hobby maximum), scaled back to 1 — or stopped — between events.
- Because billing is per-minute and this workload is bursty (idle for weeks, then a few hours of load after an event), running 6 lightweight replicas for an hour or two, a handful of times a year, stays comfortably inside the included $5 usage credit rather than accruing meaningful cost.
- If 6 replicas doesn't hit the desired turnaround time once real per-page timing is measured (see pilot, open items), the next lever is upgrading the plan tier for a higher replica ceiling — not micro-tuning concurrency within a single process.

Two minor practices still worth keeping regardless of worker count, since they cost nothing extra: **prompt caching** on the shared system prompt/schema (identical across every call), and a **tight `max_tokens`** per call rather than a generous default — both reduce token consumption per call with no design tradeoff.

### 2.5 Net effect

Because splitting and extraction are pipelined per-page rather than phase-gated per-corpus, the first extracted products are written to the database within seconds of the first page image existing — the UI does not wait for the whole upload batch to finish before showing progress. With 6 workers and an estimated ~10–15 seconds per page (two-stage extraction), a ~1,000-page event run is expected to complete in roughly 30–40 minutes — to be confirmed against real pilot timing.

---

## 3. Extraction pipeline (per page)

Two calls per page:

1. **Image → markdown.** The model transcribes the page, including tables, into markdown. This is more reliable for table-heavy content than requesting deeply nested JSON directly — the model effectively gets scratch space before producing a structured answer. The prompt includes `documents.running_context` so headers defined on a prior page aren't lost.
2. **Markdown → JSON.** A second call converts the markdown into schema-validated JSON via forced tool-calling (not a plain "return JSON" instruction), matching the `products` table shape. This eliminates malformed output as a failure mode.

**Decided: two-stage, final.** No further comparison against a single-stage approach planned.

---

## 4. Model routing

All extraction calls go through one function: `extract(image, context) → json`. The model behind it — Claude Sonnet 5 (production) or Qwen (testing) — is selected by configuration inside that function, not by a separate code path. Both receive the same image and the same schema; switching models is a config change.

---

## 5. Supplier resolution

A dedicated call reads only the first two and last two pages of a document (where company identity predictably appears — covers, footers, contact blocks) and resolves supplier name/contact details. This call runs independently of and concurrently with per-page product extraction; it does not block on product pages completing.

```sql
suppliers (
  id              uuid primary key,
  name            text,
  email           text,
  phone           text,
  website         text,
  website_domain  text unique,  -- normalized (no protocol/www/path), used for dedup lookup
  extra_details   jsonb,        -- anything supplier-specific and non-uniform
  created_at      timestamptz
)
```

**Dedup lookup, run before inserting a new supplier row**, in order of signal reliability:

1. **Website domain, exact match.** Normalize the resolved website to a bare domain and look up `suppliers.website_domain`. Company names get formatted inconsistently across brochures; a domain rarely does — this is the most reliable signal available.
2. **Email domain, exact match** — used only if no website was resolved.
3. **Fuzzy name match**, fallback only — Postgres trigram similarity (`pg_trgm` extension) comparing the resolved name against existing supplier names above a similarity threshold (e.g. `similarity(name, $resolved) > 0.6`), requiring a GIN trigram index on `suppliers.name` to stay fast as the table grows.

If none match, insert a new supplier row. An ambiguous/low-confidence fuzzy match should default to creating a new row rather than risking a false merge — a duplicate is correctable later; a wrong merge silently corrupts two companies' data together.

Once resolved (matched or newly created), `documents.supplier_id` is set, and every product extracted from that document's pages is stamped with the same `supplier_id` directly (denormalized onto `products`, not resolved via join at query time) so product search returns supplier info in a single lookup.

---

## 6. Writing results

```sql
products (
  id               uuid primary key,
  document_id      uuid references documents,
  supplier_id      uuid references suppliers,   -- denormalized for fast search
  source_page_id   uuid references pages,        -- traceability to the original scan
  name             text,
  cas_number       text,       -- nullable — not every product has a CAS number; normalized canonical form (see §6.5)
  cas_number_raw   text,       -- nullable — exact as-extracted text, before normalization, kept for audit
  characteristics  jsonb,      -- variable per-product specs
  needs_review     boolean default false,
  review_reason    text,       -- which check(s) triggered the flag, for the reviewer's benefit
  created_at       timestamptz
)
```

Each page's stage-2 JSON output is inserted directly as one or more `products` rows tagged with `source_page_id` and `document_id`. No merge step is needed — products from different pages of the same document are separate rows from the start; the shared `document_id`/`supplier_id` ties them together at query time.

**Column vs. JSONB rule:** fields that are searched or filtered on (`name`, `cas_number`, `supplier_id`) are real columns. Fields that vary per product/supplier and are display-only go into `characteristics` (products) or `extra_details` (suppliers).

---

## 6.5. CAS number normalization

**CAS numbers are not present on every product** — proprietary blends, mixtures, and non-chemical items legitimately have none. A missing `cas_number` is not by itself an error; the review logic below only flags it when there's contextual evidence one should exist.

**Format varies across brochures**, and needs normalizing before storage, validation, or search — the same substance shows up as `108-88-3`, `108 88 3`, `1088 83`, `CAS: 108-88-3`, `CAS No. 108-88-3`, etc. depending on how each supplier laid out their table.

**Decision: normalization is deterministic application code, not a model responsibility.** The stage-2 prompt instructs the model to transcribe the CAS number exactly as printed — no reformatting, correcting, or inferring missing digits. Reformatting is a mechanical, unambiguous operation once you have the raw digit string, so it belongs in code: it's instant, free, 100% consistent, and identical regardless of which model (Claude or Qwen) produced the extraction. Just as importantly, keeping the model's output raw preserves a clean error signal — if checksum validation fails, you know it's a genuine transcription/OCR issue on the raw text, not a formatting decision the model silently made along the way.

Normalization, applied in application code after stage 2 extraction, before insert:

1. Strip any label prefix (`CAS`, `CAS No.`, `CAS#`, `CAS-No:`, and similar — case-insensitive).
2. Strip everything but digits (drop spaces, hyphens, and any other separators).
3. Re-insert hyphens into the canonical position: CAS numbers are always digits split as `(2–7 digits)-(2 digits)-(1 check digit)`, so the last digit is the check digit, the two before it form the middle group, and everything remaining is the leading group.
4. Store the canonical hyphenated form in `products.cas_number`, and the exact as-extracted text (before any of the above stripping/reformatting) in `products.cas_number_raw` — kept alongside the normalized value on the same row, not just buried in `pages.raw_json`, so a reviewer or a debugging query can see both without an extra join.

Reject only `products.cas_number` (leave it `null` rather than force a normalization) if the digit count after stripping doesn't fall in the valid range (3–10 digits) — that's a signal the extracted text wasn't actually a CAS number, not something to force-fit. `cas_number_raw` is still populated with whatever was extracted regardless, so a reviewer can see what the source showed and why it failed to normalize.

## 6.6. Confidence scoring and review triggers

`products.needs_review` is set to `true` if **any** of the following trip, with the specific reason(s) recorded in `review_reason`:

- **CAS number checksum fails** — *only evaluated when `cas_number` is present*; a null CAS number never triggers this on its own. CAS Registry Numbers carry a real check digit (weighted sum of the preceding digits, mod 10, must equal the final digit), validated deterministically in application code against the normalized form above, no model call involved. Highest-confidence signal available: catches OCR/transcription errors with near-zero false positives, at no extra API cost.
- **Required field missing** — `name` is empty, or a row sits in a table where other rows on the same page clearly have populated CAS cells but this one is blank (contextual absence, not just "no CAS number was ever mentioned for this product" — the latter is expected and normal for blends/non-chemical items, not a review trigger).
- **Page needed a schema-validation retry** during stage 2 — usually indicates a messy source page (poor scan, unusual layout), so every product from that page is flagged, not just the one that initially failed.
- **Model self-reports low confidence** — the stage-2 JSON schema includes a `confidence: "high" | "low"` field per product, with instruction to mark low when the source text was blurry, the table structure was ambiguous, or a field had to be inferred rather than read directly. Added at no extra cost since it's part of the same call; not perfectly calibrated on its own, but useful combined with the deterministic checks above.

Flagged products route to a human review screen rather than entering the database unflagged. `review_reason` exists so a reviewer sees *why* something was flagged, not just that it was.

---

## 7. Reliability

- **All state lives in Postgres** — no in-memory queue or job state. A crash mid-document loses no completed pages; any worker can resume any claimed document by reading its `running_context` and per-page status.
- **Reconciler loop** (~30s interval) handles: documents `claimed` past a staleness timeout with no recent page progress (reset to `pending` so another worker resumes at the first incomplete page — crash recovery), individual pages that exceeded a retry limit (dead-letter), and documents where all pages are `done` but supplier resolution hasn't yet run.
- **Dead-lettered or low-confidence products** (`needs_review = true`) route to a human review queue rather than entering the database silently incorrect.
