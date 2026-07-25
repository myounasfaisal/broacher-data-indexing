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

    # --- Behaviour / limits ---
    allowed_origin: str = "http://localhost:5173"
    max_upload_size_mb: int = 20
    claude_model: str = "claude-haiku-4-5-20251001"

    # Retry count for flaky external API calls (Claude, PubChem).
    api_max_retries: int = 3

    # Load from backend/.env during local development.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Cached accessor so the .env file is parsed only once."""
    return Settings()


settings = get_settings()
