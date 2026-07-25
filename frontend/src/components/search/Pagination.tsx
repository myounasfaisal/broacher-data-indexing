import { Button } from "@/components/ui/button";

/**
 * Numbered pagination with a sliding window (1 … 4 5 [6] 7 8 … 20) so huge
 * page counts stay compact. Page size is fixed server-side (max 15 rows).
 */
export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Prev
      </Button>

      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-fg-subtle">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            className={[
              // 36px reads right beside the sm buttons on a mouse; coarse
              // pointers get the 44px minimum instead.
              "h-9 min-w-9 touch-target rounded-btn border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
              p === page
                ? "border-brand bg-brand text-on-brand"
                : "border-line bg-surface text-fg-muted hover:bg-muted",
            ].join(" ")}
          >
            {p}
          </button>
        ),
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

/** First + last always shown; a window of ±2 pages around the current one. */
function pageWindow(page: number, total: number): (number | "…")[] {
  const pages = new Set<number>([1, total]);
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}
