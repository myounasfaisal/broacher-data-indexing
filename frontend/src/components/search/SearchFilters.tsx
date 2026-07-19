import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SearchBox } from "@/components/search/SearchBox";
import type { SortOption } from "@/lib/api";

/** The button-applied filters (everything except the live search text). */
export interface FilterValues {
  sort: SortOption;
  maxPrice?: number;
  minPurity?: number;
  /** Only listings with a printed price. */
  pricedOnly?: boolean;
}

/**
 * Filter controls for the search page.
 *
 * The search box (`q`) is LIVE — it reports every keystroke via `onQChange`, so
 * the parent can run a debounced search and reset the alphabet filter, and it
 * shows a typeahead dropdown whose picks commit immediately via `onCommitQ`.
 * Price / purity / sort are held locally and committed with the "Apply filters"
 * button (`onApply`).
 */
export function SearchFilters({
  q,
  onQChange,
  onCommitQ,
  filters,
  onFiltersChange,
  onApply,
}: {
  q: string;
  onQChange: (next: string) => void;
  onCommitQ: (next: string) => void;
  filters: FilterValues;
  onFiltersChange: (next: FilterValues) => void;
  onApply: () => void;
}) {
  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <div className="space-y-1 lg:col-span-2">
        <Label htmlFor="q">Name, CAS, supplier or description</Label>
        <SearchBox q={q} onChange={onQChange} onCommit={onCommitQ} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="maxPrice">Max price (USD)</Label>
        <Input
          id="maxPrice"
          type="number"
          min={0}
          step="any"
          value={filters.maxPrice ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              maxPrice:
                e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="minPurity">Min purity %</Label>
        <Input
          id="minPurity"
          type="number"
          min={0}
          max={100}
          step="any"
          value={filters.minPurity ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              minPurity:
                e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="sort">Sort by</Label>
        <Select
          id="sort"
          value={filters.sort}
          onChange={(e) =>
            onFiltersChange({ ...filters, sort: e.target.value as SortOption })
          }
        >
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
          <option value="name_asc">Name: A → Z</option>
          <option value="name_desc">Name: Z → A</option>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-5">
        <label
          htmlFor="pricedOnly"
          className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted"
        >
          <input
            id="pricedOnly"
            type="checkbox"
            className="h-4 w-4 rounded border-line accent-brand"
            checked={!!filters.pricedOnly}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                pricedOnly: e.target.checked || undefined,
              })
            }
          />
          Only listings with a price
        </label>
        <Button type="submit" className="w-40 sm:ml-auto">
          Apply filters
        </Button>
      </div>
    </form>
  );
}
