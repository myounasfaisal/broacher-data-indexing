/**
 * Plain-English label/description overrides for the settings page.
 *
 * The words that come back from the API (`label`, `description`) are stored
 * in the database and shared with things that are not this page — audit
 * logs, search results elsewhere — so they lean technical ("Extraction
 * provider", "Page extract provider"). Rather than rewrite that shared text,
 * this page swaps in friendlier copy for the keys a non-technical admin
 * actually looks at, and falls back to the API's own text for everything
 * else. Nothing here changes what gets saved — only what it reads like.
 */

export interface CopyOverride {
  label?: string;
  description?: string;
}

export const COPY_OVERRIDES: Record<string, CopyOverride> = {
  extraction_provider: {
    label: "Which AI reads your brochures",
    description:
      "Pick the AI that reads an uploaded brochure and pulls out the products, prices and CAS numbers.",
  },
  page_extract_provider: {
    label: "Which AI actually does the work",
    description:
      "Matches the choice above automatically. Only shown separately for the rare case where you want them different.",
  },
  search_provider: {
    label: "AI for search",
    description: "Leave on \"same as above\" unless you have a reason to split it out.",
  },
  chat_enabled: {
    label: "Turn the chat assistant on",
    description: "Lets people ask the assistant questions about the catalogue.",
  },
  chat_provider: {
    label: "Which AI runs the chat assistant",
    description: "Pick the AI that answers questions in the chat box.",
  },
  chat_effort: {
    label: "How much the assistant thinks before answering",
    description: "Higher takes longer but can give more thorough answers.",
  },
  chat_max_messages: {
    label: "Longest a conversation can run",
    description: "After this many messages, people have to start a new chat.",
  },
  chat_max_tool_iterations: {
    label: "How many lookups per question",
    description: "Caps how many times the assistant can search the catalogue while answering one question.",
  },
  chat_rate_limit: {
    label: "Messages per minute, per person",
    description: "Stops one person from overloading the assistant.",
  },
  claude_model: {
    label: "Claude version for reading brochures",
    description: "Sonnet is the balanced, recommended choice. Opus is more capable and slower; Haiku is fastest and cheapest.",
  },
  chat_anthropic_model: {
    label: "Claude version for the chat assistant",
    description: "Haiku is fast and cheap — usually the right choice for quick Q&A.",
  },
  openai_model: {
    label: "ChatGPT version",
    description: "The GPT model used when OpenAI is the chosen AI.",
  },
  chat_gpt_model: {
    label: "ChatGPT version for the chat assistant",
    description: "The GPT model used when OpenAI runs the chat assistant.",
  },
  gemini_model: {
    label: "Gemini version",
    description: "The Google Gemini model used when Gemini is the chosen AI.",
  },
  qwen_model: {
    label: "Qwen version",
    description: "The Qwen model used for reading brochures and images.",
  },
  page_concurrency: {
    label: "Pages read at once",
    description: "Higher is faster but more likely to hit the AI provider's speed limit.",
  },
  split_dpi: {
    label: "Image sharpness",
    description: "Higher looks sharper but costs more and is slower. Lower it only if brochures fail to process.",
  },
  pubchem_enrichment: {
    label: "Add extra chemical facts automatically",
    description: "Looks up formula and standard names for chemicals with a CAS number. Free, no AI involved.",
  },
  pubchem_cas_lookup: {
    label: "Guess CAS numbers from the chemical name",
    description: "Only used when a brochure doesn't print a CAS number itself.",
  },
  embeddings_enabled: {
    label: "Turn on \"find similar chemicals\"",
    description: "Lets the search and assistant suggest similar products, not just exact matches.",
  },
  embedding_provider: {
    label: "Which AI powers similarity search",
  },
  max_upload_size_mb: {
    label: "Largest file people can upload",
  },
};
