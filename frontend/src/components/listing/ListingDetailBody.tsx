import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Pencil, Phone, Search as SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import type { Supplier } from "@/types/chemical";
import {
  ConvertedPrice,
  formatPrice,
  ReviewBadge,
} from "@/components/search/ResultsTable";
import { ListingAdminCard } from "@/components/listing/ListingAdminCard";
import { HouseNotesCard } from "@/components/listing/HouseNotesCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MonoChip } from "@/components/ui/mono-chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { Listing } from "@/types/chemical";
import { formatDate, websiteHref } from "@/lib/format";

// Enrichment (PubChem-by-CAS) is attached under this key and rendered as its
// own clearly-labelled "not from the brochure" section, kept out of the
// brochure details list. Mirrors enrich.REFERENCE_KEY on the backend.
// Exported so the edit form can exclude/preserve it when editing details.
export const REFERENCE_KEY = "reference_data";

/**
 * The full product detail rendering (fixed fields + the flexible `details`
 * the brochure actually printed + PubChem reference block), shared by the
 * /product/:id page and the slide-in listing panel — one rendering, two
 * frames.
 *
 * The edit form is COLLAPSED behind an "Edit listing" button (admin/manager)
 * and pops open on click; hosts that already know the user wants to edit
 * (a row's Edit button) pass `defaultEdit` so it opens pre-expanded.
 * `onDeleted` lets the host react when the listing is deleted from the form
 * (the panel closes; the full page navigates away).
 */
