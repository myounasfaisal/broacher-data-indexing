import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Shield,
  Sliders,
  Zap,
  Key,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  AppSetting,
  SettingsCategory,
  SystemStatus,
} from "@/types/chemical";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, typeof Settings2> = {
  extraction: Zap,
  api_keys: Key,
  models: FlaskConical,
  chat: MessageSquare,
  embeddings: Search,
  enrichment: Activity,
  limits: Sliders,
  reconciler: RefreshCw,
};

const PROVIDER_OPTIONS = [
  { value: "qwen", label: "Qwen" },
  { value: "gpt", label: "OpenAI GPT" },
  { value: "gemini", label: "Google Gemini" },
  { value: "claude", label: "Anthropic Claude" },
];

const CHAT_PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "gpt", label: "OpenAI GPT" },
  { value: "qwen", label: "Qwen" },
];

const EMBEDDING_PROVIDER_OPTIONS = [
  { value: "qwen", label: "Qwen" },
  { value: "openai", label: "OpenAI" },
];

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const DROPDOWN_KEYS: Record<string, { value: string; label: string }[]> = {
  extraction_provider: PROVIDER_OPTIONS,
  search_provider: [{ value: "", label: "Same as extraction" }, ...PROVIDER_OPTIONS],
  page_extract_provider: [
    { value: "qwen", label: "Qwen" },
    { value: "claude", label: "Claude" },
  ],
  chat_provider: CHAT_PROVIDER_OPTIONS,
  chat_effort: EFFORT_OPTIONS,
  embedding_provider: EMBEDDING_PROVIDER_OPTIONS,
  pipeline_guided_decoding: [
    { value: "json_object", label: "JSON object (Dashscope-safe)" },
    { value: "guided_json", label: "Guided JSON (vLLM)" },
    { value: "json_schema", label: "JSON schema (OpenAI)" },
    { value: "none", label: "None" },
  ],
};

const BOOLEAN_KEYS = new Set([
  "chat_enabled",
  "embeddings_enabled",
  "pubchem_enrichment",
  "pubchem_cas_lookup",
]);

const NUMBER_KEYS = new Set([
  "page_concurrency",
  "split_dpi",
  "max_upload_size_mb",
  "api_max_retries",
  "chat_max_messages",
  "chat_max_tool_iterations",
  "embedding_dim",
  "embedding_match_count",
  "reconciler_interval_seconds",
  "document_stale_seconds",
  "max_page_attempts",
  "openrouter_max_tokens",
  "openrouter_vision_dpi",
  "embedding_batch_size",
  "pipeline_max_tokens",
  "chat_ttl_minutes",
]);

const KEY_PROVIDER_MAP: Record<string, string> = {
  anthropic_api_key: "claude",
  openai_api_key: "openai",
  qwen_api_key: "qwen",
  gemini_api_key: "gemini",
  openrouter_api_key: "openrouter",
  nuextract_api_key: "nuextract",
};

