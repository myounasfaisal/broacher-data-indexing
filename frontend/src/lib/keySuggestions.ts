/**
 * Plain-English hints for the "Add API key" dialog.
 *
 * The backend's test-key endpoint already returns a good message for most
 * failures (it even knows about Qwen's two-region key mismatch). This file
 * adds two things the backend can't: a format sanity check BEFORE the network
 * call (so a pasted key with a trailing newline fails instantly, not after a
 * round trip), and a plain-language nudge layered on top of a failed test's
 * raw message, for the handful of mistakes that are common and fixable.
 */

export interface KeyShape {
  /** What a real key looks like, shown as placeholder/help text. */
  prefix?: string;
  example: string;
}

export const KEY_SHAPES: Record<string, KeyShape> = {
  anthropic: { prefix: "sk-ant-", example: "sk-ant-api03-…" },
  openai: { prefix: "sk-", example: "sk-…" },
  openrouter: { prefix: "sk-or-", example: "sk-or-v1-…" },
  gemini: { example: "AIza…" },
  qwen: { example: "a DashScope key (no fixed prefix)" },
  nuextract: { example: "your NuExtract project key" },
};

/** Catches the obviously-wrong pastes before spending a network round trip. */
export function checkKeyFormat(providerId: string, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "Paste a key first.";
  if (trimmed !== key) {
    return "There's extra space or a line break around this key — remove it and try again.";
  }
  if (/\s/.test(trimmed)) {
    return "This key has a space in the middle — keys are one unbroken string, so it was probably cut off when copying.";
  }
  const shape = KEY_SHAPES[providerId];
  if (shape?.prefix && !trimmed.startsWith(shape.prefix)) {
    return `${shapeProviderName(providerId)} keys usually start with "${shape.prefix}" — double-check you copied the right key.`;
  }
  return null;
}

/** A plain-language nudge to add under a failed test result, if one applies. */
export function suggestFix(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("401") || m.includes("invalid")) {
    return "Double-check you copied the whole key, with nothing missing from either end.";
  }
  if (m.includes("timed out") || m.includes("timeout")) {
    return "The request didn't get a response in time — check your internet connection and try again.";
  }
  if (m.includes("404")) {
    return "That address didn't respond — if you set a custom endpoint, check it's typed correctly.";
  }
  if (m.includes("429")) {
    return "The account has hit its rate or quota limit — wait a moment, or check billing on the provider's site.";
  }
  return null;
}

function shapeProviderName(id: string): string {
  const names: Record<string, string> = {
    anthropic: "Claude",
    openai: "ChatGPT",
    openrouter: "OpenRouter",
    gemini: "Gemini",
    qwen: "Qwen",
    nuextract: "NuExtract",
  };
  return names[id] ?? id;
}
