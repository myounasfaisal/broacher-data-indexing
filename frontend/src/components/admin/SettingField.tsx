import { useState } from "react";
import { Check, Eye, EyeOff, Loader2, Pencil, X } from "lucide-react";
import type { AppSetting } from "@/types/chemical";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CUSTOM_MODEL, EMPTY_MEANS, MODEL_OPTIONS } from "@/lib/modelCatalog";
import { cn } from "@/lib/utils";

/** Settings whose value is a boolean, rendered as a switch. */
const BOOLEAN_KEYS = new Set([
  "chat_enabled",
  "embeddings_enabled",
  "pubchem_enrichment",
  "pubchem_cas_lookup",
]);

/** Settings that take a number, rendered narrow with a stepper. */
const NUMBER_KEYS = new Set([
  "page_concurrency",
  "split_dpi",
  "max_upload_size_mb",
  "api_max_retries",
  "chat_max_messages",
  "chat_max_tool_iterations",
  "embedding_dim",
  "embedding_match_count",
  "embedding_min_similarity",
  "reconciler_interval_seconds",
  "document_stale_seconds",
  "max_page_attempts",
]);

/** Fixed vocabularies that are not model names. */
const CHOICE_KEYS: Record<string, { value: string; label: string }[]> = {
  extraction_provider: [
    { value: "qwen", label: "Qwen · vision OCR + extraction" },
    { value: "gpt", label: "OpenAI GPT · Qwen OCRs, GPT writes JSON" },
    { value: "gemini", label: "Google Gemini" },
    { value: "claude", label: "Anthropic Claude" },
  ],
  search_provider: [
    { value: "", label: "Same as extraction provider" },
    { value: "qwen", label: "Qwen" },
    { value: "gpt", label: "OpenAI GPT" },
    { value: "gemini", label: "Google Gemini" },
    { value: "claude", label: "Anthropic Claude" },
  ],
  page_extract_provider: [
    { value: "qwen", label: "Qwen · testing" },
    { value: "claude", label: "Claude · production" },
  ],
  chat_provider: [
    { value: "anthropic", label: "Anthropic" },
    { value: "gpt", label: "OpenAI GPT" },
    { value: "qwen", label: "Qwen" },
  ],
  chat_effort: [
    { value: "low", label: "Low · fastest, cheapest" },
    { value: "medium", label: "Medium · balanced" },
    { value: "high", label: "High · most thorough" },
  ],
  embedding_provider: [
    { value: "qwen", label: "Qwen · reuses the Dashscope key" },
    { value: "openai", label: "OpenAI" },
  ],
};

/** Secret keys that can be verified, mapped to the provider the test hits. */
export const TESTABLE_KEYS: Record<string, string> = {
  anthropic_api_key: "claude",
  openai_api_key: "openai",
  qwen_api_key: "qwen",
  gemini_api_key: "gemini",
  openrouter_api_key: "openrouter",
  nuextract_api_key: "nuextract",
};

export type TestState = { ok: boolean; message: string } | "pending" | undefined;

interface Props {
  setting: AppSetting;
  /** The pending edit for this key, or undefined when untouched. */
  draft: string | undefined;
  onChange: (value: string) => void;
  /** Drop the pending edit and fall back to the saved value. */
  onRevert: () => void;
  onTest?: () => void;
  testState: TestState;
}

