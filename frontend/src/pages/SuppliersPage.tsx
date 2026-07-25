import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Mail,
  Phone,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, websiteHref } from "@/lib/format";
import { ListingPanel } from "@/components/listing/ListingPanel";
import {
  SupplierPanel,
  supplierSearchQuery,
} from "@/components/supplier/SupplierPanel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MonoChip } from "@/components/ui/mono-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/search/Pagination";
import { PageHeader } from "@/components/layout/PageHeader";
import type { Supplier } from "@/types/chemical";

const PAGE_SIZE = 10;

/**
 * Suppliers directory (all roles): every supplier with the company details
 * extraction has captured — names, email, phone (populated from brochures
 * that print them; older uploads predate this capture), the printed
 * website(s), and how many listings the supplier has — with a link through
 * to those products via the normal search.
 */
export default function SuppliersPage() {
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [q, setQ] = useState("");
  // Debounced copy of `q` — this is what the query key uses, so typing doesn't
  // fire a request per keystroke. 250ms matches the search page's cadence.
  const [debouncedQ, setDebouncedQ] = useState("");
  // Right-side panels: clicking a supplier opens its details; opening one of
  // its products swaps to the product panel (same pattern as the search page).
  const [openSupplier, setOpenSupplier] = useState<Supplier | null>(null);
  const [openProductId, setOpenProductId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // A new filter or sort reorders the whole set, so page 1 is the only sensible
  // place to land — staying on page 4 of the old ordering is disorienting (and
  // usually empty after a filter change).
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, direction]);

  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: ["suppliers", page, debouncedQ, direction],
    queryFn: () => api.listSuppliers(page, PAGE_SIZE, debouncedQ, direction),
    // Keeps the previous page's rows on screen while the next request is in
    // flight, so typing doesn't flash the table back to skeletons each time.
    placeholderData: (prev) => prev,
  });

  // Never sit on a page past the end after the set shrinks.
  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Every supplier extracted from the brochures, with their printed contact details and products."
      />

      <Card>
        <CardContent className="pt-6">
          <div className="relative mb-4 max-w-sm">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name or email"
              aria-label="Filter suppliers by name or email"
              // pl-9 clears the icon; pr-9 reserves room for the clear button.
              className="pl-9 pr-9"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear filter"
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-btn text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {isPending && (
            <div aria-hidden className="space-y-3 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          )}
          {isError && (
            <p className="py-8 text-center text-sm text-danger-text">
              {error instanceof Error ? error.message : "Could not load suppliers"}
            </p>
          )}
          {data && data.count === 0 && !debouncedQ && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-fg">No suppliers yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
                Suppliers appear here automatically as brochures are uploaded
                and their company details are extracted.
              </p>
            </div>
          )}

          {data && data.count === 0 && debouncedQ && (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-fg">
                No supplier matches “{debouncedQ}”
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
                Names come from the brochures as printed, so a supplier may be
                filed under its original script or an abbreviation. Try a
                shorter fragment.
              </p>
              <button
                type="button"
                onClick={() => setQ("")}
                className="mt-3 inline-flex h-8 items-center rounded-btn border border-line px-3 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                Clear filter
              </button>
            </div>
          )}

          {data && data.count > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div
                  aria-live="polite"
                  className="text-sm text-fg-muted"
                  // Dim while a newer request is in flight so the count visibly
                  // belongs to the previous query rather than looking stale.
                  style={{ opacity: isFetching ? 0.6 : 1 }}
                >
                  {data.count} supplier{data.count === 1 ? "" : "s"}
                  {debouncedQ && " matching your filter"}
                </div>

                {/* The table header carries the sort control on md+; the card
                    layout has no header, so mobile gets this compact toggle. */}
                <button
                  type="button"
                  onClick={() =>
                    setDirection((d) => (d === "asc" ? "desc" : "asc"))
                  }
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-btn border border-line px-2.5 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 md:hidden"
                >
                  Name {direction === "asc" ? "A–Z" : "Z–A"}
                  {direction === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {/* md+: table. Below md: cards (same pattern as search results). */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        aria-sort={
                          direction === "asc" ? "ascending" : "descending"
                        }
                        className="p-0"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDirection((d) => (d === "asc" ? "desc" : "asc"))
                          }
                          title={`Sorted by name ${
                            direction === "asc" ? "A–Z" : "Z–A"
                          } — click to reverse`}
                          className="group inline-flex h-full w-full items-center gap-1.5 px-3 py-2 text-left font-medium hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                        >
                          Supplier
                          {direction === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5 text-fg-subtle group-hover:text-fg" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-fg-subtle group-hover:text-fg" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>First seen</TableHead>
                      <TableHead className="text-right">Products</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <SupplierNames
                            supplier={s}
                            onOpen={() => setOpenSupplier(s)}
                          />
                        </TableCell>
                        <TableCell>
                          <ContactDetails supplier={s} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-muted">
                          {formatDate(s.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <MonoChip tone="neutral">{s.listing_count}</MonoChip>
                        </TableCell>
                        <TableCell className="text-right">
                          <ProductsLink supplier={s} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-3 md:hidden">
                {data.items.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-card border border-line bg-surface p-3 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <SupplierNames
                        supplier={s}
                        onOpen={() => setOpenSupplier(s)}
                      />
                      <MonoChip tone="neutral">{s.listing_count}</MonoChip>
                    </div>
                    <div className="mt-2">
                      <ContactDetails supplier={s} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-fg-subtle">
                      <span>First seen {formatDate(s.created_at)}</span>
                      <ProductsLink supplier={s} />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <Pagination
                  page={data.page}
                  totalPages={data.total_pages}
                  onPage={setPage}
                />
              </div>

              <p className="mt-3 text-xs text-fg-subtle">
                Contact details show exactly what the brochures print — email
                and phone are captured from uploads going forward when a
                brochure includes them; suppliers from older uploads show only
                their names and website.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <SupplierPanel
        supplier={openProductId ? null : openSupplier}
        onClose={() => setOpenSupplier(null)}
        onOpenProduct={(id) => setOpenProductId(id)}
      />
      <ListingPanel
        id={openProductId}
        onClose={() => setOpenProductId(null)}
      />
    </div>
  );
}

/**
 * English name first, original-script name underneath (search-results style).
 * Clicking the name opens the supplier's slide-in detail panel.
 */
function SupplierNames({
  supplier: s,
  onOpen,
}: {
  supplier: Supplier;
  onOpen?: () => void;
}) {
  const primary = s.company_name_en || s.company_name || "—";
  const secondary =
    s.company_name_en && s.company_name && s.company_name_en !== s.company_name
      ? s.company_name
      : null;
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="text-left font-medium text-brand-text hover:underline"
          title="View supplier details"
        >
          {primary}
        </button>
      ) : (
        <p className="font-medium text-fg">{primary}</p>
      )}
      {secondary && <p className="text-xs text-fg-subtle">{secondary}</p>}
    </div>
  );
}

/**
 * Email / phone / website links; a quiet dash when nothing is on record.
 *
 * Every row is `max-w-full` with a `min-w-0 truncate` inner span: these values
 * are OCR'd off brochures, so a 60-character address is normal and would
 * otherwise widen the whole table column. `truncate` needs the min-w-0 to bite
 * inside a flex parent — without it the flex item refuses to shrink below its
 * content width and nothing is clipped. `title` keeps the full value reachable.
 */
function ContactDetails({ supplier: s }: { supplier: Supplier }) {
  const rows: ReactNode[] = [];
  if (s.email) {
    rows.push(
      <a
        key="email"
        href={`mailto:${s.email}`}
        title={s.email}
        className="inline-flex max-w-full items-center gap-1.5 text-brand-text hover:underline"
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{s.email}</span>
      </a>,
    );
  }
  if (s.contact_number) {
    rows.push(
      <span
        key="phone"
        className="inline-flex max-w-full items-center gap-1.5 text-fg"
      >
        <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 truncate font-mono text-xs">
          {s.contact_number}
        </span>
      </span>,
    );
  }
  for (const site of s.websites) {
    rows.push(
      <a
        key={site}
        href={websiteHref(site)}
        target="_blank"
        rel="noopener noreferrer"
        title={site}
        className="inline-flex max-w-full items-center gap-1.5 text-brand-text hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{site}</span>
      </a>,
    );
  }
  if (rows.length === 0) {
    return <span className="text-sm text-fg-subtle">—</span>;
  }
  return <div className="flex min-w-0 flex-col gap-1 text-sm">{rows}</div>;
}

/** Link through to this supplier's products via the normal search. */
function ProductsLink({ supplier: s }: { supplier: Supplier }) {
  return (
    <Link
      to={`/search?supplier=${encodeURIComponent(supplierSearchQuery(s))}`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-brand-text hover:underline"
      title="Search this supplier's products"
    >
      View products
      <SearchIcon className="h-3.5 w-3.5" />
    </Link>
  );
}
