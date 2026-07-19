import { useEffect, useRef, useState } from "react";
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
  type FilterValues,
} from "@/components/search/SearchFilters";
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
import { Modal } from "@/components/ui/modal";
import { SelectionBar } from "@/components/ui/selection-bar";
import { PageHeader } from "@/components/layout/PageHeader";
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
  const [urlQ] = useState(
    () => new URLSearchParams(window.location.search).get("q") || null,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [restored] = useState(loadPersistedState);
  const initialQ = urlQ ?? restored.q ?? "";
  const [q, setQ] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ.trim());
  const [filters, setFilters] = useState<FilterValues>(
    restored.filters ?? DEFAULT_FILTERS,
  );
  const [appliedFilters, setAppliedFilters] = useState<FilterValues>(
    restored.appliedFilters ?? DEFAULT_FILTERS,
  );
  const [letter, setLetter] = useState<string | null>(
    urlQ ? null : (restored.letter ?? null),
  );
  const [aiFilters, setAiFilters] = useState<InterpretedFilters | null>(
    urlQ ? null : (restored.aiFilters ?? null),
  );
  const [page, setPage] = useState(urlQ ? 1 : (restored.page ?? 1));

  // The ?q= param is consumed exactly once — drop it from the URL so later
  // typing/back-navigation doesn't resurrect a stale query.
  useEffect(() => {
    if (searchParams.has("q")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  // Slide-in product panel: the id being viewed, or null when closed.
  // Clicking another product while open just swaps this id. openEdit tracks
  // whether the panel should pop open with the edit form expanded (a row's
  // Edit button) or collapsed (a name click).
  const [openId, setOpenId] = useState<string | null>(null);
  const [openEdit, setOpenEdit] = useState(false);

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

  return (
    <div>
      <PageHeader
        title="Search chemicals"
        description="Compare suppliers and find the cheapest option — even under different trade names."
      />

      <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              AI search
            </p>
            <AISearchBar onFilters={applyAiFilters} />
            {aiFilters && (
              <FilterChips
                filters={aiFilters}
                onChange={editAiFilters}
                onClear={clearAiFilters}
              />
            )}
          </div>
          <div className="border-t border-line pt-4">
            <SearchFilters
              q={q}
              onQChange={handleQChange}
              onCommitQ={commitQ}
              filters={filters}
              onFiltersChange={setFilters}
              onApply={applyFilters}
            />
          </div>
          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Browse by letter
            </p>
            <AlphabetBar value={letter} onChange={pickLetter} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isPending && <ResultsSkeleton />}
          {isError && (
            <p className="py-8 text-center text-sm text-danger-text">
              {error instanceof Error ? error.message : "Search failed"}
            </p>
          )}
          {!isPending && !isError && data && (
            <div className={isFetching ? "opacity-60 transition-opacity" : ""}>
              <div className="mb-3 flex items-center justify-between text-sm text-fg-muted">
                <span>
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
