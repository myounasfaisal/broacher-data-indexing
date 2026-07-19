import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, Mail, Phone, Search as SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
import { SidePanel } from "@/components/ui/side-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonoChip } from "@/components/ui/mono-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/components/search/ResultsTable";
import type { Supplier } from "@/types/chemical";

/**
 * The search query that finds a supplier's products. Search sanitization
 * strips commas/parens from the QUERY but not from the indexed text, so a
 * full "…CO.,LTD." name would stop matching itself — use the name up to the
 * first such character ("SHANGHAI TITANOS INDUSTRY CO."), which is a real
 * substring of the stored supplier name.
 */
export function supplierSearchQuery(s: Supplier): string {
  const name = s.company_name_en || s.company_name || "";
  const cut = name.split(/[,()\\%_]/, 1)[0].trim();
  return cut || name;
}

/**
 * Right-side slide-in panel for one supplier — same drawer pattern as the
 * product panel: every extracted company detail plus a live preview of the
 * supplier's products (first page), with a jump into the full search.
 */
export function SupplierPanel({
  supplier,
  onClose,
  onOpenProduct,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  /** Optional: open a previewed product (host swaps to the product panel). */
  onOpenProduct?: (id: string) => void;
}) {
  return (
    <SidePanel
      open={supplier !== null}
      onClose={onClose}
      title="Supplier details"
      headerActions={
        supplier ? (
          <Link
            to={`/search?q=${encodeURIComponent(supplierSearchQuery(supplier))}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-btn px-2.5 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            title="Search all of this supplier's products"
          >
            View in search
            <SearchIcon className="h-3.5 w-3.5" />
          </Link>
        ) : null
      }
    >
      {supplier && (
        <SupplierBody supplier={supplier} onOpenProduct={onOpenProduct} />
      )}
    </SidePanel>
  );
}

function SupplierBody({
  supplier: s,
  onOpenProduct,
}: {
  supplier: Supplier;
  onOpenProduct?: (id: string) => void;
}) {
  const primary = s.company_name_en || s.company_name || "—";
  const secondary =
    s.company_name_en && s.company_name && s.company_name_en !== s.company_name
      ? s.company_name
      : null;

  // First page of this supplier's products, through the normal search.
  const { data, isPending } = useQuery({
    queryKey: ["supplierProducts", s.id],
    queryFn: () => api.search({ q: supplierSearchQuery(s), pageSize: 15 }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{primary}</CardTitle>
          {secondary && <p className="mt-1 text-sm text-fg-muted">{secondary}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                Products
              </dt>
              <dd className="mt-1">
                <MonoChip tone="neutral">{s.listing_count}</MonoChip>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                First seen
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-fg">
                {formatDate(s.created_at)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-1.5 text-sm">
            {s.email && (
              <a
                href={`mailto:${s.email}`}
                className="inline-flex items-center gap-1.5 font-medium text-brand-text hover:underline"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                {s.email}
              </a>
            )}
            {s.contact_number && (
              <span className="inline-flex items-center gap-1.5 text-fg">
                <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                <span className="font-mono text-xs">{s.contact_number}</span>
              </span>
            )}
            {s.websites.map((site) => (
              <a
                key={site}
                href={websiteHref(site)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-brand-text hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{site}</span>
              </a>
            ))}
            {!s.email && !s.contact_number && s.websites.length === 0 && (
              <p className="text-xs text-fg-subtle">
                No contact details printed on this supplier's brochures (email
                and phone are captured from uploads going forward when
                printed).
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
          <p className="mt-1 text-xs text-fg-subtle">
            Found via the normal search — open one for full details.
          </p>
        </CardHeader>
        <CardContent>
          {isPending && (
            <div aria-hidden className="space-y-2 py-1">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}
          {data && data.results.length === 0 && (
            <p className="py-2 text-sm text-fg-muted">No products found.</p>
          )}
          {data && data.results.length > 0 && (
            <>
              <ul className="divide-y divide-line">
                {data.results.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    {onOpenProduct ? (
                      <button
                        type="button"
                        onClick={() => onOpenProduct(r.id)}
                        className="min-w-0 truncate text-left text-sm font-medium text-brand-text hover:underline"
                        title="Open product details"
                      >
                        {r.name_en}
                      </button>
                    ) : (
                      <Link
                        to={`/product/${r.id}`}
                        className="min-w-0 truncate text-sm font-medium text-brand-text hover:underline"
                      >
                        {r.name_en}
                      </Link>
                    )}
                    {r.price != null && (
                      <MonoChip tone="price">
                        {formatPrice(r.price, r.currency)}
                      </MonoChip>
                    )}
                  </li>
                ))}
              </ul>
              {data.count > data.results.length && (
                <Link
                  to={`/search?q=${encodeURIComponent(supplierSearchQuery(s))}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
                >
                  View all {data.count} in search
                  <SearchIcon className="h-3.5 w-3.5" />
                </Link>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
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
