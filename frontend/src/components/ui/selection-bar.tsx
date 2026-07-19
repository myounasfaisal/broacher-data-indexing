import type { ReactNode } from "react";

/**
 * Selection summary bar shown above a table while rows are selected: a
 * visible count, an optional scope hint (what "select all" covered), the
 * bulk action button(s) passed as children, and a Clear control. Shared by
 * every view with bulk selection so the pattern reads the same everywhere.
 */
export function SelectionBar({
  count,
  noun = "item",
  scopeHint,
  onClear,
  children,
}: {
  count: number;
  /** Singular noun for the count label ("listing", "upload"). */
  noun?: string;
  /** e.g. "select-all covers the 15 rows shown on this page" */
  scopeHint?: string;
  onClear: () => void;
  children?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-btn border border-brand/30 bg-brand-soft px-3 py-2 animate-fade-in">
      <span className="text-sm font-medium text-brand-soft-text">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      {scopeHint && (
        <span className="text-xs text-brand-soft-text/80">{scopeHint}</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className="rounded-btn px-2.5 py-1.5 text-xs font-medium text-brand-soft-text hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
