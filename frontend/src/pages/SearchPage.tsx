import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  api,
  type InterpretedFilters,
  type SearchParams,
} from "@/lib/api";
import {
  SearchFilters,
  countActiveFilters,
  isDirty,
  type FilterValues,
} from "@/components/search/SearchFilters";
import { SearchBox } from "@/components/search/SearchBox";
import {
  ResultsSkeleton,
  ResultsTable,
} from "@/components/search/ResultsTable";
import { AISearchBar, FilterChips } from "@/components/search/AISearchBar";
import { AlphabetBar } from "@/components/search/AlphabetBar";
import { Pagination } from "@/components/search/Pagination";
import { ListingPanel } from "@/components/listing/ListingPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, ChevronDown, Sparkles, SlidersHorizontal, X } from "lucide-react";
import { ChatPanel } from "@/components/search/ChatPanel";
import { Modal } from "@/components/ui/modal";
import { SelectionBar } from "@/components/ui/selection-bar";
import { useRole } from "@/hooks/useRole";
import { useSelection } from "@/hooks/useSelection";

const PAGE_SIZE = 15; // hard cap — the backend refuses anything larger
const DEFAULT_FILTERS: FilterValues = { sort: "price_asc" };

// The primary click-through flow opens products in a slide-in panel, so the
// list never unmounts — but full navigations still happen (direct /product/:id
// links, the panel's "Full page" link, browser back/forward). For those paths
// the search state + scroll offset are kept in sessionStorage (per tab,
// cleared when the tab closes) and restored on mount, so coming back lands
// exactly where the user left off.
const STATE_KEY = "searchPage:state";
const SCROLL_KEY = "searchPage:scroll";

interface PersistedState {
  q: string;
  filters: FilterValues;
  appliedFilters: FilterValues;
  letter: string | null;
  aiFilters: InterpretedFilters | null;
  page: number;
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : {};
  } catch {
    return {};
  }
}

/**
 * Viewer page: search/filter the chemical database and compare suppliers.
 *
 * Three mutually exclusive search modes, so they never fight each other:
 *   - TYPING in the search box: debounced live search (clears letter + AI).
 *   - LETTER browsing: A–Z tabs (clears text + AI).
 *   - AI SEARCH: the sentence is converted server-side into structured
 *     filters (shown as removable chips), and the rows come from the normal
 *     GET /search with those filters — the model never supplies data, and
 *     pagination/sorting work exactly as in manual mode.
 * Price / purity / sort are committed with the "Apply filters" button and
 * apply to the manual modes.
 *
 * Clicking a product opens it in a right-side slide-in panel (the list stays
 * mounted behind it); admins can also select rows for bulk delete.
 */
