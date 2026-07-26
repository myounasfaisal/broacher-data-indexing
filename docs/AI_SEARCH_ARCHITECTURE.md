# AI Search & Sourcing Advisor — architecture

Status: design, not implemented. Successor module to the upload/pipeline work.
Companion to [ARCHITECTURE.md](../ARCHITECTURE.md) §10 (read side).

## 1. What we are building

A **conversational assistant docked in the Search screen** — a panel the user
talks to while working the Inspector, not a separate destination. It answers
three kinds of question, and they do not carry equal weight:

1. **Sourcing** — "which of our suppliers carries an epoxy hardener for tile
   adhesive?" Every fact is in the catalog. Retrieval + ranking + explanation.

   > ⚠️ **Availability, not price, is the primary axis.** Most brochures do not
   > print prices. PRODUCT.md frames the product around "what a chemical costs
   > across suppliers", and the dashboard's `missing_price` slice shows the
   > gap — but for the assistant, price is *one optional column*, not the
   > ranking key. What the catalog reliably knows is **who supplies what, and
   > with what technical properties**. Design around that: rank by fit to the
   > user's stated requirement (from `details`), surface price when present,
   > never sort by it as a default. See §5.1.
2. **Opinion** — "what can I use instead of DEG for a GCC floor coating?"
   Not in the catalog. Chemistry judgement, constrained to what we can buy.
3. **Regulatory** — "X got banned, what do I switch to?"
   Neither in the catalog *nor* safely answerable from model memory. See §6.3.

These have different trust profiles and the architecture must keep them
visibly apart. PRODUCT.md: *"nothing is hedged, and nothing is oversold."*
A price and a professional opinion cannot render the same way.

**What it is not**: an assistant that "knows everything." It knows *your
catalog* exactly and *general chemistry* approximately, and the interface has
to say which is which on every claim. Blurring that line is the fastest way to
lose the trust the review queue exists to protect.

## 2. RAG or fine-tune? Neither, mostly.

**Fine-tuning is the wrong tool here.**

- No labelled dataset exists, and the only one worth having (BosTech's own
  substitution decisions) doesn't exist in writing yet either.
- The catalog changes every upload. A fine-tune bakes in a snapshot and goes
  stale the day it ships; prices *must* come from a live query.
- The chemistry knowledge needed for substitution advice is general and
  already present in a frontier model's pretraining. There is nothing to teach
  it that a system prompt and a tool can't supply.

**Classic RAG is also mostly the wrong tool.** RAG exists because facts are
locked in unstructured prose. Ours are not — they are rows in Postgres with
typed columns and a query path (`search_listings`) that already works and is
already trusted. Embedding those rows and retrieving them by cosine similarity
would be strictly worse than the SQL we have: no price bounds, no exact CAS
match, no pagination, no provenance.

**What we actually need is tool-calling over the existing trusted query path,**
with one small semantic index bolted on for the *one* job keyword search can't
do — "find me chemicals *like* this one."

So: an **agent with tools**, where the model reasons and explains but never
produces a number, and a **narrow vector index** used only for similarity, not
for fact retrieval.

## 3. Layers

```
  user sentence
        │
        ▼
  ┌─────────────────────────────────────────────────────────┐
  │ L2  Agent loop (Claude, tool-use)                       │
  │     reasons · sequences tools · writes prose            │
  └───────┬──────────────┬──────────────┬───────────────────┘
          │              │              │
     search_catalog  compare_       find_similar_
     (existing)      suppliers      chemicals
          │              │              │
          ▼              ▼              ▼
  ┌───────────────────────────┐  ┌──────────────────────┐
  │ L1a  Postgres — the truth │  │ L1b  pgvector index  │
  │  listings/companies/      │  │  one row per         │
  │  chemicals                │  │  *chemical*, not     │
  │  (search_listings)        │  │  per listing         │
  └───────────────────────────┘  └──────────────────────┘
```

### L1a — the trusted query path (exists)

`database.search_listings()` stays the only way catalog rows reach a response.
No second query path, same rule as `/search/ai` today.

Two new read functions:

- `compare_suppliers(chemical_id | cas_number)` → every listing for one
  substance, one row per supplier, with `price_usd`, `purity`, `currency`,
  `needs_review`, and the source document. This is the primitive that answers
  "who to buy from" — a deterministic table, not a model opinion.
- `get_listing_provenance(listing_id)` → document + page + signed image URL, so
  a recommendation can be traced back to the brochure page it came from. This
  is what makes the answer trustworthy enough to act on.

### L1b — the semantic index (new, small)

Table `chemical_embeddings`:

| column | notes |
|---|---|
| `chemical_id` uuid PK FK → `chemicals` | |
| `embedding` vector(1024) | pgvector, HNSW index |
| `source_text` text | what was embedded, kept for debugging |
| `updated_at` timestamptz | |

