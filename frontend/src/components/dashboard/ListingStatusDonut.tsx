import { PieChart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusDistribution } from "@/types/chemical";

/**
 * The listing catalog's quality mix as a three-slice donut with a numeric
 * legend. Proportion is the donut's job; the exact counts live in the legend
 * (never in the ring's hole, never as arc labels — see DESIGN.md).
 *
 * The 2px gap between segments is NOT decoration: the dark-mode status trio
 * sits inside the colourblind "floor" band for Green↔Amber, so the gap plus
 * the labelled legend are the mandatory secondary encoding that keeps the
 * chart readable for a protan viewer. Do not remove either.
 */
const R = 52;
const CIRC = 2 * Math.PI * R; // 326.73
const GAP = 4; // ~2px at the rendered size — the separation between slices

type Slice = { key: string; label: string; value: number; varName: string };

export function ListingStatusDonut({
  dist,
  loading = false,
}: {
  dist: StatusDistribution | undefined;
  loading?: boolean;
}) {
  const d = dist ?? { complete: 0, needs_review: 0, missing_price: 0 };
  const total = d.complete + d.needs_review + d.missing_price;

  const slices: Slice[] = [
    { key: "complete", label: "Complete", value: d.complete, varName: "--c-green" },
    { key: "needs_review", label: "Needs review", value: d.needs_review, varName: "--c-amber" },
    { key: "missing_price", label: "Missing price", value: d.missing_price, varName: "--c-rose" },
  ];

  // Lay each slice out as its own dashed circle, shortened by GAP so the
  // muted track shows through as a clean break between colours.
  let cursor = 0;
  const arcs = slices.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const len = Math.max(frac * CIRC - GAP, 0);
    const offset = -cursor * CIRC;
    cursor += frac;
    return { ...s, len, offset };
  });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-c-violet-soft text-c-violet">
          <PieChart className="h-[15px] w-[15px]" aria-hidden />
        </span>
        <h3 className="text-[15px] font-medium text-fg">Listing status</h3>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        {loading ? (
          <Skeleton className="h-[140px] w-[140px] shrink-0 rounded-full" />
        ) : (
          <svg
            width="140"
            height="140"
            viewBox="0 0 128 128"
            className="shrink-0 -rotate-90"
            role="img"
            aria-label={
              total > 0
                ? `Listing status: ${arcs
                    .map((a) => `${a.label} ${Math.round((a.value / total) * 100)}%`)
                    .join(", ")}`
                : "Listing status: no listings yet"
            }
          >
            <circle cx="64" cy="64" r={R} fill="none" stroke="var(--muted)" strokeWidth="18" />
            {total > 0 &&
              arcs.map((a) => (
                <circle
                  key={a.key}
                  cx="64"
                  cy="64"
                  r={R}
                  fill="none"
                  stroke={`var(${a.varName})`}
                  strokeWidth="18"
                  strokeDasharray={`${a.len} ${CIRC - a.len}`}
                  strokeDashoffset={a.offset}
                />
              ))}
          </svg>
        )}

        <ul className="min-w-[180px] flex-1 space-y-3">
          {arcs.map((a) => (
            <li key={a.key} className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: `var(${a.varName})` }}
                aria-hidden
              />
              <span className="flex-1 text-[13px] text-fg-muted">{a.label}</span>
              {loading ? (
                <Skeleton className="h-4 w-10" />
              ) : (
                <>
                  <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                    {a.value.toLocaleString()}
                  </span>
                  <span className="w-11 text-right font-mono text-xs tabular-nums text-fg-subtle">
                    {total > 0 ? `${Math.round((a.value / total) * 100)}%` : "—"}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
