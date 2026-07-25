# Architecture — Brochure Upload & PDF Extraction

How a folder of PDFs travels from the browser to structured listings in the
database, how per-PDF context is held, and which AI models do which job.

---

## 1. End-to-end flow (folder → listings)

### 1. Browser collects files (client-side)
`frontend/src/components/upload/FolderPicker.tsx`
- Folder pick (`webkitdirectory`) or drag-drop **recursively walks the directory
  tree** (`readEntry`) into one **flat list**, then `filterPdfs` drops anything
  that isn't a PDF. Nothing uploads yet.

### 2. Staged for review
Files sit in `staged` state on `AdminUploadPage.tsx` so a stray folder can be
caught before anything is sent.

### 3. Enqueue loop (client → server)
`frontend/src/pages/AdminUploadPage.tsx` (`startUpload`, lines ~168–183)
```
for (const file of files) {
  if (file.size > MAX_SIZE_BYTES) {
    reject(file.name, "exceeds the 20MB limit");
    continue;
  }
  const tempId = `${file.name}-${Date.now()}-${Math.random()}`;
  setUploading((prev) => [...prev, { tempId, name: file.name }]);
  try {
    await api.enqueueUpload(file);
    queued++;
  } catch (err) {
    reject(file.name, err instanceof Error ? err.message : "upload failed");
  } finally {
    setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
  }
}
```
- A plain `for` loop that **`await`s each file one at a time** — one
  `POST /upload-jobs` multipart request per file. Client-side 20 MB gate first;
  each in-flight file shows an "Uploading…" placeholder row.

### 4. Per-file validation & enqueue (server)
`backend/app/routers/upload.py` (`enqueue_brochure`, lines 59–102)
- Validates content-type, **reads the whole PDF into memory** (`await file.read()`,
  never to disk), validates size + `%PDF-` magic bytes, then calls `jobs.enqueue`.

### 5. Queue + dedup
`backend/app/services/jobs.py` (`enqueue`, lines 172–218)
- SHA-256 the bytes. If seen before (DB ledger via `find_document`) or already
  in-flight this batch → returned immediately as `done`/duplicate, **no AI call**.
- Otherwise enforces the **512 MB pending-bytes cap** (`QueueFullError` → HTTP 503),
  stores the job + bytes in the in-memory `_jobs` dict, and wakes the worker.

### 6. Single background worker
`backend/app/services/jobs.py` (`_worker` / `_run_job`, lines 369–416)
- **One** asyncio worker processes **strictly one PDF at a time**. Extraction
  runs via `asyncio.to_thread` so status polling stays responsive. Lifecycle:
  `queued → processing → done | failed | cancelled`, with pause/resume/cancel/
  restart/remove controls per job.

### 7. Per-PDF extraction
`backend/app/services/extraction.py` (`extract_brochure`, line 895)
- Detect scanned vs text → (OCR if needed) → provider call → parse+validate JSON
  → deterministic bundle-split → persist each product via `dedup.resolve_chemical`
  + `database.insert_listing`. On success a document-ledger row is written so the
  same PDF is skipped next time.

---

## 2. How per-PDF context is saved

**Important: all context is in-memory and per-process only.** Nothing about an
in-progress PDF is persisted; a backend restart loses the whole queue by design
(acceptable for this internal tool).

- **The PDF bytes** live on the job object (`UploadJob.pdf_bytes`) in RAM while
  the job is queued/paused/processing, and are **kept for failed/cancelled jobs**
  so a restart needs no re-upload. They are **dropped on success** (a re-upload
  would be skipped by the document-hash guard anyway) and on removal.

- **Cross-page carry-forward context** (`extraction.py`, `_extract_pages`
  line 784): big brochures are extracted **page by page** and merged
  (`_merge_page_results`) so no single call truncates. To keep table headers that
  span pages, the last product's family/category (`_latest_family`) is threaded
  into the next page's prompt as a **continuation hint** (`_continuation_hint`,
  line 641) — "these rows belong to the most recently seen family: X".
  - ⚠️ This carry-forward only happens in **sequential mode** (`page_concurrency = 1`).
    With the **default `page_concurrency = 5`, pages run in parallel with an empty
    context** (`""`) — there is no cross-page family inheritance in the concurrent
    path; each page stands alone.

