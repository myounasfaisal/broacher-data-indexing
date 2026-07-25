import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SupplierListingCount } from "@/types/chemical";

/**
 * The suppliers holding the most listings, as a horizontal bar list.
 *
 * Every bar is the SAME hue (--brand). This panel ranks a single measure, so
 * length already carries the comparison; colouring bars by rank would imply a
 * categorical difference that isn't there and would repaint a supplier when it
 * moves up a place (DESIGN.md → The Entity-Not-Rank Rule). Bar widths are a
 * share of the LEADER's count, not of the catalog — stated in the sub-line so
 * the scale isn't misread as market share.
 */
export function TopSuppliersBars({
  suppliers,
  loading = false,
}: {
  suppliers: SupplierListingCount[] | undefined;
  loading?: boolean;
}) {
  const rows = suppliers ?? [];
  const leader = rows.length > 0 ? Math.max(...rows.map((r) => r.count), 1) : 1;

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-c-sky-soft text-c-sky">
          <BarChart3 className="h-[15px] w-[15px]" aria-hidden />
        </span>
        <h3 className="text-[15px] font-medium text-fg">Top suppliers by listings</h3>
      </div>
      <p className="mb-4 text-xs text-fg-subtle">
        Share of the leading supplier&rsquo;s total, not of the whole catalog.
      </p>

      {loading ? (
        <div className="space-y-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="mb-1.5 flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-8" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">
          No supplier listings yet.
        </p>
      ) : (
        <ul className="space-y-3.5">
          {rows.map((r) => (
            <li key={r.company_id}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span
                  className="truncate text-[13px] text-fg"
                  title={r.name}
                >
                  {r.name}
                </span>
                <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-fg-muted">
                  {r.count.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.round((r.count / leader) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
