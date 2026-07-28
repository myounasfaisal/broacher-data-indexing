-- Regroup app_settings from eight type-shaped categories into four
-- task-shaped ones, and correct descriptions that still told the admin to
-- edit a .env file.
--
-- WHY: the original categories sliced settings by what they *are* (API Keys,
-- Models, Extraction Pipeline) rather than by what they configure. Turning on
-- Claude extraction meant visiting three separate sections — pick the provider
-- in one, paste the key in another, choose the model in a third — with nothing
-- on screen saying the second and third steps existed. The four categories
-- here each hold one complete decision.
--
-- Keys and models keep their own category ('credentials' / 'models') because a
-- single key row is genuinely shared: qwen_api_key powers extraction, chat and
-- embeddings. The UI renders those rows inside whichever feature section is
-- using them, filtered by that feature's selected provider, so the admin only
-- ever sees the one key that matters. See frontend/src/lib/settingsLayout.ts.

-- ── 1. Regroup ────────────────────────────────────────────────────────

-- Extraction absorbs the pipeline knobs; PubChem enrichment is part of what
-- extraction produces, so it belongs to the same decision.
update app_settings set category = 'extraction'
 where key in (
   'extraction_provider', 'search_provider', 'page_extract_provider',
   'page_concurrency', 'split_dpi',
   'pubchem_enrichment', 'pubchem_cas_lookup'
 );

-- 'embeddings' is what the feature is built from; 'search' is what it does.
update app_settings set category = 'search'
 where category = 'embeddings';

-- Reconciler timings and upload/retry limits are all "set once, rarely touch".
update app_settings set category = 'system'
 where category in ('limits', 'reconciler');

-- Secrets and endpoints. Rendered inside the feature that uses them, never as
-- a section of their own.
update app_settings set category = 'credentials'
 where key in (
   'anthropic_api_key', 'openai_api_key', 'qwen_api_key', 'gemini_api_key',
   'openrouter_api_key', 'nuextract_api_key',
   'openai_api_base', 'qwen_api_base', 'openrouter_api_base',
   'nuextract_api_base', 'nuextract_project_id'
 );

-- ── 2. Descriptions that pointed at the wrong place ───────────────────
--
-- These predate the settings page actually taking effect, and told the admin
-- to go and edit .env — which is now the fallback, not the control.

update app_settings
   set description = 'Structured-extraction project ID from nuextract.ai'
 where key = 'nuextract_project_id';

update app_settings
   set description = 'Vector width. Must match the chemical_embeddings migration '
                     || '— changing it means re-embedding everything, so it is not '
                     || 'a tuning knob.'
 where key = 'embedding_dim';

-- Two settings genuinely cannot be applied without a restart: both are read
-- once at import time to build a decorator (the retry policy and the rate
-- limiter). Saying so beats an admin wondering why nothing changed.
update app_settings
   set description = description || ' (takes effect after a backend restart)'
 where key in ('api_max_retries', 'chat_rate_limit', 'allowed_origin')
   and description not like '%restart%';

-- ── 3. Providers the backend supports but the UI could never select ───
--
-- extraction.py accepts 'glm' (via OpenRouter) and 'nuextract', and the keys,
-- base URLs and model rows for both already existed — but the provider
-- dropdown offered only qwen/gpt/gemini/claude, so those rows were
-- unreachable. The dropdown now lists them; nothing to change in data.

-- ── 4. The DashScope endpoint split ───────────────────────────────────
--
-- DashScope runs two deployments — mainland China and international — with
-- separate key namespaces. A key from one gets a bare 401 from the other,
-- which reads as "bad key" and sends the admin off to regenerate a key that
-- was fine. The default stays mainland (changing it would break every existing
-- install); the description now says the choice exists, and the settings page
-- offers both as a dropdown rather than a URL to type from memory.

update app_settings
   set label = 'Qwen endpoint',
       description = 'DashScope has two deployments with separate keys: '
                     || 'mainland China (dashscope.aliyuncs.com) and international '
                     || '(dashscope-intl.aliyuncs.com). A key from one is rejected '
                     || 'with a 401 by the other — pick the console your key came from.'
 where key = 'qwen_api_base';
