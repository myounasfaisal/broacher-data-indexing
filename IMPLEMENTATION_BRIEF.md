# Implementation brief — brochure extraction pipeline

Read this file and `schema-additions.sql` fully before writing any code. This brief reflects decisions already made — do not re-litigate them; ask only if something here conflicts with the existing codebase.

**Stack assumption:** Node.js/TypeScript backend worker, Supabase JS client (`service_role` key), deployed on Railway. If the existing repo uses a different stack, follow the existing repo's conventions instead and flag the mismatch.

---

## 0. What already exists — do not recreate

- Base schema: `profiles`, `chemicals`, `companies`, `listings`, with RLS (viewer/manager/admin roles, service-role-only writes). Already live in Supabase.
- `schema-additions.sql` (in this repo) — adds `documents`, `pages`, traceability columns on `listings`, `characteristics`/`cas_number_raw`/`review_reason` columns, and stronger `companies` dedup columns. **Run this in the Supabase SQL editor before building anything** if it hasn't been run yet.

## 1. What you're building

A background worker process that:
1. Watches `documents` for uploaded PDFs, splits them into page images (stored in Supabase Storage), writes one `pages` row per page, then deletes the original PDF.
2. Processes pages through a two-stage VLM extraction pipeline, writing results into `listings`.
3. Resolves the supplier (`companies`) per document, with dedup against existing companies.
4. Runs a reconciler loop for crash recovery and dead-lettering.

## 2. Core design decisions — final, implement as specified

**One worker claims one whole document at a time and processes its pages strictly in order.** This is deliberate — not the max-theoretical-parallelism design, chosen for lower complexity given the document counts involved (hundreds per event). Do not build a cross-document, cross-worker page-claim scheme.

```sql
-- document claim, longest-job-first
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

Worker loop:
```
loop forever:
  1. claim one pending document (query above)
  2. find its first page with status != 'done' (crash-resume point)
  3. for each page from there to the end, in order:
       a. call extract(image, running_context) -> { markdown, listings[] }
       b. write listings rows, update page status/raw_json, update documents.running_context
  4. once all pages done: run company resolution (step 4 below)
  5. mark document 'done'
  6. return to step 1
```

**Concurrency = number of worker replicas running.** Fixed at up to 6 (Railway Hobby's replica cap), not tuned against any model provider's rate limits. Scale replicas up during an active processing run, down to 1 (or stopped) between events.

**Two-stage extraction per page, final — do not build a single-stage alternative:**
1. Image → markdown (model transcribes the page, including tables, as-is).
2. Markdown → JSON via forced tool-calling/function-calling (not a plain "return JSON" instruction) matching the schema in §3. The prompt for stage 1 includes `documents.running_context` so table headers defined on an earlier page of the same document aren't lost; after each page, update `running_context` with whatever the next page might need (current table headers, current product family).

**Model routing — one function, config-driven:**
```
extract(image, context) -> json
```
Model used (Claude Sonnet 5 for production, Qwen for testing) is selected via config/env var inside this function, not a separate code path. Both models receive the same image and the same schema.

**No Anthropic Message Batches API.** Use live, concurrent calls — this workload prioritizes wall-clock turnaround over the batch discount.

## 3. Extraction schema (stage 2 output, per listing)

```
{
  name_raw: string,       // exactly as printed, source language
  name_en: string,        // English translation
  cas_number_raw: string | null,   // exactly as printed — instruct the model NOT to reformat
  price: number | null,
  currency: string | null,
  purity: string | null,
  characteristics: object | null,  // any other variable attributes as key-value pairs
  confidence: "high" | "low"       // model self-reports low if blurry/ambiguous/inferred
}
```

**Prompt instruction for `cas_number_raw` specifically:** "extract the CAS number exactly as it appears in the source text — do not reformat, correct, or infer missing digits." Formatting is handled entirely in application code (§5), never by the model.

## 4. Company (supplier) resolution

Separate, independent call — runs in parallel with per-page extraction, does not block on it. Reads only the first two and last two pages of the document (cover/footer, where company identity predictably lives).

**Dedup lookup before inserting a new `companies` row**, in order:
1. Normalize resolved website to a bare domain → exact match on `companies.website_domain`.
2. If no website, exact match on email domain.
3. Fallback: Postgres trigram similarity on `companies.name` (`pg_trgm`, threshold ~0.6). Ambiguous/low-confidence match → create new row rather than risk a false merge.

Once resolved (matched or created), set `documents.company_id`, and stamp `company_id` + `company_name` (denormalized) onto every `listings` row from that document.

## 5. CAS number normalization (application code, after extraction, before insert)

1. Strip label prefixes (`CAS`, `CAS No.`, `CAS#`, case-insensitive).
2. Strip everything but digits.
3. Re-insert hyphens at the canonical position: `(2–7 digits)-(2 digits)-(1 check digit)`.
4. Validate the check digit: weighted sum of preceding digits mod 10 must equal the final digit.
5. Store the canonical form in `listings.cas_number`; keep the pre-normalization text in `listings.cas_number_raw` regardless of outcome.
6. If the digit count after stripping isn't in range 3–10, leave `listings.cas_number` `null` — don't force a match. `cas_number_raw` is still populated.

CAS number is optional per listing — a `null` value is not itself an error (blends, non-chemical items).

## 6. `needs_review` triggers

Set `listings.needs_review = true` and record the reason(s) in `listings.review_reason` if **any**:
- CAS checksum fails (only evaluated when `cas_number` is non-null).
- `name_raw` is empty, or a row sits in a table where sibling rows on the same page have populated CAS cells but this one doesn't (contextual absence — not "this product simply has no CAS number," which is normal).
- The page needed more than one attempt to pass stage-2 schema validation — flag every listing from that page.
- Model self-reported `confidence: "low"`.

## 7. Reliability / reconciler

Runs every ~30s:
- `documents` in `claimed` status past a staleness timeout with no recent page progress → reset to `pending` (another worker resumes at the first incomplete page).
- `pages` that exceeded a retry limit → mark `dead`, surface in review queue.
- `documents` where all pages are `done` but company resolution hasn't run yet → trigger it.

All state lives in Postgres. No in-memory job queue, no state held only in a worker process.

---

## Build order

1. Confirm `schema-additions.sql` is applied.
2. Implement `extract(image, context)` with the model-routing config, stubbed/testable independent of the worker loop.
3. Implement CAS normalization + checksum as pure, unit-testable functions first — no DB or API dependency.
4. Implement the worker loop (document claim → page loop → write listings) against a single test document before wiring up concurrency.
5. Implement company resolution + dedup lookup.
6. Implement the reconciler loop.
7. Deploy as a Railway service, confirm replica scaling works, run against a small real pilot batch (10–20 pages) before a full event-scale run.
