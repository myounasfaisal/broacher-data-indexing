import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Settings2,
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
import {
  SECTIONS,
  activeProvider,
  modelKeyFor,
  sectionsUsingProvider,
  type SectionSpec,
} from "@/lib/settingsLayout";
import { cn } from "@/lib/utils";

const SECTION_ICONS: Record<string, LucideIcon> = {
  extraction: Zap,
  chat: MessageSquare,
  search: Sparkles,
  system: RefreshCw,
};

/**
 * Admin settings.
 *
 * Four sections, each one complete decision. The old page had eight, split by
 * what a setting *is* rather than what it configures — so switching extraction
 * to Claude meant visiting "Extraction" for the provider, "API Keys" for the
 * key and "Models" for the model, with nothing saying the last two existed.
 * Here the provider choice reshapes its own section: pick Claude and the
 * Anthropic key and Claude model appear directly beneath it, and the five keys
 * you are not using stay out of the way.
 *
 * Two rules carry the rest:
 *
 * - **Edits are a sparse diff, not a mirror.** State holds only the keys the
 *   admin actually changed, so a background refetch can never clobber typing,
 *   the dirty check is `Object.keys(edits).length`, and the save payload is
 *   exactly what changed. Mirroring every setting into state and diffing it
 *   back out is the version of this that loses work.
 * - **One save, not four.** Changes are found by search as easily as by
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

  const settings = data?.settings ?? [];
  const categories = data?.categories ?? [];
  const dirtyCount = Object.keys(edits).length;

  const byKey = useMemo(() => {
    const map: Record<string, AppSetting> = {};
    for (const s of settings) map[s.key] = s;
    return map;
  }, [settings]);

  /** Effective value of a key: the pending edit if there is one, else stored. */
  function valueOf(key: string): string {
    return edits[key] ?? byKey[key]?.value ?? "";
  }

  /**
   * Every setting a section can show, including the provider branches it is
   * not currently on. Used for the rail's dirty dots: an edit to the OpenAI
   * key made before switching the provider to Qwen still belongs to this
   * section and still needs saving, so the dot has to survive the switch.
   */
  const sectionKeys = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const s of SECTIONS) {
      const keys = new Set<string>([
        ...(s.leadKeys ?? []),
        ...s.tailKeys,
        ...(s.advancedKeys ?? []),
      ]);
      if (s.provider) {
        keys.add(s.provider.setting);
        for (const value of Object.keys(s.provider.providerValues)) {
          const prov = activeProvider(s, value);
          if (prov) {
            keys.add(prov.spec.keyKey);
            if (prov.spec.baseKey) keys.add(prov.spec.baseKey);
            for (const k of prov.spec.extraKeys ?? []) keys.add(k);
          }
          const model = modelKeyFor(s, value);
          if (model) keys.add(model);
        }
      }
      map[s.key] = keys;
    }
    return map;
  }, []);

  const dirtySections = useMemo(() => {
    const set = new Set<string>();
    for (const s of SECTIONS) {
      for (const k of Object.keys(edits)) {
        if (sectionKeys[s.key].has(k)) {
          set.add(s.key);
          break;
        }
      }
    }
    return set;
  }, [edits, sectionKeys]);

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

  const activeSection = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];

  const fieldProps = {
    edits,
    onChange: setValue,
    onRevert: revert,
    onTest: runTest,
    tests,
  };

  return (
    <div className={cn(dirtyCount > 0 && "pb-24")}>
      <PageHeader
        title="Settings"
        description="Providers, keys, and pipeline behaviour. Changes apply as soon as you save — no restart."
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
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-32 shrink-0 lg:w-full" />
              ))
            : SECTIONS.map((s) => (
                <RailItem
                  key={s.key}
                  label={s.title}
                  icon={SECTION_ICONS[s.key] ?? Settings2}
                  active={!q && s.key === active}
                  dirty={dirtySections.has(s.key)}
                  onSelect={() => setActive(s.key)}
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
          ) : q ? (
            <SearchResults
              matches={matches ?? []}
              query={query.trim()}
              categories={categories}
              {...fieldProps}
            />
          ) : (
            <SectionView
              section={activeSection}
              byKey={byKey}
              valueOf={valueOf}
              {...fieldProps}
            />
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

interface FieldProps {
  edits: Record<string, string>;
  onChange: (setting: AppSetting, value: string) => void;
  onRevert: (key: string) => void;
  onTest: (key: string) => void;
  tests: Record<string, TestState>;
}

/**
 * One task-shaped section: the switch that turns it on, the provider that runs
 * it with that provider's key and model inline, then its tuning.
 */
function SectionView({
  section,
  byKey,
  valueOf,
  ...field
}: {
  section: SectionSpec;
  byKey: Record<string, AppSetting>;
  valueOf: (key: string) => string;
} & FieldProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const providerValue = section.provider ? valueOf(section.provider.setting) : "";
  const prov = activeProvider(section, providerValue);
  const modelKey = modelKeyFor(section, providerValue);

  // Endpoint overrides are set once, at install, by someone pointing a
  // provider at a self-hosted gateway. Keeping them next to the key but folded
  // means the common path is "paste key, test, done".
  const endpointKeys = [
    ...(prov?.spec.baseKey ? [prov.spec.baseKey] : []),
    ...(section.advancedKeys ?? []),
  ];

  const advancedDirty = endpointKeys.filter((k) => k in field.edits).length;

  return (
    <>
      <div>
        <h2 className="text-[15px] font-medium tracking-tight text-fg">
          {section.title}
        </h2>
        <p className="mt-1 max-w-[68ch] text-sm text-fg-muted">{section.blurb}</p>
      </div>

      <Fields keys={section.leadKeys ?? []} byKey={byKey} {...field} />

      {section.provider && (
        <>
          <Fields keys={[section.provider.setting]} byKey={byKey} {...field} />

          {prov ? (
            <Fields
              keys={[
                prov.spec.keyKey,
                ...(prov.spec.extraKeys ?? []),
                ...(modelKey ? [modelKey] : []),
              ]}
              byKey={byKey}
              sharedNote={sharedNoteFor(prov.id, section.title)}
              {...field}
            />
          ) : (
            <p className="border-t border-line py-6 text-sm text-fg-muted">
              No credentials are needed for this provider.
            </p>
          )}
        </>
      )}

      <Fields keys={section.tailKeys} byKey={byKey} {...field} />

      {endpointKeys.length > 0 && (
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
              ({endpointKeys.length})
            </span>
            {/* A hidden edit that the save bar counts but the admin can't see
                is a trap — the disclosure carries its own dot when one is in
                there. */}
            {advancedDirty > 0 && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-brand"
                aria-label={`${advancedDirty} unsaved`}
              />
            )}
          </button>

          {showAdvanced && <Fields keys={endpointKeys} byKey={byKey} {...field} />}
        </div>
      )}
    </>
  );
}

/**
 * "Also used by X" for a key more than one feature runs on. Editing the Qwen
 * key in Extraction also changes the key Chat uses, because it is one account
 * and one row — showing three independent-looking fields would imply three
 * keys the admin does not have.
 */
function sharedNoteFor(providerId: string, current: string): string | undefined {
  const others = sectionsUsingProvider(providerId).filter((t) => t !== current);
  if (others.length === 0) return undefined;
  return `One account, shared with ${others.join(" and ")} — editing it here changes it there too.`;
}

/** Renders the settings for a list of keys, skipping any the API didn't send. */
function Fields({
  keys,
  byKey,
  sharedNote,
  edits,
  onChange,
  onRevert,
  onTest,
  tests,
}: {
  keys: string[];
  byKey: Record<string, AppSetting>;
  sharedNote?: string;
} & FieldProps) {
  const present = keys.map((k) => byKey[k]).filter(Boolean);
  if (present.length === 0) return null;

  return (
    <div className="divide-y divide-line">
      {present.map((s) => (
        <div key={s.key}>
          <SettingField
            setting={s}
            draft={edits[s.key]}
            onChange={(v) => onChange(s, v)}
            onRevert={() => onRevert(s.key)}
            onTest={TESTABLE_KEYS[s.key] ? () => onTest(s.key) : undefined}
            testState={tests[s.key]}
          />
          {sharedNote && s.is_secret && (
            <p className="-mt-3 pb-5 text-xs text-fg-subtle">{sharedNote}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Search is deliberately flat and unfiltered by section — it is the escape
 * hatch for an admin who knows the setting's name but not which decision it
 * belongs to, so hiding a match because its section isn't open would defeat
 * the point. Category labels mark the runs.
 */
function SearchResults({
  matches,
  query,
  categories,
  edits,
  onChange,
  onRevert,
  onTest,
  tests,
}: {
  matches: AppSetting[];
  query: string;
  categories: SettingsCategory[];
} & FieldProps) {
  if (matches.length === 0) {
    return (
      <>
        <h2 className="text-[15px] font-medium tracking-tight text-fg">
          Nothing matching &ldquo;{query}&rdquo;
        </h2>
        <p className="mt-6 text-sm text-fg-muted">
          Try a provider name (<span className="text-fg">qwen</span>,{" "}
          <span className="text-fg">claude</span>) or a word from the setting you
          want, like <span className="text-fg">concurrency</span>.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="text-[15px] font-medium tracking-tight text-fg">
        {matches.length} setting{matches.length === 1 ? "" : "s"} matching
        &ldquo;{query}&rdquo;
      </h2>
      <div className="divide-y divide-line">
        {matches.map((s, i) => (
          <div key={s.key}>
            {/* Only where the section changes — repeating it on every row of a
                run turns a wayfinding cue into noise. */}
            {s.category !== matches[i - 1]?.category && (
              <p className="pt-6 text-xs font-medium text-fg-subtle">
                {categories.find((c) => c.key === s.category)?.label ??
                  s.category}
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
    </>
  );
}

function RailItem({
  label,
  icon: Icon,
  active,
  dirty,
  onSelect,
}: {
  label: string;
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
      <span className="truncate">{label}</span>
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
