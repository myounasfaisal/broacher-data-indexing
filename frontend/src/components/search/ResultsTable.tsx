import * as React from "react";
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
import { Pencil, Search } from "lucide-react";
import type { Listing } from "@/types/chemical";

/**
 * Renders search results, sorted by the backend (cheapest first by default).
 * lg and up: the full 7-column table. Below lg: one card per listing so the
 * table never overflows. CAS numbers and prices render as monospace data
 * chips so precise data reads distinct from prose.
 *
 * The switch is at lg (1024px), not md (768px): seven columns — name, CAS,
 * supplier, printed price, USD price, purity, edit — measured cramped on a 768px
 * tablet, with supplier names wrapping to three lines. The breakpoint is set
 * by where the content breaks, not by the device tier.
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
      <div className="hidden lg:block">
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
              {/* Supplier sits ahead of CAS: the page exists to choose a
                  supplier, so it reads immediately after the product. CAS is
                  an identifier you verify, not a thing you decide on. */}
              <TableHead>Name (EN)</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>CAS</TableHead>
              <TableHead className="text-right">As printed</TableHead>
              <TableHead className="text-right">Price (USD)</TableHead>
              <TableHead>Purity</TableHead>
              {onEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              // The whole row opens the listing — the row hover already reads
              // as "this is one thing you can act on", so requiring a click on
              // the name specifically wastes that affordance. The name stays a
              // real <button> underneath for keyboard and screen-reader users;
              // it just no longer looks like a link.
              <TableRow
                key={r.id}
                onClick={onOpen ? () => onOpen(r.id) : undefined}
                className={onOpen ? "cursor-pointer" : undefined}
              >
                {selectable && (
                  <TableCell className="w-8" onClick={stopRowClick}>
                    <Checkbox
                      checked={selected!.has(r.id)}
                      onChange={() => onToggleRow!(r.id)}
                      aria-label={`Select ${r.name_en}`}
                    />
                  </TableCell>
                )}
                {/* "As printed" has no column of its own: in this catalog it
                    duplicates the English name on most rows, and a column of
                    copies cost width that forced BOTH names to clamp. It
                    surfaces here only when it actually differs — the trade-name
                    case that matters for comparison — and always in the detail
                    panel. */}
                <TableCell className="font-medium">
                  <ProductName listing={r} onOpen={onOpen} />
                  {r.needs_review && <ReviewBadge />}
                  {r.name_raw !== r.name_en && (
                    <span
                      className="mt-0.5 line-clamp-1 text-xs font-normal text-fg-muted"
                      title={r.name_raw}
                    >
                      {r.name_raw}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <SupplierName listing={r} />
                </TableCell>
                <TableCell>
                  {r.cas_number ? (
                    <MonoChip tone="cas">{r.cas_number}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <PrintedPriceCell listing={r} />
                </TableCell>
                <TableCell className="text-right">
                  <UsdPriceCell listing={r} />
                </TableCell>
                <TableCell>
                  {r.purity ? (
                    <MonoChip tone="neutral">{r.purity}</MonoChip>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                {onEdit && (
                  <TableCell className="text-right" onClick={stopRowClick}>
                    <button
                      type="button"
                      onClick={() => onEdit(r.id)}
                      className="touch-target inline-flex items-center justify-center rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                      title="Open with the edit form"
                      aria-label={`Edit ${r.name_en}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 lg:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            onClick={onOpen ? () => onOpen(r.id) : undefined}
            // No resting shadow: below lg these cards ARE the results surface
            // (the page drops its wrapper card at this width), so a shadow here
            // would be a card floating inside nothing. The border carries the
            // separation; elevation stays a response to interaction.
            className={`rounded-card border border-line bg-surface p-3 ${
              onOpen ? "cursor-pointer transition-colors duration-150 active:bg-hover" : ""
            }`}
          >
            {/* Name spans the full card width and price sits beneath it. Side
                by side, a long chemical name gets squeezed into a 140px column
                and wraps to four lines on a 360px phone — the name is the
                thing being scanned, so it gets the width. */}
            <div className="flex items-start gap-3">
              {selectable && (
                <span onClick={stopRowClick} className="shrink-0">
                  <Checkbox
                    className="mt-1"
                    checked={selected!.has(r.id)}
                    onChange={() => onToggleRow!(r.id)}
                    aria-label={`Select ${r.name_en}`}
                  />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <ProductName listing={r} onOpen={onOpen} />
                  {r.needs_review && <ReviewBadge />}
                </p>
                {r.name_raw !== r.name_en && (
                  <p className="truncate text-xs text-fg-muted">{r.name_raw}</p>
                )}
                {/* No columns to align to on mobile, so the two prices sit
                    inline — printed first, conversion trailing it. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <PrintedPriceCell listing={r} />
                  <UsdPriceCell listing={r} />
                </div>
              </div>
            </div>
            {/* Only render facts this listing actually has — a grid of em-dashes
                is chrome, not information. */}
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-fg-muted">
              {/* Supplier first, matching the table's column order. */}
              <div className="col-span-2">
                <dt className="inline text-fg-subtle">Supplier </dt>
                <dd className="inline">
                  <SupplierName listing={r} inline />
                </dd>
              </div>
              {r.cas_number && (
                <div className="flex items-center gap-1.5">
                  <dt className="text-fg-subtle">CAS</dt>
                  <dd>
                    <MonoChip tone="cas">{r.cas_number}</MonoChip>
                  </dd>
                </div>
              )}
              {r.purity && (
                <div className="flex items-center gap-1.5">
                  <dt className="text-fg-subtle">Purity</dt>
                  <dd>
                    <MonoChip tone="neutral">{r.purity}</MonoChip>
                  </dd>
                </div>
              )}
            </dl>
            {onEdit && (
              <div className="mt-2 text-right" onClick={stopRowClick}>
                <button
                  type="button"
                  onClick={() => onEdit(r.id)}
                  className="touch-target inline-flex items-center justify-center rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                  aria-label={`Edit ${r.name_en}`}
                >
                  <Pencil className="h-4 w-4" />
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
 * Keeps a click on a nested control (checkbox, Edit) from also firing the
 * row's open handler. Without it, selecting a row would open its panel.
 */
function stopRowClick(e: React.MouseEvent) {
  e.stopPropagation();
}

/**
 * The brochure's own number, in the brochure's own currency.
 *
 * Two price columns, not one stacked cell: the printed figure and the USD
 * conversion answer different questions — "what does this supplier claim" and
 * "how does it compare" — and stacking them made every row two lines tall to
 * say one thing. Split into columns, each one scans down as a single tabular
 * list, and the comparison the page exists for happens in the USD column
 * alone. PKR is gone entirely; a third currency was width spent on a number
 * nobody sorted or compared by.
 *
 * There is never an empty chip: with no value the cell renders a dash.
 */
export function PrintedPriceCell({ listing }: { listing: Listing }) {
  const printed =
    listing.price != null ? formatPrice(listing.price, listing.currency) : null;
  if (!printed) return <Dash />;

  return (
    <MonoChip tone="price" title="As printed in the supplier's brochure">
      {printed}
    </MonoChip>
  );
}

/**
 * The USD column.
 *
 * A conversion is not a quote, so it never wears the accent `price` fill: it
 * gets the unfilled `approx` chip and a literal "est." label. The one exception
 * is a brochure that printed USD itself — then the number IS the printed price
 * and reads as authoritative.
 */
export function UsdPriceCell({ listing }: { listing: Listing }) {
  const cur = (listing.currency ?? "").trim().toUpperCase();
  const inUsd =
    cur.startsWith("USD") || cur.startsWith("US$") || cur.startsWith("$");

  if (listing.price != null && inUsd) {
    return (
      <MonoChip tone="price" title="As printed in the supplier's brochure">
        {formatPrice(listing.price, listing.currency)}
      </MonoChip>
    );
  }
  if (listing.price_usd == null) return <Dash />;

  return (
    <MonoChip
      tone="approx"
      title="Estimated — converted from the printed price at current exchange rates"
    >
      <span className="mr-1 font-sans text-[11px] font-normal text-fg-muted">
        est.
      </span>
      ${formatAmount(listing.price_usd)}
    </MonoChip>
  );
}

/**
 * The product name.
 *
 * When the row itself is clickable (`onOpen`), this renders as plain text in
 * a button — no link colour, no underline. The row is the affordance; styling
 * the name as a link on top of that implies the rest of the row is inert. The
 * button survives so keyboard and screen-reader users still have a real,
 * named control to activate, and it stops propagation so the row handler
 * doesn't fire twice.
 *
 * Without `onOpen` (no panel available) it falls back to a genuine link to
 * /product/:id — and there it is styled as a link, because it is one.
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
        onClick={(e) => {
          e.stopPropagation();
          onOpen(listing.id);
        }}
        // Names run long, so allow two lines before truncating: one line cut
        // most names mid-word, three would let a single row dominate the page.
        className="line-clamp-2 -my-1 py-1 text-left text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        title={listing.name_en}
      >
        {listing.name_en}
      </button>
    );
  }
  return (
    <Link
      to={`/product/${listing.id}`}
      className="line-clamp-2 text-brand-text hover:underline"
      title={listing.name_en}
    >
      {listing.name_en}
    </Link>
  );
}

/**
 * Placeholder rows shown while a page of results is loading. The shapes are
 * decorative (aria-hidden on the inner block), but the region announces itself
 * so a screen-reader user hears that results are coming rather than silence.
 */
export function ResultsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-2">
      <span className="sr-only">Loading results…</span>
      <div aria-hidden className="space-y-3">
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
    </div>
  );
}

const REVIEW_HINT =
  "The AI matched this listing to its chemical by name similarity (no exact CAS or name hit) — an admin should verify it.";

/**
 * The needs_review flag, with a tooltip explaining what it means.
 *
 * This is a real <button>, not a focusable <span>: a hover-only tooltip is
 * dead weight on a phone, and tapping a button reliably focuses it on touch
 * (tapping a tabindex'd span does not, across browsers). So the same
 * :focus-visible path that serves keyboard users serves touch users too.
 *
 * The tooltip id is per-instance. A fixed "review-hint" meant fifteen flagged
 * rows rendered fifteen elements with the same id, so every badge's
 * aria-describedby resolved to the first row's tooltip — silently breaking the
 * one signal that says "don't trust this row yet" for exactly the users who
 * can't see the badge.
 */
export function ReviewBadge() {
  const hintId = React.useId();
  return (
    <span className="group relative ml-2 inline-flex align-middle">
      <button
        type="button"
        // The badge explains itself; it performs no action beyond revealing
        // the hint, so it must not submit or navigate.
        onClick={(e) => e.preventDefault()}
        aria-describedby={hintId}
        className="touch-target cursor-help rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
      >
        <Badge variant="warning">review</Badge>
      </button>
      <span
        role="tooltip"
        id={hintId}
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

/**
 * A printed price, grouped and decimal-normalized like every other number in
 * the column. Raw interpolation produced "1050 USD" above "9.5 USD" above
 * "12000 USD" — monospaced and tabular, and still unscannable, because the
 * font can only align digits that were formatted to align in the first place.
 */
export function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return "—";
  const amount = formatAmount(price);
  return currency ? `${amount} ${currency.trim()}` : amount;
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
      className="mt-0.5 block font-mono text-xs text-fg-subtle"
      title="Approximate — converted at current exchange rates"
    >
      ≈ {parts.join(" · ")}
    </span>
  );
}

function formatAmount(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2);
}