**Embed per canonical chemical, not per listing.** Listings are the *same*
substance repeated across suppliers; embedding each one multiplies cost and
makes similarity search return twelve copies of one product. The chemical row
is the identity; listings are joined back at answer time so prices are always
live and never stale inside the index.

`source_text` composes: `name_en` + trade names seen across listings +
`cas_number` + the distinct keys/values in `listings.details` for that chemical
(these carry the application language — "epoxy hardener", "plasticiser").

Refreshed by the worker after a document completes, for the chemicals it
touched. Scale is thousands of rows — this is a cheap index, not a system.

**Embedding provider**: Anthropic has no embeddings API. Use Qwen
`text-embedding-v3` via DashScope — `qwen_api_key` and `qwen_api_base` are
already configured and funded. New settings: `embedding_provider`,
`embedding_model`, `embedding_dim`.

### L1c — curated house knowledge (phase 3, the real moat)

Table `substitution_notes`: `from_chemical_id`, `to_chemical_id`, `context`
(free text: "GCC floor coatings, summer cure"), `author_id`, `created_at`.

Written by managers from the Inspector when they make a substitution call.
Retrieved by the agent and given **precedence over model knowledge**. This is
BosTech's own judgement, captured — worth more than any amount of model tuning
and vastly cheaper. It is also the only asset here that a competitor cannot buy.

### L2 — the agent

New service `services/sourcing_agent.py`, new endpoint `POST /search/agent`.

**Do not route this through `extraction.complete_text`.** That helper exists for
single-shot text completions across three providers; a tool-use loop is a
different shape. The agent is Anthropic-only, using the official SDK's tool
runner (`client.beta.messages.tool_runner`).

| | |
|---|---|
| Model | `claude-sonnet-5` — **decided** |
| Thinking | adaptive (on by default on Sonnet 5) |
| Effort | `medium` — Sonnet 5 defaults to `high`, which is more than a short-answer chat needs |
| Streaming | yes — 2–4 tool calls is 5–15s, the UI needs progress |
| Caching | `cache_control` on the system prompt + tool defs. **Minimum cacheable prefix on Sonnet 5 is 1024 tokens** — verify the prompt clears it or caching silently no-ops |
| Refusals | handle `stop_reason == "refusal"` before reading `content` |

**Sonnet 5 constraints that change the design:**

- **No mid-conversation system messages.** Sonnet 5 does not support
  `{"role": "system"}` inside `messages[]` — it returns a 400. This kills the
  approach in §6.2 for passing Inspector context. Use the fallback: a
  `<inspector_context>` block inside the user turn. Same cache behaviour
  (it sits after the cached prefix), just not the privileged operator channel.
- No `temperature` / `top_p` / `top_k` — non-default values are rejected.
  Tone is steered by prompt only.
- No assistant-turn prefills. Use `output_config.format` for structure.
- New tokenizer: ~30% more tokens for the same text than Sonnet 4.6. Baseline
  cost with `count_tokens` against `claude-sonnet-5`, not against older numbers.

Qwen and OpenAI stay in their own lanes: Qwen for extraction (unchanged) and
embeddings (P3); OpenAI optional as an alternate embedding provider. **The
agent loop is Anthropic-only** — mixing providers inside a tool-use loop means
reimplementing the loop per provider for no gain.

**Tools exposed to the model:**

| tool | wraps | purpose |
|---|---|---|
| `search_catalog` | `search_listings` | the existing filter surface, verbatim |
| `compare_suppliers` | new | one substance, every supplier, priced |
| `find_similar_chemicals` | pgvector | functional neighbours, catalog-constrained |
| `lookup_substitution_notes` | new | house knowledge, phase 3 |
| `web_search` | Anthropic server tool | external validation, citations on, phase 4 |

Tool descriptions must be **prescriptive about when to call**, not just what
they do — recent models under-reach for tools otherwise.

## 4. The trust boundary

The existing rule in [nl_search.py](../backend/app/services/nl_search.py) —
*the model never generates chemical data* — gets stronger, not weaker, because
the model now writes prose.

**Enforce it structurally, not by prompt.** The response schema separates prose
from data:

```jsonc
{
  "intent": "sourcing" | "alternatives" | "explain",
  "answer_markdown": "…",
  "recommendation": { "listing_id": "…", "why": "…" } | null,
  "cited_listing_ids": ["…"],
  "alternatives": [
    { "chemical_id": "…", "rationale": "…", "confidence": "high|medium|low" }
  ],
  "claims": [
    { "text": "…", "basis": "catalog" | "house_knowledge" | "model" | "web",
      "source_url": "…" }
  ],
  "caveats": ["…"]
}
```

