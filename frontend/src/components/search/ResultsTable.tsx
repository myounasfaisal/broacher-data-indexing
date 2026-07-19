import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MonoChip } from "@/components/ui/mono-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import type { Listing } from "@/types/chemical";

/**
 * Renders search results, sorted by the backend (cheapest first by default).
 * md and up: the full 6-column table. Below md: one card per listing so the
 * table never overflows a phone screen. CAS numbers and prices render as
 * monospace data chips so precise data reads distinct from prose.
 *
 * - `onOpen`: when provided, clicking a product opens it via this callback
 *   (the search page's slide-in panel) instead of navigating to
 *   /product/:id — the list stays mounted and keeps its scroll position.
 * - `selected` + `onToggleRow` (+ `onToggleAll`): when provided, each row
 *   gets a selection checkbox and the header gets a select-all covering the
 *   rows currently shown (bulk delete for admins).
 */
export function ResultsTable({
  rows,
  onOpen,
  onEdit,
  selected,
  onToggleRow,
  onToggleAll,
}: {
  rows: Listing[];
  onOpen?: (id: string) => void;
  /** Row "Edit" button: open the panel with the edit form pre-expanded. */
  onEdit?: (id: string) => void;
  selected?: ReadonlySet<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
}) {
  const selectable = Boolean(selected && onToggleRow);
  const pageIds = rows.map((r) => r.id);
  const allSelected =
    selectable && rows.length > 0 && pageIds.every((id) => selected!.has(id));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matching listings"
        description="Try a broader name, clear a filter, or browse by letter."
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onChange={() => onToggleAll?.(pageIds)}
                    aria-label={`Select all ${rows.length} listings shown on this page`}
                    title={`Select all ${rows.length} shown`}
                  />
                </TableHead>
              )}
              <TableHead>Name (EN)</TableHead>
              <TableHead>As printed</TableHead>
              <TableHead>CAS</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Purity</TableHead>
              {onEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {selectable && (
                  <TableCell className="w-8">
                    <Checkbox
                      checked={selected!.has(r.id)}
                      onChange={() => onToggleRow!(r.id)}
                      aria-label={`Select ${r.name_en}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">
                  <ProductName listing={r} onOpen={onOpen} />
                  {r.needs_review && <ReviewBadge />}
                </TableCell>
                <TableCell className="text-fg-muted">{r.name_raw}</TableCell>
                <TableCell>
                  {r.cas_number ? (
                    <MonoChip tone="cas">{r.cas_number}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                <TableCell>
                  <SupplierName listing={r} />
                </TableCell>
                <TableCell className="text-right">
                  {r.price == null ? (
                    <Dash />
                  ) : (
                    <MonoChip tone="price">
                      {formatPrice(r.price, r.currency)}
                    </MonoChip>
                  )}
                  <ConvertedPrice listing={r} />
                </TableCell>
                <TableCell>
                  {r.purity ? (
                    <MonoChip tone="neutral">{r.purity}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                {onEdit && (
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => onEdit(r.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                      title="Open with the edit form"
                    >
                      Edit
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-card border border-line bg-surface p-3 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              {selectable && (
                <Checkbox
                  className="mt-1 shrink-0"
                  checked={selected!.has(r.id)}
                  onChange={() => onToggleRow!(r.id)}
                  aria-label={`Select ${r.name_en}`}
                />
              )}
              <div className="min-w-0">
                <p className="font-medium">
                  <ProductName listing={r} onOpen={onOpen} />
                  {r.needs_review && <ReviewBadge />}
                </p>
                {r.name_raw !== r.name_en && (
                  <p className="truncate text-xs text-fg-muted">{r.name_raw}</p>
                )}
              </div>
              <div className="text-right">
                {r.price != null && (
                  <MonoChip tone="price">
                    {formatPrice(r.price, r.currency)}
                  </MonoChip>
                )}
                <ConvertedPrice listing={r} />
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-fg-muted">
              <div className="flex items-center gap-1.5">
                <dt className="text-fg-subtle">CAS</dt>
                <dd>
                  {r.cas_number ? (
                    <MonoChip tone="cas">{r.cas_number}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-fg-subtle">Purity</dt>
                <dd>
                  {r.purity ? (
                    <MonoChip tone="neutral">{r.purity}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="inline text-fg-subtle">Supplier </dt>
                <dd className="inline">
                  <SupplierName listing={r} inline />
                </dd>
              </div>
            </dl>
            {onEdit && (
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(r.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  Edit
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Dash() {
  return <span className="text-fg-subtle">—</span>;
}

/**
 * The clickable product name. With `onOpen` it is a button that opens the
 * slide-in detail panel (no navigation, list state intact); without it, it
 * falls back to a normal link to the /product/:id page.
 */
function ProductName({
  listing,
  onOpen,
}: {
  listing: Listing;
  onOpen?: (id: string) => void;
}) {
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(listing.id)}
        className="text-left text-brand-text hover:underline"
        title="View full product details"
      >
        {listing.name_en}
      </button>
    );
  }
  return (
    <Link
      to={`/product/${listing.id}`}
      className="text-brand-text hover:underline"
      title="View full product details"
    >
      {listing.name_en}
    </Link>
  );
}

/** Placeholder rows shown while a page of results is loading. */
export function ResultsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-3 py-2">
      <Skeleton className="h-4 w-36" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="hidden h-4 w-1/5 sm:block" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

const REVIEW_HINT =
  "The AI matched this listing to its chemical by name similarity (no exact CAS or name hit) — an admin should verify it.";

/** The needs_review flag, with a hover/focus tooltip explaining what it means. */
export function ReviewBadge() {
  return (
    <span className="group relative ml-2 inline-flex">
      <Badge
        variant="warning"
        tabIndex={0}
        className="cursor-help"
        aria-label={REVIEW_HINT}
      >
        review
      </Badge>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-60 rounded-md bg-fg px-2.5 py-1.5 text-xs font-normal text-app shadow-pop group-hover:block group-focus-within:block"
      >
        {REVIEW_HINT}
      </span>
    </span>
  );
}

/** English supplier name with the original-language name as secondary text. */
function SupplierName({
  listing,
  inline = false,
}: {
  listing: Listing;
  inline?: boolean;
}) {
  const primary = listing.company_name_en || listing.company_name || "—";
  const secondary =
    listing.company_name_en &&
    listing.company_name &&
    listing.company_name_en !== listing.company_name
      ? listing.company_name
      : null;

  if (inline) {
    return (
      <span>
        {primary}
        {secondary && <span className="text-fg-subtle"> ({secondary})</span>}
      </span>
    );
  }
  return (
    <>
      <span className="text-fg">{primary}</span>
      {secondary && (
        <span className="block text-xs text-fg-subtle">{secondary}</span>
      )}
    </>
  );
}

export function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return "—";
  return currency ? `${price} ${currency}` : String(price);
}

/**
 * "≈ $1,050 · ₨291,700" under the printed price. Skips whichever currency
 * the original is already in; conversions are current-rate approximations.
 */
export function ConvertedPrice({ listing }: { listing: Listing }) {
  const cur = (listing.currency ?? "").trim().toUpperCase();
  const parts: string[] = [];
  if (
    listing.price_usd != null &&
    !cur.startsWith("USD") &&
    !cur.startsWith("US$") &&
    !cur.startsWith("$")
  ) {
    parts.push(`$${formatAmount(listing.price_usd)}`);
  }
  if (
    listing.price_pkr != null &&
    !cur.startsWith("PKR") &&
    !cur.startsWith("RS") &&
    !cur.startsWith("₨")
  ) {
    parts.push(`₨${Math.round(listing.price_pkr).toLocaleString()}`);
  }
  if (parts.length === 0) return null;
  return (
    <span
      className="mt-0.5 block font-mono text-[11px] text-fg-subtle"
      title="Approximate — converted at current exchange rates"
    >
      ≈ {parts.join(" · ")}
    </span>
  );
}

function formatAmount(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2);
}
