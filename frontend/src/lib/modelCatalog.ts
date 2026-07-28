/**
 * Curated model lists for the settings page dropdowns.
 *
 * A settings page that asks an admin to type `claude-haiku-4-5-20251001` from
 * memory is a settings page that gets typos saved to production. Each provider
 * gets a short list of the models we actually support, and every list keeps a
 * "Custom…" escape so a value we haven't catalogued yet is still expressible —
 * without that, a stored model outside the list would render as a blank select
 * and be silently reset on the next save.
 */

export interface ModelOption {
  value: string;
  /** Shown in the native <option>. Kept to one line — no rich content. */
  label: string;
}

/** Sentinel for the "type it yourself" branch. Never persisted. */
export const CUSTOM_MODEL = "__custom__";

// --- Anthropic -----------------------------------------------------------
// Aliases only, never date-suffixed IDs: the alias always resolves to the
// current snapshot, a pinned date eventually 404s.
const CLAUDE_MODELS: ModelOption[] = [
  { value: "claude-opus-5", label: "Claude Opus 5 · most capable" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 · balanced" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 · fastest, cheapest" },
];

// --- OpenAI --------------------------------------------------------------
const OPENAI_MODELS: ModelOption[] = [
  { value: "gpt-4o", label: "GPT-4o · vision + text" },
  { value: "gpt-4o-mini", label: "GPT-4o mini · cheapest" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

// --- Qwen (Dashscope) ----------------------------------------------------
// Split by modality: stage 1 needs a VLM, stage 2 a text model. Offering the
// full list on both invites picking a text model for the OCR pass, which fails
// at request time rather than at save time.
const QWEN_VISION_MODELS: ModelOption[] = [
  { value: "qwen-vl-max", label: "Qwen VL Max · best OCR accuracy" },
  { value: "qwen-vl-plus", label: "Qwen VL Plus · cheaper" },
];

const QWEN_TEXT_MODELS: ModelOption[] = [
  { value: "qwen-plus", label: "Qwen Plus · balanced" },
  { value: "qwen-max", label: "Qwen Max · most capable" },
  { value: "qwen-turbo", label: "Qwen Turbo · fastest" },
  { value: "qwen3-8b", label: "Qwen3 8B · self-hosted vLLM" },
];

// --- Google --------------------------------------------------------------
const GEMINI_MODELS: ModelOption[] = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash · fast" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro · most capable" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

// --- OpenRouter ----------------------------------------------------------
const OPENROUTER_MODELS: ModelOption[] = [
  { value: "z-ai/glm-4.6v", label: "GLM-4.6V · vision, one-shot extraction" },
  { value: "z-ai/glm-4.6", label: "GLM-4.6 · text only" },
];

// --- Embeddings ----------------------------------------------------------
const EMBEDDING_MODELS: ModelOption[] = [
  { value: "text-embedding-v3", label: "Qwen text-embedding-v3 · 1024 dim" },
  { value: "text-embedding-3-small", label: "OpenAI 3-small · 1536 dim" },
  { value: "text-embedding-3-large", label: "OpenAI 3-large · 3072 dim" },
];

/**
 * Setting key -> the models valid for it. A key absent from this map renders
 * as a plain text field.
 */
export const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  claude_model: CLAUDE_MODELS,
  chat_anthropic_model: CLAUDE_MODELS,
  page_extract_claude_model: CLAUDE_MODELS,
  openai_model: OPENAI_MODELS,
  chat_gpt_model: OPENAI_MODELS,
  qwen_model: QWEN_VISION_MODELS,
  qwen_vlm_model: QWEN_VISION_MODELS,
  qwen_text_model: QWEN_TEXT_MODELS,
  chat_qwen_model: QWEN_TEXT_MODELS,
  gemini_model: GEMINI_MODELS,
  openrouter_model: OPENROUTER_MODELS,
  embedding_model: EMBEDDING_MODELS,
};

/**
 * Keys where an empty value is a real choice rather than "unset", with the
 * label that says so. Without this the admin has to know that blank means
 * "inherit" — which is exactly the kind of folklore a settings page exists to
 * remove.
 */
export const EMPTY_MEANS: Record<string, string> = {
  page_extract_claude_model: "Same as the extraction Claude model",
  search_provider: "Same as the extraction provider",
  openai_api_base: "OpenAI (api.openai.com)",
};
