import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { MonoChip } from "@/components/ui/mono-chip";
import { SelectionBar } from "@/components/ui/selection-bar";
import { Pagination } from "@/components/search/Pagination";
import { ListingPanel } from "@/components/listing/ListingPanel";
import { useSelection } from "@/hooks/useSelection";
import type { UploadHistoryItem, UploadRange } from "@/types/chemical";

const RANGES: { value: UploadRange; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

const RANGE_NOUN: Record<UploadRange, string> = {
  week: "the last 7 days",
  month: "the last 30 days",
  year: "the last year",
  all: "all time",
};

/**
 * Persistent upload history (from the `documents` ledger, not the in-memory
 * queue). Every admin/manager sees their own past uploads with the date and
 * how many listings were added; admins can flip to the org-wide audit ("who
 * uploaded what, when") and expand any row to see exactly which listings it
 * produced.
 *
 * Rows can be multi-selected for a bulk Undo (same selection mechanism as
 * the search results): each selected upload's listings are removed exactly
 * as the per-row Undo would, one upload at a time, after one confirmation.
 */
export function UploadHistory({ isAdmin }: { isAdmin: boolean }) {
  // Admins default to the org-wide audit; managers only ever see their own.
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [range, setRange] = useState<UploadRange>("all");
  const [page, setPage] = useState(1);
  const all = isAdmin && scope === "all";

  const selection = useSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["uploadHistory", all, range, page],
    queryFn: () => api.listUploadHistory(all, range, page),
  });

  const items = data?.items ?? [];
  const totalPages = data?.total_pages ?? 1;
  const count = data?.count ?? 0;
  const pageHashes = items.map((i) => i.content_hash);
  const allOnPageSelected =
    items.length > 0 && pageHashes.every((h) => selection.selected.has(h));

  // After a filter change or an undo shrinks the set, never sit on a page past
  // the end (which would show an empty table).
  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  const changeScope = (next: "mine" | "all") => {
    setScope(next);
    setPage(1);
    selection.clear(); // a selection only makes sense within one result set
  };
  const changeRange = (next: UploadRange) => {
    setRange(next);
    setPage(1);
    selection.clear();
  };

  // Bulk undo runs the uploads ONE AT A TIME through the same per-upload
  // endpoint as the row button — sequentially, so the "keep listings shared
  // with another upload" rule sees each earlier undo before the next runs.
  const bulkUndo = useMutation({
    mutationFn: async (hashes: string[]) => {
      let deleted = 0;
      let kept = 0;
      const failed: string[] = [];
      for (const hash of hashes) {
        try {
          const res = await api.undoUpload(hash);
          deleted += res.deleted_listings;
          kept += res.kept_shared;
        } catch {
          failed.push(hash);
        }
      }
      return { deleted, kept, failed, total: hashes.length };
    },
    onSuccess: (res) => {
      if (res.failed.length === 0) {
        toast.success(
          `${res.total} upload(s) undone — ${res.deleted} listing(s) deleted` +
            (res.kept ? `, ${res.kept} kept (shared with other uploads)` : ""),
        );
      } else {
        toast.error(
          `${res.total - res.failed.length}/${res.total} upload(s) undone ` +
            `(${res.deleted} listing(s) deleted); ${res.failed.length} failed.`,
        );
      }
      selection.clear();
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isAdmin ? (
          <div className="flex gap-1">
            <Tab
              label="Everyone"
              active={scope === "all"}
              onClick={() => changeScope("all")}
            />
            <Tab
              label="My uploads"
              active={scope === "mine"}
              onClick={() => changeScope("mine")}
            />
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-1" role="group" aria-label="Filter by date">
          {RANGES.map((r) => (
            <Tab
              key={r.value}
              label={r.label}
              active={range === r.value}
              onClick={() => changeRange(r.value)}
            />
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="py-4 text-center text-sm text-fg-muted">Loading history…</p>
      )}
      {isError && (
        <p className="py-4 text-center text-sm text-danger-text">
          {error instanceof Error ? error.message : "Could not load history"}
        </p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="py-4 text-center text-sm text-fg-muted">
          {range === "all"
            ? "No uploads yet."
            : `No uploads in ${RANGE_NOUN[range]}.`}
        </p>
      )}

      {items.length > 0 && (
        <>
          <SelectionBar
            count={selection.count}
            noun="upload"
            scopeHint={`the header checkbox selects the ${items.length} shown on this page; selections keep across pages`}
            onClear={selection.clear}
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={bulkUndo.isPending}
            >
              {bulkUndo.isPending ? "Undoing…" : "Undo selected"}
            </Button>
          </SelectionBar>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allOnPageSelected}
                    onChange={() => selection.toggleAll(pageHashes)}
                    aria-label={`Select all ${items.length} uploads shown on this page`}
                    title={`Select all ${items.length} shown`}
                  />
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Supplier</TableHead>
                {all && <TableHead>Uploaded by</TableHead>}
                <TableHead className="text-right">Listings</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <HistoryRow
                  key={item.content_hash}
                  item={item}
                  showUploader={all}
                  selected={selection.selected.has(item.content_hash)}
                  onToggleSelect={() => selection.toggle(item.content_hash)}
                />
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-fg-subtle">
              {count} upload{count === 1 ? "" : "s"}
              {range !== "all" && ` in ${RANGE_NOUN[range]}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </div>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Undo ${selection.count} upload${selection.count === 1 ? "" : "s"}?`}
        description="Every listing these uploads added will be permanently deleted (except any also produced by another upload), and their history rows removed so the PDFs can be re-uploaded. This cannot be undone."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={bulkUndo.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => bulkUndo.mutate([...selection.selected])}
              disabled={bulkUndo.isPending}
            >
              {bulkUndo.isPending
                ? "Undoing…"
                : `Undo ${selection.count} upload${selection.count === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      />
    </div>
  );
}

function HistoryRow({
  item,
  showUploader,
  selected,
  onToggleSelect,
}: {
  item: UploadHistoryItem;
  showUploader: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const queryClient = useQueryClient();
  const supplier = item.company_name_en || item.company_name || "—";
  // Total columns so the expanded detail cell can span the full width.
  const colCount = 6 + (showUploader ? 1 : 0);

  // Undo this upload: removes its listings (except ones another upload also
  // produced) and this history row, so the PDF can be re-uploaded fresh.
  const undo = useMutation({
    mutationFn: () => api.undoUpload(item.content_hash),
    onSuccess: (res) => {
      toast.success(
        `Upload removed — ${res.deleted_listings} listing(s) deleted` +
          (res.kept_shared
            ? `, ${res.kept_shared} kept (shared with other uploads)`
            : ""),
      );
      queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Undo failed"),
  });

  return (
    <>
      <TableRow>
        <TableCell className="w-8">
          <Checkbox
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select upload ${item.filename || item.content_hash}`}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-muted">
          {formatDate(item.created_at)}
        </TableCell>
        <TableCell className="max-w-[16rem] truncate" title={item.filename}>
          {item.filename || "—"}
        </TableCell>
        <TableCell>{supplier}</TableCell>
        {showUploader && (
          <TableCell className="text-fg-muted">
            {item.uploaded_by_email || item.uploaded_by || "—"}
          </TableCell>
        )}
        <TableCell className="text-right">
          <MonoChip tone="neutral">{item.product_count}</MonoChip>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            aria-expanded={open}
          >
            {open ? "Hide" : "View listings"}
          </button>
          <button
            type="button"
            disabled={undo.isPending}
            onClick={() => setConfirmUndo(true)}
            className="ml-1 rounded px-2 py-1 text-xs font-medium text-danger-text hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:opacity-50"
            title="Delete this upload's listings and history entry"
          >
            {undo.isPending ? "Removing…" : "Undo"}
          </button>
          <Modal
            open={confirmUndo}
            onClose={() => setConfirmUndo(false)}
            title={`Undo "${item.filename || "this upload"}"?`}
            description={`The ${item.product_count} listing(s) it added will be permanently deleted (except any also produced by another upload), and the PDF can then be re-uploaded. This cannot be undone.`}
            footer={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmUndo(false)}
                  disabled={undo.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmUndo(false);
                    undo.mutate();
                  }}
                  disabled={undo.isPending}
                >
                  Undo upload
                </Button>
              </>
            }
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={colCount} className="bg-muted/50 p-0">
            <ListingDetail contentHash={item.content_hash} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Lazily fetches + renders the listings for one upload when its row expands.
 * Rows can be multi-selected and bulk-deleted (e.g. strip a few bad
 * extractions without undoing the whole upload). The page itself is
 * admin/manager-gated, matching the listing write permission.
 */
function ListingDetail({ contentHash }: { contentHash: string }) {
  const queryClient = useQueryClient();
  const selection = useSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Slide-in panel for editing one of this upload's listings in place.
  const [editId, setEditId] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["uploadListings", contentHash],
    queryFn: () => api.getUploadListings(contentHash),
    staleTime: 60_000,
  });

  const bulkDelete = useMutation({
    mutationFn: () => api.bulkDeleteListings([...selection.selected]),
    onSuccess: (res) => {
      toast.success(`${res.deleted} listing(s) deleted.`);
      selection.clear();
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["uploadListings", contentHash] });
      queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
      setConfirmOpen(false);
    },
  });

  if (isLoading) {
    return <p className="px-4 py-3 text-sm text-fg-muted">Loading listings…</p>;
  }
  if (isError) {
    return (
      <p className="px-4 py-3 text-sm text-danger-text">
        {error instanceof Error ? error.message : "Could not load listings"}
      </p>
    );
  }
  const listings = data?.listings ?? [];
  if (listings.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-fg-muted">
        No listings recorded for this upload.
      </p>
    );
  }

  const ids = listings.map((l) => l.id);
  const allSelected = ids.every((id) => selection.selected.has(id));

  return (
    <div className="space-y-2 px-4 py-3">
      <SelectionBar
        count={selection.count}
        noun="listing"
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-fg-subtle">
            <th className="w-8 py-1 pr-2">
              <Checkbox
                checked={allSelected}
                onChange={() => selection.toggleAll(ids)}
                aria-label={`Select all ${listings.length} listings from this upload`}
                title={`Select all ${listings.length}`}
              />
            </th>
            <th className="py-1 pr-4 font-medium">Name (EN)</th>
            <th className="py-1 pr-4 font-medium">As printed</th>
            <th className="py-1 pr-4 font-medium">CAS</th>
            <th className="py-1 pr-4 text-right font-medium">Price</th>
            <th className="py-1 pr-4 font-medium">Purity</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="w-8 py-1.5 pr-2">
                <Checkbox
                  checked={selection.selected.has(l.id)}
                  onChange={() => selection.toggle(l.id)}
                  aria-label={`Select ${l.name_en}`}
                />
              </td>
              <td className="py-1.5 pr-4 font-medium text-fg">
                {l.name_en}
                {l.needs_review && (
                  <Badge variant="warning" className="ml-2">
                    review
                  </Badge>
                )}
              </td>
              <td className="py-1.5 pr-4 text-fg-muted">{l.name_raw}</td>
              <td className="py-1.5 pr-4">
                {l.cas_number ? (
                  <MonoChip tone="cas">{l.cas_number}</MonoChip>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="py-1.5 pr-4 text-right">
                {l.price == null ? (
                  <span className="text-fg-subtle">—</span>
                ) : (
                  <MonoChip tone="price">
                    {`${l.price}${l.currency ? " " + l.currency : ""}`}
                  </MonoChip>
                )}
              </td>
              <td className="py-1.5 pr-4 text-fg-muted">{l.purity ?? "—"}</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => setEditId(l.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                  title="Open this listing with the edit form"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ListingPanel id={editId} edit onClose={() => setEditId(null)} />

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${selection.count} listing${selection.count === 1 ? "" : "s"}?`}
        description="The selected listings will be permanently removed from the database (the upload's history row stays). This cannot be undone."
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

function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-btn border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        active
          ? "border-brand bg-brand text-on-brand"
          : "border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-muted",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
