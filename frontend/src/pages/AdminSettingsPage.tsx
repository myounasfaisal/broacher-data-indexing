import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ChevronRight,
  KeyRound,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AppSetting, SettingsCategory } from "@/types/chemical";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  SettingField,
  TESTABLE_KEYS,
  type TestState,
} from "@/components/admin/SettingField";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  extraction: Zap,
  api_keys: KeyRound,
  models: Sparkles,
  chat: MessageSquare,
  embeddings: Search,
  enrichment: Activity,
  limits: Sliders,
  reconciler: RefreshCw,
};

/**
 * Set-once infrastructure values — endpoint URLs, the vector width that has to
 * match the migration. They belong on the page (an admin pointing Qwen at a
 * local vLLM needs them) but not in the reading path, where they doubled the
 * length of API Keys with fields nobody touches after setup.
 */
const ADVANCED_KEYS = new Set([
  "openai_api_base",
  "qwen_api_base",
  "openrouter_api_base",
  "nuextract_api_base",
  "nuextract_project_id",
  "embedding_dim",
  "allowed_origin",
]);

/**
 * Admin settings.
 *
 * Forty-six settings in one scroll is a list, not an interface — so the page is
 * a rail plus one visible section, the shape every settings surface the admin
 * already uses has taught them. Two rules carry the rest:
 *
 * - **Edits are a sparse diff, not a mirror.** State holds only the keys the
 *   admin actually changed, so a background refetch can never clobber typing,
 *   the dirty check is `Object.keys(edits).length`, and the save payload is
 *   exactly what changed. Mirroring every setting into state and diffing it
 *   back out is the version of this that loses work.
 * - **One save, not eight.** Changes are found by search as easily as by
 *   section, so a per-section button would strand edits behind a section the
 *   admin has already navigated away from. The rail marks which sections are
 *   dirty; the bar saves all of them.
 */
