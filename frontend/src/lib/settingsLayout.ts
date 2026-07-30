/**
 * What each Settings section contains, and how a provider choice reshapes it.
 *
 * The problem this file solves: three of the four things an admin configures
 * here — extraction, chat, semantic search — are the same decision in three
 * places. Pick a provider, give it a key, choose its model. The old page split
 * those three steps across three sections organised by data *type* ("API
 * Keys", "Models", "Extraction Pipeline"), so configuring one provider meant
 * visiting three sections and knowing, unprompted, that the other two existed.
 *
 * Here a section is a task. It names its provider setting; the provider's
 * current value then selects which key and which model row to show. Six key
 * fields collapse to the one in use, and "which of these do I need?" stops
 * being a question the admin has to answer.
 *
 * Keys are shared on purpose — `qwen_api_key` drives extraction, chat and
 * embeddings — so the same underlying row renders in each section that uses
 * it, with a note saying so. Editing it in one place edits it everywhere,
 * which is the truth of it; hiding that behind three separate-looking fields
 * would be the lie.
 */

/** A provider account: its secret, its endpoint, and how to test it. */
export interface ProviderSpec {
  label: string;
  /** Setting key holding the secret. */
  keyKey: string;
  /** Setting key holding the endpoint override, when the provider has one. */
  baseKey?: string;
  /** Extra rows this provider needs before it can run at all. */
  extraKeys?: string[];
  /** `provider` value the POST /test-key endpoint expects. */
  testAs: string;
  /** Where to get the key, shown under the empty field. */
  console: { label: string; href: string };
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  anthropic: {
    label: "Claude (Anthropic)",
    keyKey: "anthropic_api_key",
    testAs: "claude",
    console: {
      label: "console.anthropic.com",
      href: "https://console.anthropic.com/settings/keys",
    },
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    keyKey: "openai_api_key",
    baseKey: "openai_api_base",
    testAs: "openai",
    console: {
      label: "platform.openai.com",
      href: "https://platform.openai.com/api-keys",
    },
  },
  gemini: {
    label: "Gemini (Google)",
    keyKey: "gemini_api_key",
    testAs: "gemini",
    console: { label: "ai.google.dev", href: "https://aistudio.google.com/apikey" },
  },
  qwen: {
    label: "Qwen (Alibaba DashScope)",
    keyKey: "qwen_api_key",
    baseKey: "qwen_api_base",
    testAs: "qwen",
    console: {
      label: "DashScope console",
      href: "https://dashscope.console.aliyun.com/apiKey",
    },
  },
  openrouter: {
    label: "GLM-4.6V (via OpenRouter)",
    keyKey: "openrouter_api_key",
    baseKey: "openrouter_api_base",
    testAs: "openrouter",
    console: { label: "openrouter.ai", href: "https://openrouter.ai/keys" },
  },
  nuextract: {
    label: "NuExtract (hosted service)",
    keyKey: "nuextract_api_key",
    baseKey: "nuextract_api_base",
    // Without the project ID a NuExtract job cannot be created at all, so it
    // sits with the key rather than in an "advanced" fold.
    extraKeys: ["nuextract_project_id"],
    testAs: "nuextract",
    console: { label: "nuextract.ai", href: "https://nuextract.ai" },
  },
};

/**
 * Which section a provider choice belongs to, and what it pulls in.
 *
 * `providerValues` maps the value stored in the provider setting to a
 * `PROVIDERS` entry — they are not the same vocabulary. The extraction
 * provider stores "gpt" and "claude" where chat stores "gpt" and "anthropic",
 * and the backend's alias table accepts both; the map absorbs that rather than
 * a migration renaming values that .env files in the wild already use.
 *
 * `modelFor` names the model row to show for the chosen provider. Absent
 * (NuExtract) means the provider has no model to choose.
 */
export interface ProviderBinding {
  /** Setting key holding the provider choice. */
  setting: string;
  providerValues: Record<string, string>;
  modelFor: Record<string, string | string[]>;
}

