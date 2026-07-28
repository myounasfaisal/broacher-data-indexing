# Settings tab — audit and redesign

**Date:** 2026-07-28
**Status:** implemented

## The complaint

Too many options, and mixed together. Specifically: API keys are configured in
one place, but consumed in several others, and the page gave no hint of which
key belonged to which job.

## Audit

### 1. The page saved to a table almost nothing read

This was the real bug, and it invalidated everything else. Runtime code read
`settings.*` — the pydantic/env snapshot taken at process start:

- `extraction.py` → `settings.extraction_provider`, `settings.*_api_key`
- `chat_providers.py` → `settings.chat_provider`, `settings.chat_*_model`
- `embeddings.py` → `settings.embedding_provider`
- `nl_search.py` → `settings.search_provider`

`config.get_effective()` — the DB overlay the settings page writes to — existed
with **zero call sites**. Only `/admin/settings/status` and `/test-key` read
the DB. The header said *"Changes apply as soon as you save — no restart"*;
for all 47 settings that was false.

### 2. API keys are consumed in five provider selectors, not one

Grouped into three features:

| Feature | Provider setting | Models | Key |
|---|---|---|---|
| Brochure extraction | `extraction_provider` | `qwen_model` / `openai_model` / `gemini_model` / `claude_model` / `openrouter_model` | per provider |
| ↳ page extraction (worker, 2-stage) | `page_extract_provider` | `qwen_vlm_model` + `qwen_text_model`, `page_extract_claude_model` | qwen / anthropic |
| ↳ NL search | `search_provider` (empty = inherit) | reuses extraction models | per provider |
| Chat assistant | `chat_provider` | `chat_anthropic_model` / `chat_gpt_model` / `chat_qwen_model` | anthropic / openai / qwen |
| Semantic search | `embedding_provider` | `embedding_model` | qwen / openai |

Note `qwen_api_key` is one account serving three of them.

### 3. Categories sliced by data type, not by task

"API Keys", "Models" and "Extraction Pipeline" were peers. Enabling Claude
extraction meant three rail clicks — provider in one section, key in another,
model in a third — with nothing on screen saying steps 2 and 3 existed.

### 4. Dead options

`extraction_provider`'s dropdown offered qwen/gpt/gemini/claude. The backend's
`_PROVIDER_ALIASES` also accepts `glm` (OpenRouter) and `nuextract`, and the
keys, base URLs and model rows for both already shipped — unreachable from the
UI, so they read as clutter.

### 5. Rows that are not settings

`embedding_dim` (its own comment: *"not a tuning knob you can turn at
runtime"*), `allowed_origin`, `api_max_retries` and `chat_rate_limit` are
deploy config. The last three are read at import time to build decorators, so
they genuinely cannot apply without a restart.

## Redesign

### Four task-shaped sections

Each is one complete decision:

| Section | Contains |
|---|---|
| **Extraction** | provider → its key (+ Test) → its model → concurrency, DPI, PubChem. Advanced: endpoint, page-extract stage, NL-search override |
| **Chat assistant** | enable → provider → its key (+ Test) → its model → effort, limits |
| **Semantic search** | enable → provider → its key (+ Test) → model → match tuning |
| **System** | upload cap, retries, reconciler timings |

### The key move

**The key field lives inside the feature that uses it, next to its provider
dropdown — and only the selected provider's key is rendered.** Six flat key
fields collapse to the one in use. "Which of these do I need?" stops being a
question the admin has to answer.

A shared account (Qwen serves all three features) renders in each place it is
used, writing the same underlying row, with a note saying so:

> One account, shared with Chat assistant and Semantic search — editing it here
> changes it there too.

Three independent-looking fields would imply three keys that do not exist.

`credentials` and `models` remain DB categories — the rows are genuinely
shared, so they cannot live in one section — but they are no longer rail
entries. `settingsLayout.ts` composes them into the feature sections.

## What changed

**Backend — settings now actually apply**

- `config.py`: added `eff_str` / `eff_int` / `eff_bool` / `eff_float` typed
  accessors over `get_effective`. Junk text in a numeric field degrades to the
  env default rather than raising.
- New `services/llm_clients.py`: the single place a provider SDK client is
  built. Six duplicated copies removed (`extraction`, `ocr`, `pipeline/vlm`,
  `pipeline/extraction`, `chat_providers`, `embeddings`). Each cached client
  remembers the credentials it was built from and rebuilds when they change.
- Every runtime read switched from `settings.x` to `eff_*("x")` at call time.
- `app_settings.update_settings` calls `llm_clients.reset()` after a save.
- `app_settings.ensure_loaded` re-reads on a 30s TTL, and resets the provider
  clients when a value actually moved. Without this the fix would not have
  reached the worker or reconciler at all: they are separate processes that
  never call `update_settings`, so their cache held whatever the DB said at
  boot — and the worker is where extraction, the main consumer, runs.
- `tests/conftest.py`: autouse fixture disabling the DB overlay, so the suite
  no longer depends on whatever the developer's Supabase project has saved.

**Data**

- `db/migrations/2026-07-28_settings_regroup.sql`: eight categories → four
  (+ two non-nav), corrected descriptions that told the admin to edit `.env`,
  and marked the three restart-required settings as such.

**Frontend**

- New `lib/settingsLayout.ts`: the section/provider/key/model spec.
- `AdminSettingsPage.tsx` rebuilt around it.
- `extraction_provider` dropdown gained GLM-4.6V and NuExtract.

## Known limits

- `api_max_retries`, `chat_rate_limit` and `allowed_origin` still need a
  restart — they are decorator arguments evaluated at import. The migration
  appends "(takes effect after a backend restart)" to their descriptions rather
  than pretending otherwise.
- The worker and reconciler pick a change up on their next cache refresh, so
  worst case a save takes ~30s to reach an in-flight extraction rather than
  being instant.