Then, server-side:

1. Every `cited_listing_ids` entry must appear in the tool-result set for this
   request. Any that doesn't → drop it and flag the response.
2. **The UI renders listing rows from the database by id, never from the
   model's prose.** If the model writes "$1,240/MT" in `answer_markdown` and the
   row says $1,190, the user sees $1,190. Prices are not model output.
3. `basis` drives rendering. `catalog` claims render as fact.
   `model` claims render in a visually distinct block — "BrochureDB's read, not
   from your catalog." This is how an opinion feature stays honest, and it maps
   directly onto the "catalog is neutral" principle in PRODUCT.md.

## 5. Alternatives logic

Three signals, ranked, because they are not equally trustworthy:

1. **Same CAS, different supplier** — not an alternative at all, it's the same
   product. Route to `compare_suppliers`. Never present as a substitution.
2. **House knowledge** (`substitution_notes`) — highest confidence. Overrides
   the model. Cite the author and the context.
3. **Model + semantic neighbours** — the model proposes functional equivalents;
   `find_similar_chemicals` constrains them to substances that exist in the
   catalog. Confidence never above `medium` without a house note.

Then a purchasability filter: only surface an alternative with at least one
listing, and prefer ones with a printed price. An alternative we can't buy is
trivia.

## 6. The chat surface

Multi-turn changes three things: state, context, and how answers render.

### 6.1 Conversation state

Two tables:

- `chat_threads` — `id`, `user_id`, `title`, `created_at`, `archived_at`
- `chat_messages` — `id`, `thread_id`, `role`, `content` jsonb, `tool_calls`
  jsonb, `cited_listing_ids` uuid[], `created_at`

Server-side, not client-side. Three reasons: the audit trail in §7 needs the
tool calls, prompt caching needs a stable server-rendered prefix, and the CEO
works across devices.

`content` is jsonb, not text, because assistant turns carry the structured
claim/citation payload from §4 — not just prose.

**Threads are capped at 20 messages.** No compaction, no context editing — both
exist to survive unbounded threads and neither is needed here. This is a real
simplification, not a compromise: a sourcing question is answered in a handful
of turns, and one-thread-per-question is the right mental model anyway.

At the cap: **hard stop with a "start a new chat" action**, not a rolling
window that silently drops the oldest turns. A rolling window produces an
assistant that inexplicably forgets what you told it four messages ago, which
reads as a bug. A hard stop is honest and keeps cost per thread predictable.

**Message count is not the token budget.** The dominant cost is tool results —
40 listing rows with `details` blobs is far more context than 20 short
messages. So cap those separately: keep the **most recent two turns' tool
results in full**, and replace older ones with a one-line stub
(`"searched 'epoxy hardener' → 12 results, ids […]"`). The model retains what
it looked at without re-reading every row every turn. Without this rule, a
20-message thread still grows unboundedly in tokens.

**Storage vs window are different things.** The 20-cap governs what is sent to
the model. Every message is still persisted for the audit trail in §7 — a
recommendation that turns out wrong must stay reconstructable after the thread
is closed.

### 6.5 Answer length

Answers are **short and to the point**. This needs an explicit instruction in
the system prompt — it is not a model default, and notably it is *not*
controllable via `effort`, which changes thinking depth without reliably
shortening visible output.

The house style is already written down in PRODUCT.md and applies directly:
*plain and specific, nothing hedged, nothing oversold.* Concretely:

- Lead with the answer. "Buy from Al Rasheed at $1,190/MT" first, reasoning after.
- One or two sentences of rationale, not a report.
- Data goes in the rendered rows (§6.4), not restated in prose — the rows are
  already on screen, so repeating the numbers in a sentence is pure noise.
- No preamble ("Great question!", "Based on the catalog…"), no closing offer
  ("Would you like me to also…?").

Short answers also cut the cost gap between Opus 5 and Sonnet 5 considerably —
output tokens are the expensive half, and there are now few of them.

### 6.2 It must see what the user is looking at

The single biggest UX lever, and it costs almost nothing. The Inspector already
knows the active filters and the selected listing. Send that as context on
every turn so "is this one any good?" and "cheaper than this?" resolve without
the user retyping a chemical name.

On Opus 5 this would go in a mid-conversation system message. **Sonnet 5 does
not support that** (400), so it goes in a tagged block at the top of the user
turn instead:

```
<inspector_context>
filters: q="epoxy hardener", supplier=null, priced_only=false
selected_listing: 8f2a… (Araldite GY 250, Huntsman)
</inspector_context>

is this one any good?
```

Either way the rule is the same: **never rewrite the top-level system prompt**
to carry it. That invalidates the cached prefix on every filter change, which
is most turns.

### 6.3 Regulatory questions are the risky path