const BASE_URL_FOR_KEY: Record<string, string> = {
  anthropic_api_key: "",
  openai_api_key: "openai_api_base",
  qwen_api_key: "qwen_api_base",
  gemini_api_key: "",
  openrouter_api_key: "openrouter_api_base",
  nuextract_api_key: "nuextract_api_base",
};

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["adminSettings"],
    queryFn: api.getSettings,
  });

  const { data: status } = useQuery({
    queryKey: ["systemStatus"],
    queryFn: api.getSystemStatus,
  });

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["extraction", "api_keys"]));
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings) {
      const initial: Record<string, string> = {};
      for (const s of data.settings) {
        initial[s.key] = s.value;
      }
      setEdits(initial);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (changes: Record<string, string>) => api.updateSettings(changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSettings"] });
      queryClient.invalidateQueries({ queryKey: ["systemStatus"] });
      toast.success("Settings saved.");
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSavingCategory(null),
  });

  function handleChange(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  function toggleBool(key: string) {
    setEdits((prev) => ({
      ...prev,
      [key]: prev[key] === "true" ? "false" : "true",
    }));
  }

  function hasCategoryChanges(category: string): boolean {
    if (!data) return false;
    return data.settings
      .filter((s) => s.category === category)
      .some((s) => edits[s.key] !== undefined && edits[s.key] !== s.value);
  }

  function saveCategory(category: string) {
    if (!data) return;
    const changes: Record<string, string> = {};
    for (const s of data.settings.filter((s) => s.category === category)) {
      if (edits[s.key] !== undefined && edits[s.key] !== s.value) {
        changes[s.key] = edits[s.key];
      }
    }
    if (Object.keys(changes).length === 0) {
      toast.info("No changes to save.");
      return;
    }
    setSavingCategory(category);
    saveMutation.mutate(changes);
  }

  async function handleTestKey(settingKey: string) {
    const provider = KEY_PROVIDER_MAP[settingKey];
    if (!provider) return;
    const key = edits[settingKey] || "";
    const baseUrlKey = BASE_URL_FOR_KEY[settingKey];
    const base = baseUrlKey ? edits[baseUrlKey] || "" : "";

    setTestingKey(settingKey);
    try {
      const result = await api.testApiKey(provider, key, base);
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTestingKey(null);
    }
  }

  function toggleExpanded(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
      </div>
    );
  }

  const settingsByCategory: Record<string, AppSetting[]> = {};
  for (const s of data?.settings ?? []) {
    (settingsByCategory[s.category] ??= []).push(s);
  }

  const categories = data?.categories ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure API keys, models, and system behaviour. Changes take effect immediately."
      />

      {status && <StatusBar status={status} />}

      {categories.map((cat) => {
        const Icon = CATEGORY_ICONS[cat.key] ?? Settings2;
        const isOpen = expanded.has(cat.key);
        const settings = settingsByCategory[cat.key] ?? [];
        const hasChanges = hasCategoryChanges(cat.key);

        return (
          <Card key={cat.key}>
            <button
              type="button"
              onClick={() => toggleExpanded(cat.key)}
              className="flex w-full items-center gap-3 p-6 pb-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 rounded-t-card"
            >
              <Icon className="h-5 w-5 shrink-0 text-brand-text" aria-hidden />
              <CardTitle className="flex-1">{cat.label}</CardTitle>
              {hasChanges && (
                <span className="h-2 w-2 rounded-full bg-brand" title="Unsaved changes" />
              )}
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-fg-muted" />
              ) : (
                <ChevronRight className="h-4 w-4 text-fg-muted" />
              )}
            </button>

            {isOpen && (
              <CardContent className="space-y-5 border-t border-line">
                {settings.map((s) => (
                  <SettingField
                    key={s.key}
                    setting={s}
                    value={edits[s.key] ?? s.value}
                    onChange={(v) => handleChange(s.key, v)}
                    onToggle={() => toggleBool(s.key)}
                    revealed={revealedKeys.has(s.key)}
                    onToggleReveal={() =>
                      setRevealedKeys((prev) => {
                        const next = new Set(prev);
                        next.has(s.key) ? next.delete(s.key) : next.add(s.key);
                        return next;
                      })
                    }
                    onTestKey={
                      KEY_PROVIDER_MAP[s.key]
                        ? () => handleTestKey(s.key)
                        : undefined
                    }
                    testing={testingKey === s.key}
                  />
                ))}

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={() => saveCategory(cat.key)}
                    disabled={!hasChanges || savingCategory === cat.key}
                  >
                    {savingCategory === cat.key ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" aria-hidden />
                        Save {cat.label.toLowerCase()}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SettingField({
  setting,
  value,
  onChange,
  onToggle,
  revealed,
  onToggleReveal,
  onTestKey,
  testing,
}: {
  setting: AppSetting;
  value: string;
  onChange: (v: string) => void;
  onToggle: () => void;
  revealed: boolean;
  onToggleReveal: () => void;
  onTestKey?: () => void;
  testing: boolean;
}) {
  const isBoolean = BOOLEAN_KEYS.has(setting.key);
  const isNumber = NUMBER_KEYS.has(setting.key);
  const dropdownOptions = DROPDOWN_KEYS[setting.key];
  const isOn = value === "true";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={setting.key}>{setting.label}</Label>
        {setting.is_secret && onTestKey && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onTestKey}
            disabled={testing}
            className="text-xs"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Shield className="h-3.5 w-3.5" aria-hidden />
            )}
            Test connection
          </Button>
        )}
      </div>

      {isBoolean ? (
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          onClick={onToggle}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
            isOn ? "bg-brand" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
              isOn ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      ) : dropdownOptions ? (
        <Select
          id={setting.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {dropdownOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      ) : setting.is_secret ? (
        <div className="flex gap-2">
          <Input
            id={setting.key}
            type={revealed ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter key…"
            className="flex-1 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleReveal}
            className="shrink-0 px-2"
            title={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <Input
          id={setting.key}
          type={isNumber ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={isNumber ? "max-w-[160px]" : ""}
        />
      )}

      {setting.description && (
        <p className="text-xs text-fg-muted">{setting.description}</p>
      )}
    </div>
  );
}

function StatusBar({ status }: { status: SystemStatus }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatusChip
        label="Extraction"
        value={status.extraction_provider.toUpperCase()}
        tone="brand"
      />
      <StatusChip
        label="Listings"
        value={status.total_listings.toLocaleString()}
      />
      <StatusChip
        label="Chat"
        value={status.chat_enabled ? "ON" : "OFF"}
        tone={status.chat_enabled ? "green" : "muted"}
      />
      <StatusChip
        label="Embeddings"
        value={
          status.embeddings_enabled
            ? `${status.embeddings_indexed.toLocaleString()} indexed`
            : "OFF"
        }
        tone={status.embeddings_enabled ? "green" : "muted"}
      />
    </div>
  );
}

function StatusChip({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "brand" | "green" | "muted" | "default";
}) {
  const colors = {
    brand: "border-brand/30 bg-brand-soft text-brand-soft-text",
    green:
      "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
    muted: "border-line bg-muted text-fg-muted",
    default: "border-line bg-surface text-fg",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-card border px-4 py-3",
        colors[tone],
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wider opacity-70">
        {label}
      </span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
