-- Admin-configurable application settings stored in Supabase.
-- Each row is one setting; the backend reads them on startup and caches
-- in-memory, re-reading on admin PUT.  Secrets (API keys) are stored as
-- plain text in the DB (service-role only) but masked when returned to
-- the frontend via the API.

create table if not exists app_settings (
  key         text primary key,
  value       text not null default '',
  is_secret   boolean not null default false,
  category    text not null default 'general',
  label       text not null default '',
  description text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

-- RLS: only the service role (backend) touches this table.
alter table app_settings enable row level security;

-- Audit: record every settings change.
create table if not exists settings_audit (
  id          bigint generated always as identity primary key,
  setting_key text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references auth.users(id),
  changed_at  timestamptz not null default now()
);

alter table settings_audit enable row level security;

-- Seed the default settings so the admin UI has rows to display on day one.
-- Values are empty strings (the real values live in .env until the admin
-- overrides them through the UI).
insert into app_settings (key, value, is_secret, category, label, description) values
  -- Extraction pipeline
  ('extraction_provider',    'qwen',  false, 'extraction', 'Extraction provider',    'Which AI model extracts products from brochures: qwen, gpt, gemini, claude'),
  ('search_provider',        '',      false, 'extraction', 'Search provider',        'AI provider for natural-language search (empty = same as extraction)'),
  ('page_concurrency',       '5',     false, 'extraction', 'Page concurrency',       'Pages OCR''d in parallel per document (higher = faster but more 429s)'),
  ('split_dpi',              '200',   false, 'extraction', 'Split DPI',              'Resolution for PDF-to-image conversion (lower = cheaper, higher = better OCR)'),
  ('page_extract_provider',  'qwen',  false, 'extraction', 'Page extract provider',  'Provider for the DB-worker two-stage extraction: qwen or claude'),

  -- API keys
  ('anthropic_api_key',      '',  true,  'api_keys', 'Anthropic API key',     'Claude API key from console.anthropic.com'),
  ('openai_api_key',         '',  true,  'api_keys', 'OpenAI API key',        'GPT API key from platform.openai.com'),
  ('openai_api_base',        '',  false, 'api_keys', 'OpenAI base URL',       'Custom OpenAI-compatible endpoint (empty = api.openai.com)'),
  ('qwen_api_key',           '',  true,  'api_keys', 'Qwen API key',          'Dashscope API key for Qwen vision/text models'),
  ('qwen_api_base',          'https://dashscope.aliyuncs.com/compatible-mode/v1', false, 'api_keys', 'Qwen base URL', 'Qwen OpenAI-compatible endpoint'),
  ('gemini_api_key',         '',  true,  'api_keys', 'Gemini API key',        'Google AI API key from ai.google.dev'),
  ('openrouter_api_key',     '',  true,  'api_keys', 'OpenRouter API key',    'OpenRouter API key for GLM-4.6V and other models'),
  ('openrouter_api_base',    'https://openrouter.ai/api/v1', false, 'api_keys', 'OpenRouter base URL', 'OpenRouter API endpoint'),
  ('nuextract_api_key',      '',  true,  'api_keys', 'NuExtract API key',     'NuMind NuExtract cloud API key'),
  ('nuextract_api_base',     'https://nuextract.ai/api', false, 'api_keys', 'NuExtract base URL', 'NuExtract API endpoint'),
  ('nuextract_project_id',   '',  false, 'api_keys', 'NuExtract project ID',  'Structured-extraction project ID on nuextract.ai'),

  -- Models
  ('openai_model',           'gpt-4o-mini',   false, 'models', 'OpenAI model',           'GPT model for extraction (text -> JSON)'),
  ('qwen_model',             'qwen-vl-max',   false, 'models', 'Qwen vision model',      'Qwen VLM for OCR and page extraction'),
  ('qwen_vlm_model',         'qwen-vl-max',   false, 'models', 'Qwen VLM (pipeline)',    'Stage-1 vision model for the reference pipeline'),
  ('qwen_text_model',        'qwen3-8b',      false, 'models', 'Qwen text model',        'Stage-2 text model for schema-constrained JSON'),
  ('gemini_model',           'gemini-2.5-flash', false, 'models', 'Gemini model',         'Gemini model for extraction'),
  ('claude_model',           'claude-haiku-4-5-20251001', false, 'models', 'Claude model', 'Claude model for extraction'),
  ('openrouter_model',       'z-ai/glm-4.6v', false, 'models', 'OpenRouter model',       'Vision model served via OpenRouter'),
  ('page_extract_claude_model', '', false, 'models', 'Page extract Claude model', 'Claude model for page extraction stage 2 (empty = claude_model)'),

  -- Chat assistant
  ('chat_enabled',           'false', false, 'chat', 'Enable chat',            'Turn the sourcing assistant on/off (endpoints 503 when off)'),
  ('chat_provider',          'anthropic', false, 'chat', 'Chat provider',      'Which provider drives the chat agent: anthropic, gpt, qwen'),
  ('chat_anthropic_model',   'claude-sonnet-5', false, 'chat', 'Chat Claude model', 'Anthropic model for the chat assistant'),
  ('chat_gpt_model',         'gpt-4o-mini', false, 'chat', 'Chat GPT model',    'OpenAI model for the chat assistant'),
  ('chat_qwen_model',        'qwen-plus', false, 'chat', 'Chat Qwen model',    'Qwen text model for the chat assistant'),
  ('chat_effort',            'medium', false, 'chat', 'Chat effort level',     'Anthropic thinking effort: low, medium, high'),
  ('chat_max_messages',      '20',    false, 'chat', 'Max messages/thread',    'Hard cap on messages in one chat thread'),
  ('chat_max_tool_iterations', '6',   false, 'chat', 'Max tool iterations',   'Safety valve on agent tool round-trips per turn'),
  ('chat_rate_limit',        '10/minute', false, 'chat', 'Chat rate limit',    'Per-user rate limit for chat messages'),

  -- Embeddings / semantic search
  ('embeddings_enabled',     'false', false, 'embeddings', 'Enable embeddings',    'Turn semantic similarity search on/off'),
  ('embedding_provider',     'qwen',  false, 'embeddings', 'Embedding provider',   'Provider for vector embeddings: qwen or openai'),
  ('embedding_model',        'text-embedding-v3', false, 'embeddings', 'Embedding model', 'Model name for generating embeddings'),
  ('embedding_dim',          '1024',  false, 'embeddings', 'Embedding dimensions', 'Vector width (must match DB migration column)'),
  ('embedding_match_count',  '8',     false, 'embeddings', 'Match count',          'Neighbours returned per similarity search'),
  ('embedding_min_similarity', '0.5', false, 'embeddings', 'Min similarity',       'Cosine-similarity floor for results'),

  -- PubChem enrichment
  ('pubchem_enrichment',     'true',  false, 'enrichment', 'PubChem enrichment',    'Attach reference data (formula, IUPAC) from PubChem to products with CAS'),
  ('pubchem_cas_lookup',     'true',  false, 'enrichment', 'CAS lookup by name',    'Resolve CAS numbers from chemical names via PubChem when not printed'),

  -- Behaviour / limits
  ('max_upload_size_mb',     '20',    false, 'limits', 'Max upload size (MB)',   'Largest PDF the upload endpoint accepts'),
  ('api_max_retries',        '3',     false, 'limits', 'API max retries',        'Retry count for flaky external API calls'),
  ('allowed_origin',         'http://localhost:5173', false, 'limits', 'Allowed origin', 'Frontend origin for CORS (exact, no wildcard)'),

  -- Reconciler
  ('reconciler_interval_seconds', '30',  false, 'reconciler', 'Sweep interval (s)',    'How often the reconciler checks for stalled work'),
  ('document_stale_seconds',     '300',  false, 'reconciler', 'Stale timeout (s)',     'Seconds before an extracting document is considered stalled'),
  ('max_page_attempts',          '3',    false, 'reconciler', 'Max page attempts',     'Failed page retries before dead-lettering')
on conflict (key) do nothing;