export default function AdminSettingsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["adminSettings"],
    queryFn: api.getSettings,
    staleTime: 30_000,
  });

  const { data: status } = useQuery({
    queryKey: ["systemStatus"],
    queryFn: api.getSystemStatus,
    staleTime: 30_000,
  });

  /** Only the keys the admin has actually changed. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>("extraction");
  const [query, setQuery] = useState("");
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const settings = data?.settings ?? [];
  const categories = data?.categories ?? [];
  const dirtyCount = Object.keys(edits).length;

  const byCategory = useMemo(() => {
    const map: Record<string, AppSetting[]> = {};
    for (const s of settings) (map[s.category] ??= []).push(s);
    return map;
  }, [settings]);

  /** Sections carrying unsaved edits — drives the rail's dots. */
  const dirtyCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of settings) if (s.key in edits) set.add(s.category);
    return set;
  }, [settings, edits]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return settings.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [settings, q]);

  const save = useMutation({
    mutationFn: () => api.updateSettings(edits),
    onSuccess: () => {
      const n = dirtyCount;
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["adminSettings"] });
      queryClient.invalidateQueries({ queryKey: ["systemStatus"] });
      toast.success(`Saved ${n} change${n === 1 ? "" : "s"}.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function setValue(setting: AppSetting, next: string) {
    setEdits((prev) => {
      // Typing a value back to what's stored isn't a change — drop the entry so
      // the dirty count stays truthful. Secrets are exempt: their stored value
      // is a mask, so equality there would mean "typed the mask", not "unchanged".
      if (!setting.is_secret && next === setting.value) {
        const { [setting.key]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [setting.key]: next };
    });
  }

  function revert(key: string) {
    setEdits((prev) => {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  }

  async function runTest(key: string) {
    const provider = TESTABLE_KEYS[key];
    if (!provider) return;
    setTests((t) => ({ ...t, [key]: "pending" }));
    try {
      // An empty draft means "test the key already saved" — the backend falls
      // back to the stored value, since the browser never holds the real one.
      const result = await api.testApiKey(provider, edits[key] ?? "");
      setTests((t) => ({ ...t, [key]: result }));
    } catch (err) {
      setTests((t) => ({
        ...t,
        [key]: {
          ok: false,
          message: err instanceof Error ? err.message : "Test failed",
        },
      }));
    }
  }

  const visible = matches ?? byCategory[active] ?? [];
  const primary = visible.filter((s) => !ADVANCED_KEYS.has(s.key));
  const advanced = visible.filter((s) => ADVANCED_KEYS.has(s.key));
  // A hidden edit that the save bar counts but the admin can't see is a trap —
  // the disclosure carries its own dot when one is in there.
  const advancedDirty = advanced.filter((s) => s.key in edits).length;
  const activeLabel =
    categories.find((c) => c.key === active)?.label ?? "Settings";

  return (
    <div className={cn(dirtyCount > 0 && "pb-24")}>
      <PageHeader
        title="Settings"
        description="API keys, models, and pipeline behaviour. Changes apply as soon as you save — no restart."
        actions={
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all settings…"
              aria-label="Search settings"
              className="pl-9"
            />
          </div>
        }
      />

      {status && <StatusStrip status={status} />}

      {isError && (
        <p role="alert" className="mt-6 text-sm text-danger-text">
          Couldn&rsquo;t load settings. Check that the backend is running and
          you&rsquo;re signed in as an admin.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-8">
        {/* Section rail — a horizontal strip on small screens. */}
        <nav
          aria-label="Settings sections"
          className={cn(
            "-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0",
            "lg:sticky lg:top-6 lg:self-start",
            q && "pointer-events-none opacity-40",
          )}
          aria-hidden={q ? true : undefined}
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-32 shrink-0 lg:w-full" />
              ))
            : categories.map((c) => (
                <RailItem
                  key={c.key}
                  category={c}
                  icon={CATEGORY_ICONS[c.key] ?? Settings2}
                  active={!q && c.key === active}
                  dirty={dirtyCategories.has(c.key)}
                  onSelect={() => setActive(c.key)}
                />
              ))}
        </nav>

        {/* Content pane. One section, or flat search results. */}
        <section
          aria-busy={isLoading}
          className="min-w-0 rounded-card border border-line bg-surface px-5 py-5 sm:px-6"
        >
          {isLoading ? (
            <FieldsSkeleton />
          ) : (
            <>
              <h2 className="text-[15px] font-medium tracking-tight text-fg">
                {q
                  ? `${visible.length} setting${visible.length === 1 ? "" : "s"} matching “${query.trim()}”`
                  : activeLabel}
              </h2>

              {visible.length === 0 ? (
                <p className="mt-6 text-sm text-fg-muted">
                  Nothing matches that. Try a provider name (
                  <span className="text-fg">qwen</span>,{" "}
                  <span className="text-fg">claude</span>) or a word from the
                  setting you want, like{" "}
                  <span className="text-fg">concurrency</span>.
                </p>
              ) : (
                <>
                  <FieldList
                    fields={primary}
                    showCategory={Boolean(q)}
                    categories={categories}
                    edits={edits}
                    onChange={setValue}
                    onRevert={revert}
                    onTest={runTest}
                    tests={tests}
                  />

                  {advanced.length > 0 && (
                    <div className="border-t border-line pt-4">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        aria-expanded={showAdvanced}
                        className="touch-target flex items-center gap-1.5 rounded-btn text-sm font-medium text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                      >
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 transition-transform duration-150 motion-reduce:transition-none",
                            showAdvanced && "rotate-90",
                          )}
                          aria-hidden
                        />
                        {showAdvanced ? "Hide" : "Show"} endpoints &amp; advanced
                        <span className="font-normal text-fg-subtle">
                          ({advanced.length})
                        </span>
                        {advancedDirty > 0 && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-brand"
                            aria-label={`${advancedDirty} unsaved`}
                          />
                        )}
                      </button>

                      {showAdvanced && (
                        <FieldList
                          fields={advanced}
                          showCategory={Boolean(q)}
                          categories={categories}
                          edits={edits}
                          onChange={setValue}
                          onRevert={revert}
                          onTest={runTest}
                          tests={tests}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {dirtyCount > 0 && (
        <SaveBar
          count={dirtyCount}
          saving={save.isPending}
          onSave={() => save.mutate()}
          onDiscard={() => setEdits({})}
        />
      )}
    </div>
  );
}

function FieldList({
  fields,
  showCategory,
  categories,
  edits,
  onChange,
  onRevert,
  onTest,
  tests,
}: {
  fields: AppSetting[];
  showCategory: boolean;
  categories: SettingsCategory[];
  edits: Record<string, string>;
  onChange: (setting: AppSetting, value: string) => void;
  onRevert: (key: string) => void;
  onTest: (key: string) => void;
  tests: Record<string, TestState>;
}) {
  return (
    <div className="divide-y divide-line">
      {fields.map((s, i) => (
        <div key={s.key}>
          {/* Only where the section changes — repeating it on every row of a
              run turns a wayfinding cue into noise. */}
          {showCategory && s.category !== fields[i - 1]?.category && (
            <p className="pt-6 text-xs font-medium text-fg-subtle">
              {categories.find((c) => c.key === s.category)?.label}
            </p>
          )}
          <SettingField
            setting={s}
            draft={edits[s.key]}
            onChange={(v) => onChange(s, v)}
            onRevert={() => onRevert(s.key)}
            onTest={TESTABLE_KEYS[s.key] ? () => onTest(s.key) : undefined}
            testState={tests[s.key]}
          />
        </div>
      ))}
    </div>
  );
}

function RailItem({
  category,
  icon: Icon,
  active,
  dirty,
  onSelect,
}: {
  category: SettingsCategory;
  icon: LucideIcon;
  active: boolean;
  dirty: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex shrink-0 items-center gap-2.5 rounded-btn px-3 py-2 text-left text-sm",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        "lg:w-full lg:shrink",
        active
          ? "bg-brand-soft font-medium text-brand-soft-text"
          : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="truncate">{category.label}</span>
      {dirty && (
        <span
          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
          aria-label="has unsaved changes"
        />
      )}
    </button>
  );
}

/**
 * Operational context for the decisions on this page — the indexed-chemical
 * count is what tells you whether turning embeddings on will do anything. It
 * deliberately excludes anything that merely restates a setting below.
 */
function StatusStrip({
  status,
}: {
  status: {
    total_listings: number;
    total_chemicals: number;
    embeddings_indexed: number;
    documents_processing: number;
  };
}) {
  const items = [
    { label: "Listings", value: status.total_listings },
    { label: "Chemicals", value: status.total_chemicals },
    { label: "Embeddings indexed", value: status.embeddings_indexed },
    { label: "Processing now", value: status.documents_processing },
  ];
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line bg-surface px-4 py-3">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-2">
          <dt className="text-xs text-fg-subtle">{i.label}</dt>
          <dd className="font-mono text-[13px] tabular-nums text-fg">
            {i.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SaveBar({
  count,
  saving,
  onSave,
  onDiscard,
}: {
  count: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line glass-strong lg:pl-64">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <p role="status" className="mr-auto text-sm text-fg">
          <span className="font-medium">{count}</span> unsaved change
          {count === 1 ? "" : "s"}
        </p>
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? (
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/** Sized to the fields it replaces, so nothing shifts when data lands. */
function FieldsSkeleton() {
  return (
    <div aria-hidden className="space-y-8">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2.5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-full max-w-[52ch]" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}