export interface SectionSpec {
  key: string;
  title: string;
  /** One line saying what the section decides. */
  blurb: string;
  /** Rendered first, above the provider block — usually the on/off switch. */
  leadKeys?: string[];
  provider?: ProviderBinding;
  /** Rendered after the provider block. */
  tailKeys: string[];
  /** Set-once rows, folded behind a disclosure. */
  advancedKeys?: string[];
}

export const SECTIONS: SectionSpec[] = [
  {
    key: "extraction",
    title: "Reading brochures",
    blurb: "The AI that reads an uploaded brochure and pulls out the products.",
    provider: {
      setting: "extraction_provider",
      providerValues: {
        claude: "anthropic",
        gpt: "openai",
        gemini: "gemini",
        qwen: "qwen",
        glm: "openrouter",
        nuextract: "nuextract",
      },
      modelFor: {
        claude: "claude_model",
        gpt: "openai_model",
        gemini: "gemini_model",
        qwen: "qwen_model",
        glm: "openrouter_model",
        // NuExtract runs a hosted project, not a model you name here.
      },
    },
    tailKeys: [
      "page_concurrency",
      "split_dpi",
      "pubchem_enrichment",
      "pubchem_cas_lookup",
    ],
    advancedKeys: [
      "page_extract_provider",
      "qwen_vlm_model",
      "qwen_text_model",
      "page_extract_claude_model",
      "search_provider",
    ],
  },
  {
    key: "chat",
    title: "Chat assistant",
    blurb: "The assistant people can chat with to ask about the catalogue. Off until you turn it on.",
    leadKeys: ["chat_enabled"],
    provider: {
      setting: "chat_provider",
      providerValues: { anthropic: "anthropic", gpt: "openai", qwen: "qwen" },
      modelFor: {
        anthropic: "chat_anthropic_model",
        gpt: "chat_gpt_model",
        qwen: "chat_qwen_model",
      },
    },
    tailKeys: [
      "chat_effort",
      "chat_max_messages",
      "chat_max_tool_iterations",
      "chat_rate_limit",
    ],
  },
  {
    key: "search",
    title: "“Find similar” search",
    blurb:
      "Lets search suggest similar chemicals, not just exact matches. Needs a one-time setup run after you enable it.",
    leadKeys: ["embeddings_enabled"],
    provider: {
      setting: "embedding_provider",
      providerValues: { qwen: "qwen", openai: "openai" },
      modelFor: { qwen: "embedding_model", openai: "embedding_model" },
    },
    tailKeys: ["embedding_match_count", "embedding_min_similarity"],
    advancedKeys: ["embedding_dim"],
  },
  {
    key: "system",
    title: "System",
    blurb: "Upload limits and background cleanup. Set once, rarely touched.",
    tailKeys: [
      "max_upload_size_mb",
      "api_max_retries",
      "reconciler_interval_seconds",
      "document_stale_seconds",
      "max_page_attempts",
    ],
    advancedKeys: ["allowed_origin"],
  },
];

/**
 * Every section that uses a given provider account, so a shared key can say
 * where else it applies. Derived rather than hand-written: a section added
 * above must not be able to fall out of this list silently.
 */
export function sectionsUsingProvider(providerId: string): string[] {
  return SECTIONS.filter((s) => {
    if (!s.provider) return false;
    return Object.values(s.provider.providerValues).includes(providerId);
  }).map((s) => s.title);
}

/** The `PROVIDERS` entry a section is currently pointed at, if any. */
export function activeProvider(
  section: SectionSpec,
  value: string,
): { id: string; spec: ProviderSpec } | null {
  if (!section.provider) return null;
  const id = section.provider.providerValues[value];
  const spec = id ? PROVIDERS[id] : undefined;
  return spec ? { id, spec } : null;
}

/** The model setting key for a section's current provider value, if it has one. */
export function modelKeyFor(
  section: SectionSpec,
  value: string,
): string | undefined {
  const m = section.provider?.modelFor[value];
  return Array.isArray(m) ? m[0] : m;
}