export default function SearchPage() {
  // An explicit ?q= in the URL (e.g. the Suppliers page's "View products"
  // link) beats any persisted state: it starts a fresh named search.
  // ?supplier= is how the Suppliers page's "View products" arrives: it fills
  // the supplier FILTER and leaves the main box empty, so the user can type a
  // product straight away and search within that supplier. (?q= is the older
  // form and still starts a plain named search.)
  const [urlArrival] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return { q: p.get("q"), supplier: p.get("supplier") };
  });
  const urlQ = urlArrival.q;
  const urlSupplier = urlArrival.supplier;
  const fromUrl = Boolean(urlQ || urlSupplier);

  const [searchParams, setSearchParams] = useSearchParams();
  const [restored] = useState(loadPersistedState);
  const initialQ = urlQ ?? (urlSupplier ? "" : (restored.q ?? ""));
  const initialFilters: FilterValues = urlSupplier
    ? { ...DEFAULT_FILTERS, supplier: urlSupplier }
    : (restored.filters ?? DEFAULT_FILTERS);
  const [q, setQ] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ.trim());
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<FilterValues>(
      urlSupplier ? initialFilters : (restored.appliedFilters ?? DEFAULT_FILTERS),
    );
  const [letter, setLetter] = useState<string | null>(
    fromUrl ? null : (restored.letter ?? null),
  );
  const [aiFilters, setAiFilters] = useState<InterpretedFilters | null>(
    fromUrl ? null : (restored.aiFilters ?? null),
  );
  const [page, setPage] = useState(fromUrl ? 1 : (restored.page ?? 1));

  // Both arrival params are consumed exactly once — drop them from the URL so
  // later typing/back-navigation doesn't resurrect a stale query or filter.
  useEffect(() => {
    if (searchParams.has("q") || searchParams.has("supplier")) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Slide-in product panel: the id being viewed, or null when closed.
  // Clicking another product while open just swaps this id. openEdit tracks
  // whether the panel should pop open with the edit form expanded (a row's
  // Edit button) or collapsed (a name click).
  const [openId, setOpenId] = useState<string | null>(null);
  const [openEdit, setOpenEdit] = useState(false);

  // Both refine surfaces start closed at every screen size. Results are the
  // point of the page; filter chrome that is always open pushes the first row
  // below the fold on desktop as well as mobile. The Filters toggle carries a
  // count so a collapsed panel is never a hidden-state trap.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // Deliberately NOT persisted to sessionStorage like the search state below:
  // the chat is ephemeral server-side, so restoring an "open" panel after a
  // navigation would show a chat whose thread no longer exists.
  const [chatOpen, setChatOpen] = useState(false);
  // Focus goes into the panel when it opens (the composer autofocuses), so it
  // has to come back here when it closes — otherwise Escape drops the caret at
  // the top of the document and a keyboard user restarts their traversal.
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    chatButtonRef.current?.focus();
  }, []);

  const { data: role } = useRole();
  // Bulk delete follows the listing write permission: admin + manager.
  const canManage = role === "admin" || role === "manager";
  const selection = useSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  // Debounce the search text so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // In AI mode the interpreted filters drive the SAME GET /search endpoint
  // the manual mode uses — one trusted query path for both.
  const params: SearchParams = aiFilters
    ? {
        q: aiFilters.name_query ?? undefined,
        cas: aiFilters.cas_number ?? undefined,
        minPrice: aiFilters.min_price ?? undefined,
        maxPrice: aiFilters.max_price ?? undefined,
        minPurity: aiFilters.min_purity ?? undefined,
        maxPurity: aiFilters.max_purity ?? undefined,
        detailsQ: aiFilters.details_query ?? undefined,
        sort: aiFilters.sort,
        page,
        pageSize: PAGE_SIZE,
      }
    : {
        ...appliedFilters,
        q: debouncedQ || undefined,
        letter: letter ?? undefined,
        page,
        pageSize: PAGE_SIZE,
      };

  const { data, isPending, isFetching, isError, error } = useQuery({
    queryKey: ["search", params],
    queryFn: () => api.search(params),
    // Keep the previous page on screen while the next one loads — no flicker.
    placeholderData: keepPreviousData,
  });

  // ---- Fix: preserve position across full navigations (see STATE_KEY note).
  useEffect(() => {
    sessionStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        q,
        filters,
        appliedFilters,
        letter,
        aiFilters,
        page,
      } satisfies PersistedState),
    );
  }, [q, filters, appliedFilters, letter, aiFilters, page]);

  useEffect(() => {
    const save = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    // Also capture the final position on unmount (navigating away).
    return () => {
      save();
      window.removeEventListener("scroll", save);
    };
  }, []);

  // Restore the saved scroll offset once, after the first page of results has
  // actually rendered (scrolling before the rows exist would be clamped to 0).
  // A ?q= arrival is a fresh search, not a return — nothing to restore.
  const scrollRestored = useRef(Boolean(urlQ));
  useEffect(() => {
    if (scrollRestored.current || isPending || !data) return;
    scrollRestored.current = true;
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
    if (y > 0) window.scrollTo({ top: y, behavior: "auto" });
  }, [isPending, data]);

  // Never sit on a page past the end (e.g. after a bulk delete shrinks the
  // result set) — same guard the upload history uses.
  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  // A selection only makes sense against the result set it was made in:
  // changing any filter (not the page — selections may span pages) clears it.
  const filterKey = JSON.stringify({ ...params, page: 0 });
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      selection.clear();
    }
  }, [filterKey, selection]);

  const bulkDelete = useMutation({
    mutationFn: () => api.bulkDeleteListings([...selection.selected]),
    onSuccess: (res) => {
      toast.success(`${res.deleted} listing(s) deleted.`);
      // If the slide-in panel is showing one of the deleted products, close it.
      if (openId && selection.selected.has(openId)) setOpenId(null);
      selection.clear();
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["uploadListings"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
      setConfirmOpen(false);
    },
  });

  // Typing takes over from letter-browsing AND from AI mode.
  function handleQChange(next: string) {
    setQ(next);
    setLetter(null);
    setAiFilters(null);
    setPage(1);
  }

  // Picking a typeahead suggestion: commit the text immediately (skip the
  // 300ms debounce) so results appear the instant the user clicks.
  function commitQ(next: string) {
    setQ(next);
    setDebouncedQ(next.trim());
    setLetter(null);
    setAiFilters(null);
    setPage(1);
  }

  // Picking a letter is "browse" mode — clears search text and AI mode.
  function pickLetter(next: string | null) {
    setLetter(next);
    setQ("");
    setDebouncedQ("");
    setAiFilters(null);
    setPage(1);
  }

  function applyFilters() {
    setAppliedFilters(filters);
    setAiFilters(null);
    setPage(1);
  }

  // An AI result takes over: clears text + letter so the chips are the only
  // active filters.
  function applyAiFilters(next: InterpretedFilters) {
    setAiFilters(next);
    setQ("");
    setDebouncedQ("");
    setLetter(null);
    setPage(1);
  }

  function editAiFilters(next: InterpretedFilters) {
    setAiFilters(next);
    setPage(1);
  }

  function clearAiFilters() {
    setAiFilters(null);
    setPage(1);
  }

  const searching = debouncedQ.length > 0;
  const activeCount = countActiveFilters(appliedFilters);
  const dirty = isDirty(filters, appliedFilters);
  // Letter browsing lives inside the collapsed panel too, so it has to count
  // toward the badge — otherwise picking "K", collapsing, and forgetting reads
  // as "the database only has 40 chemicals".
  const refineCount = activeCount + (letter ? 1 : 0);

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function clearSupplier() {
    setFilters((f) => ({ ...f, supplier: undefined }));
    setAppliedFilters((f) => ({ ...f, supplier: undefined }));
    setPage(1);
  }

  return (
    <div>
      {/* The toolbar is the only chrome above the results. It sticks under the
          mobile top bar (h-14) and at the top of the desktop column, so the
          search field and the active-filter state stay reachable while a long
          result list scrolls — without costing a screenful at rest. */}
      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-line glass px-4 py-3 sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
        <h1 className="sr-only">Search chemicals</h1>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox q={q} onChange={handleQChange} onCommit={commitQ} />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setAiOpen((v) => !v)}
            aria-expanded={aiOpen}
            aria-controls="ai-search-panel"
            title="Search in plain words"
            // Open = active mode, so it carries the accent instead of a flat
            // grey — the colour marks state, matching the neon field and the
            // filter count badge.
            className={
              aiOpen
                ? "border-brand/40 bg-brand-soft text-brand-soft-text hover:bg-brand-soft hover:border-brand/50"
                : undefined
            }
          >
            <Sparkles className="h-4 w-4 text-brand-text" />
            <span className="hidden sm:inline">Ask AI</span>
          </Button>

          {/* Distinct from "Ask AI" above: that converts one sentence into
              filters and drives this table. This opens a conversation that
              can search, compare suppliers, and reason about substitutes. */}
          <Button
            ref={chatButtonRef}
            type="button"
            variant="outline"
            onClick={() => (chatOpen ? closeChat() : setChatOpen(true))}
            aria-expanded={chatOpen}
            title="Chat with the sourcing assistant"
            className={
              chatOpen
                ? "border-brand/40 bg-brand-soft text-brand-soft-text hover:bg-brand-soft hover:border-brand/50"
                : undefined
            }
          >
            <Bot className="h-4 w-4" />
            <span className="hidden sm:inline">Assistant</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="filters-panel"
            className={
              filtersOpen
                ? "border-brand/40 bg-brand-soft text-brand-soft-text hover:bg-brand-soft hover:border-brand/50"
                : undefined
            }
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
            {refineCount > 0 && (
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-on-brand"
                aria-label={`${refineCount} active`}
              >
                {refineCount}
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-150 ${
                filtersOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </div>

        {/* An active supplier filter has to be visible with the panel closed —
            arriving from Suppliers' "View products" would otherwise look like
            nothing happened. Not shown in AI mode, where the AI's own chips
            are the active filter set. */}
        {!aiFilters && appliedFilters.supplier && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="label-caption">Supplier</span>
            <button
              type="button"
              onClick={clearSupplier}
              title="Remove the supplier filter"
              className="touch-target inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-brand-soft-text ring-1 ring-inset ring-brand/20 transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              {appliedFilters.supplier}
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {aiOpen && (
          <div id="ai-search-panel" className="mt-3">
            <AISearchBar onFilters={applyAiFilters} />
          </div>
        )}

        {aiFilters && (
          <div className="mt-3">
            <FilterChips
              filters={aiFilters}
              onChange={editAiFilters}
              onClear={clearAiFilters}
            />
          </div>
        )}

        {filtersOpen && (
          <div
            id="filters-panel"
            className="mt-3 space-y-4 border-t border-line pt-3"
          >
            <SearchFilters
              filters={filters}
              onFiltersChange={setFilters}
              onApply={applyFilters}
              onReset={resetFilters}
              dirty={dirty}
              activeCount={activeCount}
            />
            <div className="border-t border-line pt-3">
              <p className="label-caption mb-2">Browse by letter</p>
              <AlphabetBar value={letter} onChange={pickLetter} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
      {/* Below lg the result cards are the surface themselves, so the wrapper
          drops its card chrome rather than nesting one card set inside
          another — and the page reclaims 32px of horizontal padding on a
          phone, which is where scroll economy is tightest. */}
      <Card className="rounded-none border-x-0 border-y-0 bg-transparent shadow-none lg:rounded-card lg:border lg:border-line lg:bg-surface">
        <CardContent className="p-0 pt-0 lg:p-6">
          {isPending && <ResultsSkeleton />}
          {isError && (
            <p className="py-8 text-center text-sm text-danger-text">
              {error instanceof Error ? error.message : "Search failed"}
            </p>
          )}
          {!isPending && !isError && data && (
            // Refetching used to dim the whole block to 60%, which faded the
            // prices a user was mid-comparison on — "stale" reading as
            // "unreliable" on the one number the product exists to deliver.
            // A determinate bar above the results says the same thing without
            // taking contrast away from the data.
            <div aria-busy={isFetching}>
              {isFetching && (
                <div
                  aria-hidden
                  className="mb-2 h-0.5 overflow-hidden rounded-full bg-muted"
                >
                  <span className="block h-full w-1/3 animate-[results-progress_1.1s_ease-in-out_infinite] rounded-full bg-brand" />
                </div>
              )}
              <div className="mb-3 flex items-center justify-between text-sm text-fg-muted">
                <span aria-live="polite" aria-atomic="true">
                  {data.count} result{data.count === 1 ? "" : "s"}
                  {searching ? (
                    <>
                      {" "}
                      matching{" "}
                      <span className="font-medium">“{debouncedQ}”</span>
                    </>
                  ) : letter ? (
                    <>
                      {" "}
                      starting with{" "}
                      <span className="font-medium uppercase">{letter}</span>
                    </>
                  ) : aiFilters ? (
                    <> for your AI search</>
                  ) : null}
                </span>
                {data.total_pages > 1 && (
                  <span>
                    Page {data.page} of {data.total_pages}
                  </span>
                )}
              </div>
              {canManage && (
                <div className="mb-3 empty:hidden">
                  <SelectionBar
                    count={selection.count}
                    noun="listing"
                    scopeHint={`the header checkbox selects the ${data.results.length} shown on this page; selections keep across pages`}
                    onClear={selection.clear}
                  >
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmOpen(true)}
                      disabled={bulkDelete.isPending}
                    >
                      Delete selected
                    </Button>
                  </SelectionBar>
                </div>
              )}
              <ResultsTable
                rows={data.results}
                onOpen={(id) => {
                  setOpenEdit(false);
                  setOpenId(id);
                }}
                onEdit={
                  canManage
                    ? (id) => {
                        setOpenEdit(true);
                        setOpenId(id);
                      }
                    : undefined
                }
                selected={canManage ? selection.selected : undefined}
                onToggleRow={canManage ? selection.toggle : undefined}
                onToggleAll={canManage ? selection.toggleAll : undefined}
              />
              {data.count === 0 && aiFilters?.details_query && (
                <p className="mt-2 text-center text-xs text-fg-subtle">
                  Detail attributes like “{aiFilters.details_query}” are
                  matched best-effort against what each brochure printed — try
                  removing that chip or rewording.
                </p>
              )}
              <div className="mt-4">
                <Pagination
                  page={data.page}
                  totalPages={data.total_pages}
                  onPage={setPage}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <ListingPanel
        id={openId}
        edit={openEdit}
        onClose={() => setOpenId(null)}
      />

      {/* Right-hand dock. Full width on phones (Search is the one screen whose
          small-screen form has to be genuinely good), a fixed column from sm
          up so the results table stays visible beside it. */}
      {chatOpen && (
        <>
          {/* Scrim on phones only. There the panel covers the whole viewport,
              so it is a modal overlay and needs both a visible "there is a
              screen behind this" and a tap-outside exit. From sm up it is a
              dock beside the results, and a scrim would be wrong. */}
          <div
            className="animate-fade-in fixed inset-0 z-30 bg-fg/25 sm:hidden"
            onClick={closeChat}
            aria-hidden
          />
          <aside
            className="animate-slide-in-right fixed inset-y-0 right-0 z-40 w-full shadow-pop sm:w-[380px] lg:w-[420px]"
            aria-label="Sourcing assistant"
          >
            <ChatPanel
              context={{
                query: debouncedQ || undefined,
                supplier: appliedFilters.supplier,
                selected_listing_id: openId ?? undefined,
                selected_listing_name:
                  data?.results.find((r) => r.id === openId)?.name_en ??
                  undefined,
              }}
              onOpenListing={(id) => setOpenId(id)}
              onClose={closeChat}
            />
          </aside>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${selection.count} listing${selection.count === 1 ? "" : "s"}?`}
        description="The selected listings will be permanently removed from the database. This cannot be undone."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={bulkDelete.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => bulkDelete.mutate()}
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending
                ? "Deleting…"
                : `Delete ${selection.count} listing${selection.count === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      />
    </div>
  );
}