- **Document-level company identity** (`_extract_company_identity`, line 858):
  company name/website/email/phone live on the cover/footer, not on every product
  page, so per-page extraction misses them. They are recovered with **one focused
  pass over the first + last page** and merged in only for fields still missing.

- **Batch-level dedup context**: `_inflight_hashes` (a set of SHA-256 hashes)
  guards against two identical PDFs in the same batch both processing before the
  first records its ledger row.

- **Persistent context** (survives restart): only the **document ledger**
  (`database.record_document`: content hash, filename, company_id, product_count,
  listing_ids) and the inserted listings. The queue itself does not persist.

---

## 3. Which models are used for which job

Provider is chosen by `EXTRACTION_PROVIDER` in `.env` (default `qwen`), normalized
through `_PROVIDER_ALIASES`. Model names are configured in `backend/app/config.py`.

### OCR (image → text), used by several paths
| Job | Model (default) | Where |
|---|---|---|
| Page-image OCR | **Qwen VLM `qwen-vl-max`** (`qwen_vlm_model`) | `services/ocr.py` `ocr_pages` — runs pages concurrently up to `page_concurrency` |

### Extraction provider (text/image → structured JSON)
| `EXTRACTION_PROVIDER` | Model (default, `config.py`) | Path |
|---|---|---|
| `qwen` *(default)* | `qwen-vl-max` (`qwen_model`) | **Vision, per-page + merge** — model reads page images directly |
| `gpt` (aliases: chatgpt/openai) | `gpt-4o-mini` (`openai_model`) | **Qwen OCR each page → text → GPT** structures it, per-page + merge |
| `claude` (alias: anthropic) | `claude-haiku-4-5-20251001` (`claude_model`) | **Single call** — native PDF (text-based) or Qwen-OCR text (scanned) |
| `gemini` (alias: google) | `gemini-2.5-flash` (`gemini_model`) | **Single call** — native PDF or Qwen-OCR text |
| `glm` (openrouter/z-ai) | `z-ai/glm-4.6v` (`openrouter_model`) | **Single-model vision, per-page + parallel** — reads images AND structures them, no OCR step; rendered at `openrouter_vision_dpi = 150` |
| `nuextract` (numind) | NuExtract template API (`nuextract_api_base`) | **Qwen OCR whole doc → one template call** |

### Company-identity recovery pass
Uses the **same configured provider** as extraction, but a focused prompt over
first + last page only (`_extract_company_identity`).

### Reference two-model pipeline (`app/pipeline/*`, separate from the above)
| Stage | Model (default) |
|---|---|
| Stage 1 — page transcription (VLM) | `qwen-vl-max` (`qwen_vlm_model`) |
| Stage 2 — transcription → schema-constrained JSON | `qwen3-8b` (`qwen_text_model`), decoding via `pipeline_guided_decoding` |

All AI calls retry with exponential backoff (`tenacity`, `api_max_retries`);
per-page failures drop just that page rather than failing the whole brochure.

---

## 4. Concurrency & scalability summary

- **Across PDFs:** strictly serial — one background worker, one PDF at a time.
- **Within a PDF:** page-level concurrency (`page_concurrency = 5`) for OCR and
  for the per-page extraction providers (`qwen`/`gpt`/`glm`).
- **State:** in-memory, single-process. Backend restart loses the queue; running
  multiple server workers gives each its **own** independent queue + dedup set.
- **Backpressure:** 512 MB pending-bytes cap, 20 MB per file.

For hundreds of PDFs routinely this is throughput-bound: a durable queue
(Redis/Postgres-backed), multiple workers with a shared dedup lock, and streaming
uploads to disk/object storage instead of holding every PDF in RAM would be the
next step.