export function SettingField({
  setting,
  draft,
  onChange,
  onRevert,
  onTest,
  testState,
}: Props) {
  const { key, label, description, is_secret } = setting;
  const dirty = draft !== undefined;
  const value = draft ?? setting.value;

  return (
    // Fixed padding, never `first:`/`last:` variants — each field is wrapped in
    // its own element by the caller, so those variants would match on every
    // field and collapse the padding to zero. That inverts proximity: helper
    // text ends up nearer the next field's label than its own input.
    <div className="py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={key} className="flex items-center gap-2">
          {label}
          {dirty && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
              title="Unsaved change"
              aria-label="Unsaved change"
            />
          )}
        </Label>
        {dirty && (
          <button
            type="button"
            onClick={onRevert}
            className="touch-target rounded-btn px-1 text-xs font-medium text-fg-subtle transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            Revert
          </button>
        )}
      </div>

      {description && (
        <p className="mt-1 max-w-[68ch] text-sm text-fg-muted">{description}</p>
      )}

      <div className="mt-3">
        {is_secret ? (
          <SecretInput
            id={key}
            draft={draft}
            savedMask={setting.value}
            onChange={onChange}
            onTest={onTest}
            testState={testState}
          />
        ) : BOOLEAN_KEYS.has(key) ? (
          <Switch
            id={key}
            checked={value === "true"}
            onChange={(next) => onChange(String(next))}
          />
        ) : MODEL_OPTIONS[key] ? (
          <ModelSelect id={key} value={value} onChange={onChange} />
        ) : CHOICE_KEYS[key] ? (
          <Select
            id={key}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="max-w-md"
          >
            {CHOICE_KEYS[key].map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={key}
            type={NUMBER_KEYS.has(key) ? "number" : "text"}
            step={key === "embedding_min_similarity" ? "0.01" : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={EMPTY_MEANS[key]}
            className={cn(
              NUMBER_KEYS.has(key) ? "max-w-[180px] font-mono" : "max-w-md",
            )}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Model picker: a native select over the curated list, with a "Custom…" branch
 * for anything not catalogued. A stored value outside the list opens directly
 * in custom mode — otherwise the select would render blank and quietly rewrite
 * a deliberate choice on the next save.
 */
function ModelSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = MODEL_OPTIONS[id] ?? [];
  const emptyLabel = EMPTY_MEANS[id];
  const known =
    (value === "" && emptyLabel !== undefined) ||
    options.some((o) => o.value === value);
  const [custom, setCustom] = useState(!known);

  if (custom) {
    return (
      <div className="flex max-w-md gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model identifier"
          className="flex-1 font-mono text-[13px]"
        />
        <Button
          variant="outline"
          size="default"
          onClick={() => {
            setCustom(false);
            if (!options.some((o) => o.value === value)) {
              onChange(emptyLabel !== undefined ? "" : options[0]?.value ?? "");
            }
          }}
          className="shrink-0"
          title="Back to the preset list"
        >
          <X className="h-4 w-4" aria-hidden />
          Presets
        </Button>
      </div>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => {
        if (e.target.value === CUSTOM_MODEL) {
          setCustom(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
      className="max-w-md"
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={CUSTOM_MODEL}>Custom…</option>
    </Select>
  );
}

/**
 * API-key field.
 *
 * The server only ever sends a masked key, so "reveal" cannot show the stored
 * secret — it reveals what you are *typing*. The input therefore starts empty
 * with the mask as placeholder, and blank means "keep the current key". That is
 * the honest reading of what the backend actually does with a masked value.
 */
function SecretInput({
  id,
  draft,
  savedMask,
  onChange,
  onTest,
  testState,
}: {
  id: string;
  draft: string | undefined;
  savedMask: string;
  onChange: (v: string) => void;
  onTest?: () => void;
  testState: TestState;
}) {
  const [reveal, setReveal] = useState(false);
  const configured = savedMask.length > 0;

  return (
    <div className="max-w-md space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={reveal ? "text" : "password"}
            value={draft ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={configured ? savedMask : "Not set"}
            autoComplete="off"
            spellCheck={false}
            className="pr-11 font-mono text-[13px]"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide what you typed" : "Show what you typed"}
            className="touch-target absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-btn text-fg-subtle transition-colors duration-150 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            {reveal ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
        {onTest && (
          <Button
            variant="outline"
            onClick={onTest}
            disabled={testState === "pending"}
            className="shrink-0"
          >
            {testState === "pending" ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Check className="h-4 w-4" aria-hidden />
            )}
            Test
          </Button>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        {configured ? (
          <>
            <Pencil className="h-3 w-3 shrink-0" aria-hidden />
            A key is saved. Type a new one to replace it, or leave blank to keep it.
          </>
        ) : (
          "No key saved yet."
        )}
      </p>

      {testState && testState !== "pending" && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 text-xs",
            testState.ok ? "text-ok-text" : "text-danger-text",
          )}
        >
          {testState.ok ? (
            <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <X className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          {testState.message}
        </p>
      )}
    </div>
  );
}

/** Accessible on/off switch. Labelled by the field's own <Label>. */
function Switch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "touch-target relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        checked ? "bg-brand" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm",
          "transition-transform duration-150 motion-reduce:transition-none",
          checked ? "translate-x-[23px]" : "translate-x-[3px]",
        )}
      />
      <span className="sr-only">{checked ? "On" : "Off"}</span>
    </button>
  );
}
