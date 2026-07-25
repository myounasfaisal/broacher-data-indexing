import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import type { Suggestion } from "@/types/chemical";

/**
 * Search text box with a live typeahead dropdown.
 *
 * As the user types, matching chemical names / CAS numbers and suppliers are
 * fetched from `/suggest` (short local debounce) and shown grouped under the
 * box. Picking one (click, or ↑/↓ + Enter) commits it immediately via
 * `onCommit`, bypassing the parent's search debounce so results appear at once.
 *
 * `onChange` still fires on every keystroke, so the parent's own debounced
 * free-text search keeps working even when the user ignores the dropdown.
 */
export function SearchBox({
  q,
  onChange,
  onCommit,
}: {
  q: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [debounced, setDebounced] = useState(q.trim());
  const boxRef = useRef<HTMLDivElement>(null);

  // The field is "live" — and earns the rotating neon accent — while it holds
  // focus or a query. Both are the states in which it is actively narrowing the
  // catalog; at rest it stays a quiet neutral input like every other control.
  const active = focused || q.trim().length > 0;

  // Short debounce so we fetch suggestions ~5 keystrokes/sec, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isError } = useQuery({
    queryKey: ["suggest", debounced],
    queryFn: () => api.suggest(debounced),
    enabled: open && debounced.length >= 1,
    staleTime: 30_000, // suggestions rarely change; cache briefly to feel instant
    retry: 1,
  });

  const suggestions = useMemo(() => data?.suggestions ?? [], [data]);
  // Show the panel for results OR to surface a fetch error (so a dead backend
  // reads as "unavailable" rather than a silently missing dropdown).
  const showList =
    open && q.trim().length >= 1 && (suggestions.length > 0 || isError);

  // Reset the keyboard highlight whenever the suggestion set changes.
  useEffect(() => setHighlight(-1), [debounced, suggestions.length]);

  // Close the dropdown on any click outside the box.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function choose(s: Suggestion) {
    onCommit(s.label);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!showList) {
        setOpen(true);
        return;
      }
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      if (!showList) return;
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      // Only intercept Enter when a suggestion is highlighted; otherwise let the
      // surrounding form submit ("Apply filters") as usual.
      if (showList && highlight >= 0) {
        e.preventDefault();
        choose(suggestions[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      className={`search-neon relative${active ? " is-active" : ""}`}
      ref={boxRef}
    >
      <Search
        aria-hidden
        className={`pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 transition-colors duration-200 ${
          active ? "text-brand" : "text-fg-subtle"
        }`}
      />
      <Input
        id="q"
        placeholder="e.g. ethanol, 乙醇, 64-17-5, titanium dioxide, a supplier name"
        value={q}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-suggestions"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        // Point the SR at the highlighted option so arrowing announces it;
        // aria-selected alone is silent without an active-descendant link.
        aria-activedescendant={
          showList && highlight >= 0 ? `search-suggestion-${highlight}` : undefined
        }
        // Left padding clears the icon; right padding clears the ✕ so a long
        // query never runs underneath either. When live, the field's own hairline
        // warms to brand so it reads as one piece with the neon ring around it.
        className={`relative ${q ? "pl-9 pr-9" : "pl-9"} ${
          active ? "border-brand/40" : ""
        }`}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      />
      {q && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="touch-target absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {showList && (
        <ul
          id="search-suggestions"
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-card border border-line bg-elevated py-1 shadow-pop"
        >
          {isError && suggestions.length === 0 && (
            <li className="px-3 py-2 text-sm text-fg-subtle">
              Suggestions unavailable — you can still press Enter to search.
            </li>
          )}
          {suggestions.map((s, i) => {
            const prev = suggestions[i - 1];
            const showSupplierHeader = s.type === "supplier" && prev?.type !== "supplier";
            return (
              <li key={`${s.type}-${s.label}-${i}`}>
                {showSupplierHeader && (
                  // The system's label step is 11px/600/+0.06em; 10px was a
                  // one-off literal with no step behind it.
                  <p className="label-caption px-3 pb-1 pt-2">Suppliers</p>
                )}
                <button
                  type="button"
                  role="option"
                  id={`search-suggestion-${i}`}
                  aria-selected={i === highlight}
                  // onMouseDown (not onClick) so the pick registers before the
                  // input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    i === highlight ? "bg-brand-soft" : "hover:bg-hover",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {highlightMatch(s.label, debounced)}
                    {s.type === "chemical" && s.cas_number && (
                      <span className="ml-2 font-mono text-xs text-fg-subtle">
                        {s.cas_number}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-fg-subtle">
                    {s.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Bold the portion of `label` that matches the typed query (case-insensitive). */
function highlightMatch(label: string, query: string) {
  const idx = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return label;
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-fg">
        {label.slice(idx, idx + query.length)}
      </span>
      {label.slice(idx + query.length)}
    </>
  );
}