export function ListingDetailBody({
  id,
  onDeleted,
  defaultEdit = false,
}: {
  id: string;
  onDeleted?: () => void;
  defaultEdit?: boolean;
}) {
  const { data: role } = useRole();
  const canManage = role === "admin" || role === "manager";
  const [editOpen, setEditOpen] = useState(defaultEdit);
  // Re-sync when the panel swaps products or the host requests edit mode.
  useEffect(() => setEditOpen(defaultEdit), [id, defaultEdit]);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["listing", id],
    queryFn: () => api.getListing(id),
  });

  const allDetails = (data?.details ?? {}) as Record<string, unknown>;
  // Brochure-printed details (everything except the enrichment block).
  const detailEntries = Object.entries(allDetails)
    .filter(([key]) => key !== REFERENCE_KEY)
    .map(([key, value]) => [humanizeKey(key), formatDetailValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  // PubChem reference block, if present — shown separately, clearly labelled.
  const referenceEntries = extractReference(allDetails[REFERENCE_KEY]);

  return (
    <div className="space-y-4">
      {isPending && (
        <Card>
          <CardContent className="space-y-4 pt-6" aria-hidden>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </CardContent>
        </Card>
      )}

      {isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-danger-text">
            {error instanceof Error ? error.message : "Could not load this listing."}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-xl">
                {data.name_en}
                {data.needs_review && <ReviewBadge />}
              </CardTitle>
              {/* Always shown, even when identical to the English name: the
                  results table no longer carries an "As printed" column, so
                  this panel is the one place the brochure's own wording is
                  guaranteed to be retrievable. */}
              <p className="mt-1 text-sm text-fg-muted">
                As printed:{" "}
                <span className="text-fg">{data.name_raw}</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    CAS number
                  </dt>
                  <dd className="mt-1">
                    {data.cas_number ? (
                      <MonoChip tone="cas">{data.cas_number}</MonoChip>
                    ) : (
                      <span className="text-sm text-fg-subtle">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    Price
                  </dt>
                  <dd className="mt-1">
                    {data.price == null ? (
                      <span className="text-sm text-fg-subtle">—</span>
                    ) : (
                      <MonoChip tone="price">
                        {formatPrice(data.price, data.currency)}
                      </MonoChip>
                    )}
                    <ConvertedPrice listing={data} />
                  </dd>
                </div>
                <Spec label="Purity" value={data.purity ?? "—"} />
                <Spec
                  label="Supplier"
                  value={
                    data.company_name_en && data.company_name && data.company_name_en !== data.company_name
                      ? `${data.company_name_en} (${data.company_name})`
                      : data.company_name_en || data.company_name || "—"
                  }
                />
                <Spec label="Listed" value={formatDate(data.created_at)} />
              </dl>

              <div className="flex flex-col gap-1.5">
                {data.company_website && (
                  <a
                    href={websiteHref(data.company_website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
                  >
                    Supplier website
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="font-normal text-fg-subtle">
                      (general site, as printed on the brochure)
                    </span>
                  </a>
                )}
                <a
                  href={productSearchUrl(data)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"
                >
                  Find this product online
                  <SearchIcon className="h-3.5 w-3.5" />
                  <span className="font-normal text-fg-subtle">
                    (web search{data.company_website ? " on the supplier's site" : ""})
                  </span>
                </a>
              </div>
            </CardContent>
          </Card>

          {(data.company_name_en || data.company_name) && (
            <SupplierContactCard
              name={data.company_name_en || data.company_name}
            />
          )}

          {canManage && !editOpen && (
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="w-full sm:w-auto"
            >
              <Pencil className="h-4 w-4" />
              Edit listing
            </Button>
          )}
          {canManage && editOpen && (
            <ListingAdminCard key={data.id} listing={data} onDeleted={onDeleted} />
          )}

          {/* House knowledge sits ABOVE the brochure details on purpose: our
              own substitution and regulatory calls outrank what a supplier
              printed, and the assistant treats them that way too. */}
          <HouseNotesCard
            chemicalId={data.chemical_id}
            chemicalName={data.name_en}
          />

          {detailEntries.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Technical details</CardTitle>
                <p className="mt-1 text-xs text-fg-subtle">
                  Exactly as extracted from this supplier's brochure — fields
                  vary per brochure.
                </p>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-line">
                  {detailEntries.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[200px_1fr]"
                    >
                      <dt className="text-sm font-medium text-fg-muted">
                        {label}
                      </dt>
                      <dd className="text-sm text-fg">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {referenceEntries.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">Reference data</CardTitle>
                  <Badge variant="secondary">not from brochure</Badge>
                </div>
                <p className="mt-1 text-xs text-fg-subtle">
                  Looked up from PubChem by CAS number — authoritative reference
                  values, not printed on this supplier's brochure.
                </p>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-line">
                  {referenceEntries.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[200px_1fr]"
                    >
                      <dt className="text-sm font-medium text-fg-muted">
                        {label}
                      </dt>
                      <dd className="text-sm text-fg">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Pull the PubChem enrichment block into display rows, dropping the internal
 * `source` marker (its meaning is conveyed by the section's own label/badge).
 */
function extractReference(value: unknown): (readonly [string, string])[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "source")
    .map(([key, v]) => [humanizeKey(key), formatDetailValue(v)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/** "flash_point" / "flashPoint" → "Flash point". */
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * Best-effort scalar rendering of an arbitrary JSON detail value.
 * Returns null for empty values so the row is dropped instead of showing
 * blanks / "null" / "{}" artifacts.
 */
function formatDetailValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => formatDetailValue(v))
      .filter((v): v is string => v !== null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const rendered = formatDetailValue(v);
        return rendered === null ? null : `${humanizeKey(k)}: ${rendered}`;
      })
      .filter((v): v is string => v !== null);
    return parts.length ? parts.join("; ") : null;
  }
  return null;
}



/**
 * Supplier contact + phone / email / websites, inlined into the product panel
 * so the user does not have to bounce to the suppliers directory just to see
 * who to call. Fetched by name through the existing /suppliers filter — the
 * best directory match is the row whose company name equals the listing's.
 */
function SupplierContactCard({ name }: { name: string }) {
  const query = name.split(/[,()\\%_]/, 1)[0].trim() || name;
  const { data, isPending, isError } = useQuery({
    queryKey: ["supplierByName", query],
    queryFn: () => api.listSuppliers(1, 5, query),
    staleTime: 60_000,
  });

  const match = pickSupplier(data?.items ?? [], name);

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6" aria-hidden>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardContent>
      </Card>
    );
  }
  if (isError || !match) return null;

  const hasContact =
    match.email || match.contact_number || match.websites.length > 0;
  if (!hasContact) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Supplier contact</CardTitle>
        <p className="mt-1 text-xs text-fg-subtle">
          Pulled from this supplier's directory entry — same details as the
          Suppliers page.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-start gap-1.5 text-sm">
          {match.email && (
            <a
              href={`mailto:${match.email}`}
              className="inline-flex max-w-full items-center gap-1.5 font-medium text-brand-text hover:underline"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{match.email}</span>
            </a>
          )}
          {match.contact_number && (
            <span className="inline-flex max-w-full items-center gap-1.5 text-fg">
              <Phone className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              <span className="min-w-0 truncate font-mono text-xs">
                {match.contact_number}
              </span>
            </span>
          )}
          {match.websites.map((site) => (
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
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * `/suppliers?q=` is a substring filter, so a query like "ABC" can match
 * several rows. Prefer an exact name match (either script); otherwise fall
 * back to the first row the directory returned.
 */
function pickSupplier(rows: Supplier[], name: string): Supplier | null {
  if (rows.length === 0) return null;
  const lower = name.trim().toLowerCase();
  const exact = rows.find(
    (r) =>
      r.company_name.toLowerCase() === lower ||
      (r.company_name_en ?? "").toLowerCase() === lower,
  );
  return exact ?? rows[0];
}

/**
 * Honest product lookup: a web search scoped to the supplier's site when we
 * know it, otherwise supplier name + product. We never construct or guess a
 * direct product URL — brochures only ever print the general site.
 */
function productSearchUrl(l: Listing): string {
  const supplier = l.company_name_en || l.company_name || "";
  // Use the supplier domain as a plain keyword, NOT the `site:` operator.
  // `site:www.dcc.com.tw "…"` returns nothing when the product page isn't in
  // Google's site index, whereas `www.dcc.com.tw "…"` (domain as a term) still
  // surfaces the page. Confirmed against dcc.com.tw / an EVAVC grade.
  const q = l.company_website
    ? `${hostOf(l.company_website)} "${l.name_en}"`
    : `${supplier} "${l.name_en}"`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(websiteHref(url)).hostname;
  } catch {
    return url.trim();
  }
}
