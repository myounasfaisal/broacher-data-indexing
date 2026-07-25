# Migration Plan — moving to the DB-indexed, worker-per-document architecture

**Source design:** [nasir-data-indexing-architecture.md](nasir-data-indexing-architecture.md)
**Current state reference:** [ARCHITECTURE.md](ARCHITECTURE.md)
**Status:** DRAFT — for review. Open decisions in §6 must be settled before development starts.

---

## 1. What the new design actually changes

The Nasir doc is not a tweak to the current pipeline; it replaces the two load-bearing
pieces of the system — **how work is queued** and **how a document's state is stored** —
and along the way rewrites the schema and the extraction call. Everything else
(auth, roles, search, dashboard, review UI) can sit on top largely unchanged **if** we
keep the product/supplier data model feature-compatible (see §6, Q4).

The five structural shifts:

| # | Dimension | Current (as-built) | Target (Nasir doc) |
|---|---|---|---|
| 1 | **Work state** | In-memory `jobs.py` queue, one asyncio worker, lost on restart | All state in Postgres (`documents`/`pages` status machine); crash-safe |
| 2 | **Parallelism** | Strictly one PDF at a time (single process) | N stateless workers, **one worker owns one document**, longest-job-first claim (`FOR UPDATE SKIP LOCKED`) |
| 3 | **Input unit** | Whole PDF held in RAM, rendered to images in-memory | PDF split to **one image per page in Supabase Storage**, source PDF deleted; page rows drive the pipeline |
| 4 | **Extraction call** | Single-stage, 6 providers (qwen/gpt/gemini/claude/glm/nuextract), page-merge to dodge truncation | **Two-stage per page**: image→markdown, then markdown→JSON via **forced tool-calling**; 2 providers only (Claude Sonnet 5 prod / Qwen test) behind one `extract(image, context)` |
| 5 | **Deploy** | Single local FastAPI process | Railway, up to **6 worker replicas** during a run, scaled to ~1 between events |

---

## 2. Schema: current vs. target

**Current live tables:** `profiles`, `chemicals` (canonical CAS-deduped identity),
`companies` (canonical supplier), `listings` (one offer), `documents` (content-hash
ledger only), plus `exchange_rates`.

**Target tables (Nasir doc):** `documents` (full status machine + `running_context`),
`pages` (per-page status/markdown/json/attempts), `suppliers` (website-domain deduped),
`products` (per-row, denormalized `supplier_id`, `cas_number` + `cas_number_raw`,
`characteristics`, `needs_review`/`review_reason`).

### Notable mismatches to resolve

- **`documents` collides.** Today it's a dedup ledger keyed on `content_hash`. In the
  target it's the central work-queue row (status, `running_context`, `page_count`,
  `claimed_by`, `claimed_at`). We keep the name but it becomes a different table —
  the content-hash dedup has to be re-homed (a column on the new `documents`, or kept
  as a side ledger).
- **`suppliers` vs `companies`.** Rename + reshape. The target dedups on
  `website_domain` (unique) → email domain → `pg_trgm` fuzzy name. Today `companies`
  dedups on **name** (bilingual, in Python). The target is stronger; adopting it means
  a `website_domain` normaliser + a GIN trigram index.
- **`products` vs `listings` + `chemicals`.** The target has **no canonical
  `chemicals` table** — products are standalone rows tied only by `document_id`/
  `supplier_id`. Today we deliberately built a CAS-first `chemicals` canonical layer to
  power "who supplies this exact substance" grouping and to stop fuzzy over-merges.
  **Dropping it is a real product decision** (see §6, Q2).
- **Missing feature columns.** The target `products` table has no `price`/`currency`/
  `purity`/bilingual `name_raw`/`name_en`/`details`. The live app searches, sorts and
  filters on all of these (USD price normalisation, purity ranges, bilingual search,
  PubChem enrichment). Either the target schema is illustrative and we extend it, or
  this is a scope cut (see §6, Q4).

---

## 3. Component-by-component gap analysis