"Chemical X has been banned" is the example that worries me, because it is the
one class of question where a confident wrong answer has commercial and
compliance consequences — and it's the class the model is *least* equipped for:

- Bans are jurisdiction-specific. REACH ≠ GCC ≠ UAE municipal rules.
- Bans are dated. Model knowledge has a cutoff; a restriction that landed after
  it simply doesn't exist to the model.
- Bans are often partial — restricted above a concentration, in a use class, or
  pending phase-out — and that nuance is exactly what gets flattened.

**Rule: the assistant never asserts regulatory status from model memory.**
Three permitted behaviours, in order:

1. The user states the ban ("X got banned") → **accept it as the user's
   premise, don't verify, don't argue.** Answer the actual question: what
   available substitutes exist. This is the common case and it's safe, because
   the regulatory claim came from the human.
2. A `regulatory_notes` table (same shape as `substitution_notes` — jurisdiction,
   status, effective date, author) → cite it as house knowledge.
3. `web_search` with citations → present with the source link and the date, and
   render as `basis: "web"`, never as fact.

If none apply, the assistant says it can't confirm regulatory status and asks
the user to confirm — that is a *better* answer than a plausible guess.

This promotes `web_search` out of P4 for this question class specifically.

### 6.4 Rendering

Chat is prose, but the trust boundary in §4 does not relax. Assistant turns
reference listings by id; the UI renders those as **live rows pulled from the
database**, inline in the chat stream, styled like Inspector rows. The model's
prose describes; it never states the price.

Claims with `basis: "model"` or `"web"` render in a distinct block. A turn that
mixes catalog fact and professional opinion shows both, visibly separated.

## 7. Operational concerns

**Rate limiting** — reuse the slowapi limiter. `/search/agent` is more expensive
than `/search/ai`; start at 10/minute per user plus a daily cap.

**Caching** — cache the agent's *reasoning* by normalised-query hash for ~1h
(the catalog moves slowly). Always re-resolve prices by listing id at render
time, so a cached answer never shows a stale number.

**Audit** — every agent query goes to `audit_log`: query text, tools called,
cited listing ids, model, token usage. Needed for cost visibility, for
debugging bad answers, and because a sourcing recommendation that turns out
wrong needs to be reconstructable.

**Context bounds** — cap rows fed to the model (≈40 listings). Keep the full
result server-side and paginate in the UI.

**Failure modes**
- Empty catalog result → say so plainly, do not invent. Existing
  `NLSearchError` → 502 pattern extends.
- Refusal → handled per §L2, with a server-side fallback.
- Embedding index missing/stale → `find_similar_chemicals` degrades to trigram
  name match rather than failing the request.

## 8. Phasing

| phase | ships | new infra |
|---|---|---|
| **P1** | Chat panel, single-thread, catalog tools only (`search_catalog`, `compare_suppliers`). Answers "who to buy from and why", with provenance. Inspector context wired in from day one. | `chat_threads` / `chat_messages` |
| **P2** | `web_search` + citations. Unlocks the regulatory path (§6.3) safely. | none (server tool) |
| **P3** | pgvector index + `find_similar_chemicals` + ranked alternatives | pgvector, embedding job in the worker |
| **P4** | `substitution_notes` + `regulatory_notes` + manager capture UI | two tables, one Inspector affordance |

**Status: P1, P4 and P3 are built; P2 (`web_search`) is not.** P4 was pulled
ahead — ARCHITECTURE.md §14.5 explains why, §15 describes what shipped and
where it departs from this design (notably: `to_chemical_id` is nullable so a
note can name a substance we don't stock, and substitution notes carry a
`verdict` so a swap that failed can be recorded). §16 covers P3: it follows
this design closely, with the addition that `find_similar_chemicals` degrades
to a labelled name search rather than failing, and ships behind
`EMBEDDINGS_ENABLED` + a one-off backfill.

Reordered from the pre-chat draft: web search moves ahead of embeddings.
Regulatory questions are in the first thing the user asked for, and answering
them without a citable source is the one failure mode worth engineering around
early. Semantic similarity is a quality improvement on an answer that already
works — keyword + CAS matching covers more ground than it looks like it will.

P1 still proves the module: no embeddings, no new provider, and the sourcing
answer is fully useful on its own.

## 9. Open decisions

1. ~~**Embedding provider**~~ — **decided: Qwen** (`text-embedding-v3` via
   DashScope, existing funded key).
2. **Agent model tier** — recommending Opus 5, measure, drop to Sonnet 5 if
   volume demands it. Note chat is chattier than one-shot search, so this
   decision matters more now than it did.
3. **Thread retention** — do chats persist indefinitely, or expire? Affects
   `chat_messages` growth and what the audit trail can reconstruct.
