import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SortOption } from "@/lib/api";

/** The button-applied filters (everything except the live search text). */
export interface FilterValues {
  sort: SortOption;
  /** Supplier name substring — narrows results to one supplier. */
  supplier?: string;
  minPrice?: number;
  maxPrice?: number;
  minPurity?: number;
  /** Only listings with a printed price. */
  pricedOnly?: boolean;
}

/**
 * How many filters are narrowing the results right now. Sort is excluded — it
 * reorders but never hides a row, so counting it would overstate how filtered
 * the view is. Drives the badge on the Filters toggle.
 */
export function countActiveFilters(f: FilterValues): number {
  let n = 0;
  if (f.supplier?.trim()) n++;
  // A min/max pair is one constraint on one dimension — counting it twice
  // would overstate how filtered the view is on the toolbar badge.
  if (f.minPrice != null || f.maxPrice != null) n++;
  if (f.minPurity != null) n++;
  if (f.pricedOnly) n++;
  return n;
}

/** True when `filters` still holds unapplied edits. */
export function isDirty(a: FilterValues, b: FilterValues): boolean {
  return (
    a.sort !== b.sort ||
    (a.supplier ?? "") !== (b.supplier ?? "") ||
    a.minPrice !== b.minPrice ||
    a.maxPrice !== b.maxPrice ||
    a.minPurity !== b.minPurity ||
    Boolean(a.pricedOnly) !== Boolean(b.pricedOnly)
  );
}

/** A backwards range returns nothing — catch it before spending a request. */
export function isRangeInvalid(f: FilterValues): boolean {
  return (
    f.minPrice != null && f.maxPrice != null && f.minPrice > f.maxPrice
  );
}

/**
 * The refine-and-sort controls, shown inside the search page's collapsible
 * Filters panel. The live text box is NOT here — it stays permanently visible
 * in the toolbar above, because it is the primary action and burying it costs
 * a tap on every single search.
 *
 * Price / purity / sort are held locally and committed with "Apply filters"
 * (`onApply`), so a half-typed number never fires a query.
 */
export function SearchFilters({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  dirty,
  activeCount,
}: {
  filters: FilterValues;
  onFiltersChange: (next: FilterValues) => void;
  onApply: () => void;
  onReset: () => void;
  dirty: boolean;
  activeCount: number;
}) {
  const rangeInvalid = isRangeInvalid(filters);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (rangeInvalid) return;
        onApply();
      }}
    >
      {/* The refine inputs are one tight group. A 2-col tablet step sits between
          the stacked phone layout and the 3-wide desktop row so the Min–Max
          pair never gets squeezed into a pair of ~100px fields at ~700px. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start lg:grid-cols-3">
        {/* Its own axis, not a second free-text box: the main search already
            matches supplier names, so this is what makes "this product, from
            this supplier" expressible. Spans the row because supplier names are
            long. */}
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
        <Label htmlFor="supplier">Supplier</Label>
        <Input
          id="supplier"
          type="text"
          placeholder="Any supplier — e.g. Qingdao Echemi"
          value={filters.supplier ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              supplier: e.target.value || undefined,
            })
          }
        />
      </div>

      {/* Min and max are one constraint on one dimension, so they read as a
          single labelled range rather than two unrelated fields. */}
      <div className="space-y-1">
        <span id="price-range-label" className="block text-sm font-medium text-fg">
          Price (USD)
        </span>
        <div
          role="group"
          aria-labelledby="price-range-label"
          className="flex items-center gap-2"
        >
          <Input
            id="minPrice"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="Min"
            aria-label="Minimum price in USD"
            aria-invalid={rangeInvalid || undefined}
            value={filters.minPrice ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                minPrice: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
          <span aria-hidden className="text-fg-subtle">
            –
          </span>
          <Input
            id="maxPrice"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="Max"
            aria-label="Maximum price in USD"
            aria-invalid={rangeInvalid || undefined}
            value={filters.maxPrice ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                maxPrice: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
        {rangeInvalid && (
          <p role="alert" className="text-xs text-danger-text">
            Minimum is above the maximum — no listing can match.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="minPurity">Min purity %</Label>
        <Input
          id="minPurity"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="any"
          placeholder="Any"
          value={filters.minPurity ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              minPurity: e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
        />
      </div>

      <div className="space-y-1 sm:col-span-2 lg:col-span-1">
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
      </div>

      {/* Action row lifted out of the input grid: committing the filters is a
          different act from filling them, so it gets generous separation (the
          form's space-y-6) rather than reading as one more field. */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="pricedOnly"
          className="touch-target flex cursor-pointer items-center gap-2 py-1 text-sm text-fg-muted"
        >
          <input
            id="pricedOnly"
            type="checkbox"
            className="h-4 w-4 rounded border-line accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
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

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              className="flex-1 sm:flex-none"
            >
              Clear
            </Button>
          )}
          {/* Label stays constant — a disabled button that relabels itself to
              "Filters applied" reads as a status message, not a control. */}
          <Button
            type="submit"
            disabled={!dirty || rangeInvalid}
            className="flex-1 sm:w-40 sm:flex-none"
          >
            Apply filters
          </Button>
        </div>
      </div>
    </form>
  );
}
