"""
Typed application configuration.

All tunable values (model name, file size cap, allowed origin, secrets) are
read from environment variables here via pydantic-settings, so changing one is
a single env-var edit rather than a code hunt. Import `settings` anywhere.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Secrets / external services ---
    anthropic_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_anon_key: str = ""
    # Symmetric secret Supabase uses to sign user JWTs (Dashboard ->
    # Project Settings -> API -> JWT Secret). Used to verify tokens locally
    # on protected routes without a round-trip to the auth server.
    supabase_jwt_secret: str = ""

    # --- Provider selection ---
    # Which model provider to use for extraction (the model that turns a
    # brochure into structured product JSON): "gpt", "qwen", "gemini", or
    # "claude". With "gpt", Qwen OCRs every brochure's page images and GPT
    # turns that OCR text into the JSON (GPT never does vision itself).
    extraction_provider: str = "qwen"
    # Provider for the NL search agent (lightweight text-only filter parsing).
    # Empty string means "same as extraction_provider".
    search_provider: str = ""

    # --- OpenAI GPT (extraction JSON generator) ---
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    # Optional OpenAI-compatible base URL. Empty = OpenAI's own endpoint
    # (api.openai.com). Point this at a free GPT-compatible gateway (e.g. a
    # GitHub Models / OpenRouter / local endpoint) to run GPT without OpenAI
    # billing.
    openai_api_base: str = ""

    # --- OpenRouter / GLM-4.6V (single-model VISION extraction) ---
    # GLM-4.6V is multimodal (image+text), 131k context, 32k output. It reads
    # the brochure page images AND emits the full product JSON in ONE call — one
    # model does everything (no separate OCR step), and seeing every page at once
    # makes bundle-splitting / cross-page table inheritance reliable. Uses
    # OpenRouter's OpenAI-compatible endpoint.
    openrouter_api_key: str = ""
    openrouter_api_base: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "z-ai/glm-4.6v"
    # 32k is GLM-4.6V's max_completion; a big brochure's JSON is ~20k tokens.
    openrouter_max_tokens: int = 32000
    # DPI for the images sent to GLM-4.6V. Lower than the 200 used for OCR to
    # keep the all-pages-in-one-request payload manageable while staying legible.
    openrouter_vision_dpi: int = 150

    # --- NuExtract (NuMind hosted structured-extraction platform) ---
    # Cloud API is async + project-based: a job is created under a
    # pre-configured structured-extraction PROJECT (whose template defines the
    # output schema), then polled for results. Requires the project id.
    nuextract_api_key: str = ""
    nuextract_api_base: str = "https://nuextract.ai/api"
    nuextract_project_id: str = ""

    # --- Reference enrichment (PubChem, deterministic — no LLM) ---
    # When True, products with a CAS number get authoritative reference data
    # (formula, IUPAC name, ...) attached to details, clearly labelled as NOT
    # coming from the brochure. Never affects dedup/identity.
    pubchem_enrichment: bool = True
    # When True, products with NO printed CAS but a recognizable chemical name
    # get a CAS resolved from the name via PubChem (confidence-gated), populated
    # into cas_number and marked as looked-up in details. Set False to only ever
    # show CAS numbers that were physically printed on the brochure.
    pubchem_cas_lookup: bool = True

    # --- Gemini ---
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # --- Qwen (OpenAI-compatible; the OCR engine for scanned PDFs, and an
    # optional extraction provider on its own) ---
    qwen_api_key: str = ""
    qwen_api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-vl-max"
    # Pages are OCR'd / extracted concurrently to cut wall-clock time (13
    # sequential vision calls was the main bottleneck). Higher = faster but more
    # likely to hit endpoint rate limits (429) which can drop pages/grades — 5
    # was reliable in benchmarks (full recall) while 8 dropped a page. 1 =
    # fully sequential.
    page_concurrency: int = 5

    # --- Reference extraction pipeline (app/pipeline/*) ---
    # The two-model pipeline: a Qwen VLM transcribes each page (stage 1) and a
    # Qwen text model turns that transcription into schema-constrained JSON
    # (stage 2). Both are served on the OpenAI-compatible Qwen endpoint above.
    # Stage-1 vision model (defaults to the same VLM used for OCR).
    qwen_vlm_model: str = "qwen-vl-max"
    # Stage-2 text model — the reference spec calls for "Qwen3 8B". Set this to
    # whatever your serving stack exposes (e.g. "qwen3-8b" on a local vLLM, or
    # "qwen-plus"/"qwen2.5-7b-instruct" on Dashscope).
    qwen_text_model: str = "qwen3-8b"
    # Constrained-decoding mechanism for stage 2. See pipeline/extraction.py:
    #   guided_json  → vLLM native guided decoding (true token-level constraint)
    #   json_schema  → OpenAI structured outputs
    #   json_object  → JSON-syntax only (Dashscope-safe fallback; schema still
    #                  enforced by Pydantic in stage 3)
    #   none         → send nothing special
    # Default to json_object so the shipped Dashscope config works out of the
    # box; switch to guided_json when serving via vLLM.
    pipeline_guided_decoding: str = "json_object"
    # max_tokens for both pipeline stages (brochures can be dense).
    pipeline_max_tokens: int = 8000

    # --- Two-stage page pipeline (services/page_extract.py) ---
    # The DB-worker extraction path: image -> markdown (stage 1), then
    # markdown -> JSON via forced tool-calling (stage 2). Only "qwen" (now) and
    # "claude" (production) are supported here — this is the one place the model
    # is chosen, per the pipeline design. Qwen for testing; flip to claude once a
    # funded Sonnet 5 key exists.
    page_extract_provider: str = "qwen"
    # Model used for stage 2 when page_extract_provider="claude". Sonnet 5 in
    # production (set via env once available); the config-level default is left
    # to claude_model below so nothing hard-codes an unfunded model.
    page_extract_claude_model: str = ""

    # --- Chat assistant (services/chat_agent.py) ---
    # Off by default: the chat endpoints 503 until this is switched on, so the
    # feature can ship dark and be enabled per-environment after testing.
    chat_enabled: bool = False
    # Which provider drives the agent loop. "anthropic" | "gpt" | "qwen".
    # ONE is active per deployment — this is not a fallback chain.
    #
    # There are only TWO loop implementations for these three options: Qwen's
    # DashScope endpoint is OpenAI-compatible (it is already driven through the
    # `openai` SDK for extraction), so "gpt" and "qwen" share one loop and
    # differ only by base URL / key / model. Anthropic needs its own because
    # its tool-use wire format is genuinely different.
    chat_provider: str = "anthropic"
    chat_anthropic_model: str = "claude-sonnet-5"
    chat_gpt_model: str = "gpt-4o-mini"
    # Qwen's text model (the VLM in qwen_model is for page extraction).
    chat_qwen_model: str = "qwen-plus"
    # Sonnet 5 defaults to "high" effort, which is more than a short-answer
    # chat needs. Anthropic-only; ignored by the OpenAI-compatible loop.
    chat_effort: str = "medium"
    # Hard cap on turns in one thread. At the cap the API refuses further
    # sends and the UI offers a new chat, rather than silently dropping the
    # oldest turns (which reads as the assistant "forgetting").
    chat_max_messages: int = 20
    # Rows handed back to the model per tool call. The real token cost is tool
    # results, not the messages — see the plan doc.
    chat_max_rows: int = 40
    # Safety valve on the agent loop: stop after this many tool round-trips
    # even if the model wants more.
    chat_max_tool_iterations: int = 6
    chat_rate_limit: str = "10/minute"
    # Idle sweep for the in-memory thread store. Threads are also destroyed
    # explicitly when the user closes the chat box.
    chat_ttl_minutes: int = 60

    # --- Semantic index (services/embeddings.py, P3) ---
    # Off by default, like the chat: with this false the assistant's
    # find_similar_chemicals tool degrades to a name match instead of failing,
    # and the worker skips the refresh entirely. Turning it on requires the
    # chemical_embeddings migration AND a backfill run.
    embeddings_enabled: bool = False
    # Anthropic has no embeddings API. Qwen's text-embedding-v3 runs on the
    # DashScope OpenAI-compatible endpoint already configured above (same key,
    # same base URL), so this adds no new provider account.
    # "qwen" | "openai".
    embedding_provider: str = "qwen"
    embedding_model: str = "text-embedding-v3"
    # MUST match the vector(N) width in the migration. Changing it means
    # rewriting the column and re-embedding everything — it is not a tuning
    # knob you can turn at runtime.
    embedding_dim: int = 1024
    # DashScope caps inputs per embeddings call; 10 is comfortably inside every
    # documented limit and keeps a failed batch cheap to retry.
    embedding_batch_size: int = 10
    # Neighbours returned by one find_similar_chemicals call, before the
    # purchasability filter drops any we cannot actually buy.
    embedding_match_count: int = 8
    # Cosine-similarity floor — a guard against a query that is far from the
    # whole catalog, NOT a relevance filter.
    #
    # MEASURED (2026-07-26, 324 indexed chemicals): every query lands in a
    # 0.55-0.66 band, including ones the catalog cannot serve — "food-grade
    # gelatin" scored 0.55-0.60 while a genuine epoxy-hardener match scored
    # 0.62. No threshold in that band separates a hit from a miss, and raising
    # this to try would start dropping real matches first. Relevance is
    # therefore enforced where it actually works: the evidence test in the
    # prompt and the "this is not a verdict" note on every result.
    embedding_min_similarity: float = 0.5

    # --- Behaviour / limits ---
    allowed_origin: str = "http://localhost:5173"
    max_upload_size_mb: int = 20
    # DPI used when the splitter renders PDF pages to PNGs for extraction.
    # Lower = smaller images, cheaper/faster calls, but small print (CAS digits)
    # degrades first. 200 is the measured-safe default; change it only against a
    # recall comparison on `test file/` (see ARCHITECTURE.md §6).
    split_dpi: int = 200
    claude_model: str = "claude-haiku-4-5-20251001"

    # Retry count for flaky external API calls (Claude, PubChem).
    api_max_retries: int = 3

    # --- Reconciler (app/reconciler.py) ---
    # How often the reconciler sweeps for stalled/failed work.
    reconciler_interval_seconds: int = 30
    # A document 'extracting' with no page progress (claimed_at heartbeat) older
    # than this is treated as owned by a dead worker and reset to claimable.
    # Keep it comfortably above the slowest single page so a live worker on a
    # long page is never mistaken for stalled.
    document_stale_seconds: int = 300
    # A page that has failed this many times is dead-lettered (surfaced in review
    # instead of retried forever).
    max_page_attempts: int = 3

    # Load from backend/.env during local development.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so the .env file is parsed only once."""
    return Settings()


def reload_settings() -> None:
    """Clear the cached Settings so the next access re-reads env + DB."""
    get_settings.cache_clear()


def get_effective(key: str) -> str | None:
    """
    Return the effective value of a setting: DB override first, then env var.
    Imported by services that need a single setting value at call time (not
    at import time).  The DB layer is imported lazily to avoid a circular
    import at module load (config -> database -> config).
    """
    try:
        from app.services.app_settings import get_raw
        db_val = get_raw(key)
        if db_val is not None and db_val != "":
            return db_val
    except Exception:
        pass
    return getattr(get_settings(), key, None)


settings = get_settings()