| Area | Keep as-is | Rewrite | Build new |
|---|---|---|---|
| Auth / roles / RLS | ✅ profiles, JWT verify, 3-tier roles | — | Storage-bucket RLS for page images |
| Upload entry | partial (validation, size gate) | `POST` now creates a `documents` row + kicks off split, doesn't hold bytes | PDF **splitter** (render→upload page images→delete PDF→insert `pages`) |
| Job queue | ❌ | `jobs.py` → **DB claim loop** (`FOR UPDATE SKIP LOCKED`, longest-job-first) | worker as a standalone process (Railway service), not in the API process |
| Extraction | reuse Qwen + Claude clients, retry policy | `extract_brochure(whole pdf)` → **`extract(image, ctx)`** two-stage per page; drop gpt/gemini/glm/nuextract paths | stage-1 markdown prompt; stage-2 forced tool-call schema; `running_context` threading in DB |
| Supplier resolution | reuse name-fuzzy idea | move to a **dedicated first-2/last-2-page call**, domain-first dedup | `website_domain` normaliser, `pg_trgm` GIN index |
| CAS handling | scattered (`pipeline/schema.is_valid_cas`) | centralise | deterministic **normaliser + checksum** → `cas_number`/`cas_number_raw`, review trigger |
| Review flags | reuse `needs_review` + ReviewQueuePage | broaden triggers | `review_reason`, confidence field in stage-2 schema, contextual-absence check |
| Reliability | ❌ (in-memory) | — | **reconciler loop** (~30s): stalled-claim reset, page dead-letter, done-but-unresolved-supplier |
| Search / dashboard / history / dedup-undo | ✅ mostly | repoint queries at `products`/`suppliers` | — |
| Deploy | local | — | Railway worker service + replica config; Supabase Storage bucket |

---

## 4. Proposed build phases

Ordered so the system stays runnable and each phase is independently testable.

1. **Schema migration (additive first).** Create `pages`, reshape `documents` into the
   status machine, add `suppliers` (with `website_domain` + trigram index), extend
   `products`. Do **not** drop the old tables yet — decide data migration in §6 Q1.
2. **PDF splitter + Storage.** New upload flow: create `documents` row → split PDF to
   page PNGs → upload to a Storage bucket → insert `pages` (`status='pending'`) →
   delete source PDF. (This is the "separate document" the Nasir doc assumes exists —
   **we still have to build it**; see §6 Q5.)
3. **`extract(image, context)` two-stage function.** Image→markdown, markdown→JSON via
   forced tool-calling, model chosen by config. Unit-test against the existing
   `test file/` brochures (wsccp, KLJ, BANGLIAN).
4. **DB worker loop.** Standalone process: claim document (longest-job-first) → walk
   pages sequentially → write page result + `running_context` each step → mark done →
   trigger supplier resolution. Runs locally as 1 process first.
5. **Supplier resolution + CAS/review logic.** Domain-first dedup; deterministic CAS
   normalise/checksum; the full `needs_review` trigger set.
6. **Reconciler loop.** Stalled-claim reset, page retry/dead-letter, orphaned-supplier
   resolution.
7. **Repoint frontend/search/dashboard** at the new tables; keep feature parity
   (price/purity/bilingual/enrichment) per §6 Q4.
8. **Deploy to Railway** as a worker service with replica scaling; wire Storage.

---

## 5. What we can safely reuse from today's code

- Qwen (OpenAI-compatible) and Anthropic clients + `tenacity` retry policy in
  `extraction.py` — the plumbing, minus the 4 providers we're dropping.
- `pdf_utils.render_pages()` — becomes the splitter's render step.
- `dedup.py` fuzzy-name logic + `pg_trgm` know-how — feeds supplier fuzzy fallback.
- The whole auth/roles/RLS/frontend shell, search UI, dashboard, review queue.
- `pipeline/schema.py` CAS validity + bundle-split helpers — feed CAS normalisation.

---

## 6. Open decisions — need your input before we build

These are the points where the new doc conflicts with, or is silent about, real
existing investment. Each changes the plan materially.

**Q1 — Existing data.** The live DB has ~576 real listings + companies. New schema is a
different shape. Migrate/backfill into `products`/`suppliers`, or start clean and
re-process brochures?

**Q2 — Canonical `chemicals` layer.** The Nasir doc drops it (products stand alone).
We built it deliberately (CAS-first) to power substance-level grouping and stop
over-merges. Drop it to match the doc, or keep it alongside `products`?

**Q3 — Providers & keys.** Doc says Sonnet 5 (prod) + Qwen (test) only. Today's prod
key with quota is **Qwen**; Anthropic is configured to Haiku, and there's no evidence of
a funded Sonnet 5 key. Confirm we collapse to 2 providers, and confirm the Sonnet 5
Anthropic budget exists.

**Q4 — Feature scope of `products`.** The doc's `products` table omits
price/currency/purity/bilingual names/details/PubChem enrichment that the live app
searches and filters on. Keep all current fields (extend the target schema), or is this
an intentional slim-down?

**Q5 — The upstream splitter.** The doc *starts* after page images exist in Storage and
treats upload+split as a separate, already-built document. It isn't built. Confirm it's
in scope for us (it is, per §4 Phase 2) and that Supabase Storage is the image store.

**Q6 — Deployment target.** The whole worker/replica model assumes Railway (6-replica
Hobby ceiling) + Supabase Storage. Is Railway confirmed as the host, and is running
6 worker replicas during an event the real operational plan (vs. staying single-process
for now)?
