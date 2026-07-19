import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, Mail, Phone, Search as SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
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
  // Right-side panels: clicking a supplier opens its details; opening one of
  // its products swaps to the product panel (same pattern as the search page).
  const [openSupplier, setOpenSupplier] = useState<Supplier | null>(null);
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["suppliers", page],
    queryFn: () => api.listSuppliers(page, PAGE_SIZE),
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
          {data && (
            <>
              <div className="mb-3 text-sm text-fg-muted">
                {data.count} supplier{data.count === 1 ? "" : "s"}
              </div>

              {/* md+: table. Below md: cards (same pattern as search results). */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
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

/** Email / phone / website links; a quiet dash when nothing is on record. */
function ContactDetails({ supplier: s }: { supplier: Supplier }) {
  const rows: ReactNode[] = [];
  if (s.email) {
    rows.push(
      <a
        key="email"
        href={`mailto:${s.email}`}
        className="inline-flex items-center gap-1.5 text-brand-text hover:underline"
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        {s.email}
      </a>,
    );
  }
  if (s.contact_number) {
    rows.push(
      <span key="phone" className="inline-flex items-center gap-1.5 text-fg">
        <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="font-mono text-xs">{s.contact_number}</span>
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
        className="inline-flex items-center gap-1.5 text-brand-text hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{site}</span>
      </a>,
    );
  }
  if (rows.length === 0) {
    return <span className="text-sm text-fg-subtle">—</span>;
  }
  return <div className="flex flex-col gap-1 text-sm">{rows}</div>;
}

/** Link through to this supplier's products via the normal search. */
function ProductsLink({ supplier: s }: { supplier: Supplier }) {
  return (
    <Link
      to={`/search?q=${encodeURIComponent(supplierSearchQuery(s))}`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-brand-text hover:underline"
      title="Search this supplier's products"
    >
      View products
      <SearchIcon className="h-3.5 w-3.5" />
    </Link>
  );
}

function websiteHref(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
