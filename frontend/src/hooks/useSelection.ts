import { useCallback, useState } from "react";

/**
 * Shared multi-select state for bulk actions — one mechanism used by the
 * search results, the upload history, and the per-upload listings view, so
 * the three views behave identically (toggle a row, toggle a whole page,
 * clear after acting or when the underlying result set changes).
 */
export function useSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Toggle a whole page of rows: if every given id is already selected,
   * deselect them; otherwise select them all (ids selected on OTHER pages
   * are left alone).
   */
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected,
    count: selected.size,
    toggle,
    toggleAll,
    clear,
  };
}

export type Selection = ReturnType<typeof useSelection>;
