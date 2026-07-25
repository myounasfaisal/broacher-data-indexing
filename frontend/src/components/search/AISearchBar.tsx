import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";
import { api, type InterpretedFilters, type SortOption } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Natural-language search bar. POST /search/ai ONLY converts the sentence
 * into structured filters — the parent then drives the regular GET /search
 * with those filters, so every displayed row provably comes from the
 * database (and pagination/sorting keep working exactly as in manual mode).
 */
export function AISearchBar({
  onFilters,
}: {
  onFilters: (filters: InterpretedFilters) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = text.trim();
    if (!query || busy) return;
    setBusy(true);
    try {
      const res = await api.aiSearch(query);
      onFilters(res.interpreted_filters);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className="relative flex-1">
        <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Ask in plain words — e.g. "cheapest sodium hydroxide under $5 with purity over 99%"'
          className="pl-9"
          aria-label="AI search"
        />
      </div>
      <Button type="submit" disabled={busy || !text.trim()}>
        {busy ? "Interpreting…" : "AI search"}
      </Button>
    </form>
  );
}

const SORT_LABELS: Record<SortOption, string> = {
  price_asc: "price low → high",
  price_desc: "price high → low",
  name_asc: "name A → Z",
  name_desc: "name Z → A",
};

/**
 * What the AI understood, as removable chips — the user can verify or
 * correct the interpretation before trusting the results. Removing a chip
 * re-runs the (manual-path) search without that filter.
 */
export function FilterChips({
  filters,
  onChange,
  onClear,
}: {
  filters: InterpretedFilters;
  onChange: (next: InterpretedFilters) => void;
  onClear: () => void;
}) {
  const chips: { key: keyof InterpretedFilters; label: string }[] = [];
  if (filters.name_query)
    chips.push({ key: "name_query", label: `“${filters.name_query}”` });
  if (filters.cas_number)
    chips.push({ key: "cas_number", label: `CAS ${filters.cas_number}` });
  if (filters.min_price != null)
    chips.push({ key: "min_price", label: `price ≥ ${filters.min_price}` });
  if (filters.max_price != null)
    chips.push({ key: "max_price", label: `price ≤ ${filters.max_price}` });
  if (filters.min_purity != null)
    chips.push({ key: "min_purity", label: `purity ≥ ${filters.min_purity}%` });
  if (filters.max_purity != null)
    chips.push({ key: "max_purity", label: `purity ≤ ${filters.max_purity}%` });
  if (filters.details_query)
    chips.push({ key: "details_query", label: `details: “${filters.details_query}”` });
  if (filters.sort !== "price_asc")
    chips.push({ key: "sort", label: `sort: ${SORT_LABELS[filters.sort]}` });

  function remove(key: keyof InterpretedFilters) {
    const next: InterpretedFilters = { ...filters };
    if (key === "sort") {
      next.sort = "price_asc";
    } else {
      next[key] = null;
    }
    // A non-default sort is still an active chip, so it keeps the search
    // alive: removing the last DATA filter shouldn't also silently drop a
    // sort chip the user didn't click.
    const empty =
      !next.name_query &&
      !next.cas_number &&
      next.min_price == null &&
      next.max_price == null &&
      next.min_purity == null &&
      next.max_purity == null &&
      !next.details_query &&
      next.sort === "price_asc";
    if (empty) onClear();
    else onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="label-caption">Understood as</span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => remove(c.key)}
          className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-brand-soft-text ring-1 ring-inset ring-brand/20 transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          title="Remove this filter"
        >
          {c.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-fg-muted hover:text-fg hover:underline"
      >
        Clear AI search
      </button>
    </div>
  );
}
