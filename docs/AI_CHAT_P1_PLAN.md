# P1 build plan — chemical search assistant

Implements phase 1 of [AI_SEARCH_ARCHITECTURE.md](AI_SEARCH_ARCHITECTURE.md).

## Decisions locked

| | |
|---|---|
| Surface | Chat panel docked in the Search screen |
| Providers | `anthropic` (Sonnet 5) · `gpt` · `qwen` — one active at a time, `CHAT_PROVIDER` |
| Ranking axis | **Technical fit** from `listings.details`. Price is optional metadata — most brochures don't print one |
| Chat lifetime | **Ephemeral.** Dies when the box closes. No conversation tables |
| Audit | One `audit_log` row per exchange — survives the chat |
| Access | All three roles (`require_user`), same audience as `/search` |
| Thread cap | 20 messages, hard stop |
| Answers | Short, answer-first, no preamble |

### Two loops, not three

Qwen's DashScope endpoint is OpenAI-compatible and the repo already drives it
through the `openai` SDK. So GPT and Qwen share **one** loop and differ only by
base URL, key, and model name. Anthropic gets its own because its tool-use wire
format is genuinely different (`input_schema` / `tool_use` blocks /
`tool_result` blocks vs `parameters` / `tool_calls` / `role:"tool"`).

Three provider options, two implementations, one shared tool registry.

### Ephemeral means in-memory

No `chat_threads` / `chat_messages` tables. A thread is a dict in a
process-local store keyed by `(user_id, thread_id)`, evicted on explicit close
or after a TTL sweep.

> ⚠️ **Constraint:** this binds a thread to one backend process. Fine for the
> current single-uvicorn deployment; if the API is ever scaled to multiple
> workers, threads must move to Redis or a TTL table. Documented in the module.

Server-side rather than client-held transcript on purpose: a client that owns
the transcript can forge assistant turns, and forged turns are a prompt
injection vector straight into the tool layer.

### Not in P1

- **Token streaming** (rendering the answer word by word). Needs per-provider
  delta normalisation, which is the expensive half.

  **Progress-event streaming SHIPPED**, and is a different thing: both loops
  already know when a model call starts and which tool they are about to run,
  so one `on_event` callback per loop feeds a real SSE stream. The panel shows
  what the assistant is actually doing ("Searching the catalog for 'floor' →
  1 result") instead of a spinner. This also makes a misread question visible
  before the answer lands.
- Semantic "find something similar" (needs embeddings — P3)
- Web search / regulatory citations (P2)
- Curated substitution notes (P4)

---

## Build steps

### 1. Config and dependencies
`backend/requirements.txt`, `backend/app/config.py`

- Bump `anthropic` — the `>=0.40.0` pin predates Sonnet 5 and the tool runner.
- New settings: `chat_enabled`, `chat_provider`, `chat_anthropic_model`,
  `chat_gpt_model`, `chat_qwen_model`, `chat_effort`, `chat_max_messages`,
  `chat_max_rows`, `chat_max_tool_iterations`, `chat_rate_limit`,
  `chat_ttl_minutes`.
- No new keys: `anthropic_api_key`, `openai_api_key`, `qwen_api_key` all exist.

### 2. Read layer
`backend/app/services/database.py`

- `AGENT_COLUMNS = SEARCH_COLUMNS + ", details, company_website"` — the gap
  found in design: search filters on `details` but never returns it, so without
  this the assistant sees names and mostly-null prices and nothing else.
- `columns=` keyword on `search_listings` so the agent widens the projection
  **without forking the query path** (ARCHITECTURE.md §10 rule holds).
- `compare_suppliers(cas_number|chemical_id)` — one row per supplier for one
  substance, ordered by data completeness, not price.
- `list_detail_keys()` — distinct `details` keys with frequency. Brochures
  label the same concept `application` / `uses` / `recommended_for`; this tells
  the model the vocabulary that actually exists.
- `get_listing_provenance(listing_id)` — source document + page.

### 3. Tool layer
`backend/app/services/agent_tools.py` (new)

One provider-neutral registry: name, description, JSON-schema params, executor.
Two adapters render it to Anthropic and OpenAI tool formats. Descriptions are
prescriptive about *when* to call — models under-reach on passive descriptions.

Tools: `search_catalog`, `compare_suppliers`, `list_detail_keys`,
`get_listing_provenance`.

### 4. Provider loops
`backend/app/services/chat_providers.py` (new)

`ChatProvider` protocol → `run(system, messages, tools) -> ChatResult`.
`AnthropicChatProvider` and `OpenAICompatProvider` (GPT and Qwen).
Both cap tool iterations, collect a trace of tool calls, and return final text
plus the listing ids their tool results actually contained.

Sonnet 5 specifics handled: no `temperature`, no assistant prefill, no
mid-conversation system messages, `cache_control` on the stable prefix.

### 5. Prompt, session store, orchestration
`backend/app/prompts/chat_prompt.py`, `services/chat_session.py`,
`services/chat_agent.py` (all new)

Prompt covers: role · the price caveat · ranking rubric · trust rules ·
regulatory rule · answer style.

`chat_agent` validates the model's cited ids against ids actually returned by
tools this turn, drops unknowns, and writes the audit row.

### 6. API
`backend/app/schemas/chat.py`, `routers/chat.py`, `main.py`

`POST /chat/threads` · `POST /chat/threads/{id}/messages` ·
`DELETE /chat/threads/{id}` (close = destroy). `require_user`, rate-limited,
no `from __future__ import annotations` (breaks FastAPI under slowapi).

### 7. Frontend
`components/search/ChatPanel.tsx`, `lib/api.ts`, `types/chemical.ts`,
`pages/SearchPage.tsx`

Docked collapsible panel. Cited ids render as **live rows fetched from the
API**, never as model text. Closing the panel calls DELETE. Sends current
filters + selected listing as context each turn.

### 8. Verification
`manual_test.md` (append, house convention) + ARCHITECTURE.md §10 update.

---

## Where the risk is

Steps 1–3 are mechanical. **Step 4–5 carry the uncertainty**: prompt quality,
ranking sensibly without price, and keeping two loops behaviourally identical.
Ships behind `chat_enabled=False`.
