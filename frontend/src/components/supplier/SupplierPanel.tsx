import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, Mail, Phone, Search as SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, websiteHref } from "@/lib/format";
import { SidePanel } from "@/components/ui/side-panel";
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
            to={`/search?supplier=${encodeURIComponent(supplierSearchQuery(supplier))}`}
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

/**
 * The drawer is already an elevated surface, so the content inside it is laid
 * out with plain sections and a rule between them rather than Cards — cards
 * inside a card add elevation without adding information.
 */
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
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["supplierProducts", s.id],
    queryFn: () => api.search({ q: supplierSearchQuery(s), pageSize: 15 }),
    staleTime: 30_000,
  });

  return (
    <div className="divide-y divide-line">
      <section className="pb-6">
        {/* break-words: extracted company names can be a single unbroken
            token long enough to push the drawer into horizontal scroll. */}
        <h3 className="break-words text-xl font-medium tracking-tight text-fg">
          {primary}
        </h3>
        {secondary && (
          <p className="mt-1 break-words text-sm text-fg-muted">{secondary}</p>
        )}

        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
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

        <div className="mt-4 flex flex-col items-start gap-1.5 text-sm">
          {s.email && (
            <a
              href={`mailto:${s.email}`}
              className="inline-flex max-w-full items-center gap-1.5 font-medium text-brand-text hover:underline"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{s.email}</span>
            </a>
          )}
          {s.contact_number && (
            <span className="inline-flex max-w-full items-center gap-1.5 text-fg">
              <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              <span className="min-w-0 truncate font-mono text-xs">
                {s.contact_number}
              </span>
            </span>
          )}
          {s.websites.map((site) => (
            <a
              key={site}
              href={websiteHref(site)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 font-medium text-brand-text hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{site}</span>
            </a>
          ))}
          {!s.email && !s.contact_number && s.websites.length === 0 && (
            <p className="text-xs text-fg-subtle">
              No contact details printed on this supplier's brochures (email and
              phone are captured from uploads going forward when printed).
            </p>
          )}
        </div>
      </section>

      <section className="pt-6">
        <h3 className="text-base font-medium tracking-tight text-fg">
          Products
        </h3>
        <p className="mt-1 text-xs text-fg-subtle">
          Found via the normal search — open one for full details.
        </p>

        <div className="mt-3">
          {isPending && (
            <>
              <div aria-hidden className="space-y-2 py-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
              {/* The skeleton bars are decorative and hidden; without this the
                  wait is silent for screen readers. */}
              <span className="sr-only" role="status">
                Loading this supplier's products…
              </span>
            </>
          )}

          {isError && (
            <div role="alert" className="py-2">
              <p className="text-sm text-danger-text">
                {error instanceof Error
                  ? error.message
                  : "Could not load this supplier's products."}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 inline-flex h-8 items-center rounded-btn border border-line px-2.5 text-xs font-medium text-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                Try again
              </button>
            </div>
          )}

          {data && data.results.length === 0 && (
            <p className="py-2 text-sm text-fg-muted">
              No products matched this supplier's name in the search index.
            </p>
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
                  to={`/search?supplier=${encodeURIComponent(supplierSearchQuery(s))}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
                >
                  View all {data.count} in search
                  <SearchIcon className="h-3.5 w-3.5" />
                </Link>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
