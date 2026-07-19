import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { MonoChip } from "@/components/ui/mono-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectionBar } from "@/components/ui/selection-bar";
import { Pagination } from "@/components/search/Pagination";
import { ListingPanel } from "@/components/listing/ListingPanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { useSelection } from "@/hooks/useSelection";
import type { ReviewItem } from "@/types/chemical";

/**
 * Review queue (admin + manager): every listing flagged needs_review — the
 * app's ONE review flag, set when the fuzzy matcher tied a product to its
 * chemical by name similarity — newest first, grouped by the source PDF.
 *
 * Resolving keeps the existing flag semantics (no second flagging system):
 *  - "Mark verified" clears needs_review (the existing PATCH),
 *  - "Open" shows the product in the slide-in panel, where the edit card can
 *    correct fields (and the flag) before clearing,
 *  - select rows → "Delete selected" removes bad listings,
 *  - "Delete file" undoes the whole source upload (existing undo endpoint,
 *    shared-listing safe; managers can only undo their own uploads).
 */
export default function ReviewQueuePage() {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openEdit, setOpenEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Source upload pending "Delete file" confirmation (null = closed).
  const [confirmFile, setConfirmFile] = useState<{
    hash: string;
    filename: string;
    flagged: number;
  } | null>(null);
  const selection = useSelection();
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["reviewQueue", page],
    queryFn: () => api.listReviewQueue(page),
  });

  // Never sit on a page past the end after resolving shrinks the set.
  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["reviewQueue"] });
    queryClient.invalidateQueries({ queryKey: ["search"] });
    queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
    queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
    queryClient.invalidateQueries({ queryKey: ["uploadListings"] });
  };

  // Clear the flag on one listing — the lightweight "verified" resolution.
  const verify = useMutation({
    mutationFn: (id: string) => api.updateListing(id, { needs_review: false }),
    onSuccess: () => {
      toast.success("Marked verified.");
      invalidateAll();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not mark verified"),
  });

  // Bulk verify: same PATCH per id, sequentially (no bulk endpoint needed).
  const verifySelected = useMutation({
    mutationFn: async (ids: string[]) => {
      let done = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try {
          await api.updateListing(id, { needs_review: false });
          done++;
        } catch {
          failed.push(id);
        }
      }
      return { done, failed };
    },
    onSuccess: (res) => {
      if (res.failed.length === 0) {
        toast.success(`${res.done} listing(s) marked verified.`);
      } else {
        toast.error(
          `${res.done} marked verified; ${res.failed.length} failed.`,
        );
      }
      selection.clear();
      invalidateAll();
    },
  });

  const deleteSelected = useMutation({
    mutationFn: () => api.bulkDeleteListings([...selection.selected]),
    onSuccess: (res) => {
      toast.success(`${res.deleted} listing(s) deleted.`);
      if (openId && selection.selected.has(openId)) setOpenId(null);
      selection.clear();
      setConfirmDelete(false);
      invalidateAll();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
      setConfirmDelete(false);
    },
  });

  // "Delete file": undo the whole source upload via the existing endpoint
  // (shared-listing safe; admin=any upload, manager=own uploads only).
  const deleteFile = useMutation({
    mutationFn: (hash: string) => api.undoUpload(hash),
    onSuccess: (res) => {
      toast.success(
        `Upload removed — ${res.deleted_listings} listing(s) deleted` +
          (res.kept_shared
            ? `, ${res.kept_shared} kept (shared with other uploads)`
            : ""),
      );
      setConfirmFile(null);
      selection.clear();
      setOpenId(null);
      invalidateAll();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not delete the file");
      setConfirmFile(null);
    },
  });

  const items = data?.items ?? [];
  const groups = groupBySource(items);
  const busy =
    verify.isPending ||
    verifySelected.isPending ||
    deleteSelected.isPending ||
    deleteFile.isPending;

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Listings the AI matched by name similarity — verify, correct, or delete them (or their whole source file)."
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          {isPending && (
            <div aria-hidden className="space-y-3 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          )}
          {isError && (
            <p className="py-8 text-center text-sm text-danger-text">
              {error instanceof Error ? error.message : "Could not load the queue"}
            </p>
          )}

          {data && items.length === 0 && (
            <EmptyState
              icon={ShieldCheck}
              title="Nothing needs review"
              description="Every listing's chemical match has been verified."
            />
          )}

          {data && items.length > 0 && (
            <>
              <div className="flex items-center justify-between text-sm text-fg-muted">
                <span>
                  {data.count} listing{data.count === 1 ? "" : "s"} awaiting
                  review
                </span>
                {data.total_pages > 1 && (
                  <span>
                    Page {data.page} of {data.total_pages}
                  </span>
                )}
              </div>

              <SelectionBar
                count={selection.count}
                noun="listing"
                scopeHint="selections keep across pages"
                onClear={selection.clear}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => verifySelected.mutate([...selection.selected])}
                  disabled={busy}
                >
                  Mark verified
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  Delete selected
                </Button>
              </SelectionBar>

              {groups.map((group) => (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-card border border-line"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-line bg-muted/60 px-3 py-2">
                    <FileText className="h-4 w-4 shrink-0 text-fg-subtle" />
                    <span
                      className="max-w-[24rem] truncate text-sm font-medium text-fg"
                      title={group.filename ?? undefined}
                    >
                      {group.filename || "Unknown source (older upload)"}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {group.items.length} flagged on this page
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <Checkbox
                        checked={group.items.every((i) =>
                          selection.selected.has(i.id),
                        )}
                        onChange={() =>
                          selection.toggleAll(group.items.map((i) => i.id))
                        }
                        aria-label={`Select all ${group.items.length} flagged listings from this file`}
                        title="Select all from this file"
                      />
                      {group.hash && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-danger/40 text-danger-text hover:border-danger/60 hover:bg-danger-soft"
                          disabled={busy}
                          onClick={() =>
                            setConfirmFile({
                              hash: group.hash!,
                              filename: group.filename || "this upload",
                              flagged: group.items.length,
                            })
                          }
                          title="Undo this whole upload — deletes every listing it added"
                        >
                          Delete file
                        </Button>
                      )}
                    </div>
                  </div>

                  <ul className="divide-y divide-line">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                      >
                        <Checkbox
                          checked={selection.selected.has(item.id)}
                          onChange={() => selection.toggle(item.id)}
                          aria-label={`Select ${item.name_en}`}
                        />
                        <div className="min-w-0 flex-1 basis-52">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenEdit(false);
                              setOpenId(item.id);
                            }}
                            className="text-left text-sm font-medium text-brand-text hover:underline"
                            title="Open details"
                          >
                            {item.name_en}
                          </button>
                          {item.name_raw !== item.name_en && (
                            <p className="truncate text-xs text-fg-muted">
                              {item.name_raw}
                            </p>
                          )}
                        </div>
                        <div className="hidden sm:block">
                          {item.cas_number ? (
                            <MonoChip tone="cas">{item.cas_number}</MonoChip>
                          ) : (
                            <span className="text-xs text-fg-subtle">no CAS</span>
                          )}
                        </div>
                        <span className="hidden max-w-[14rem] truncate text-xs text-fg-muted lg:block">
                          {item.company_name_en || item.company_name || "—"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setOpenEdit(true);
                            setOpenId(item.id);
                          }}
                          title="Open with the edit form"
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => verify.mutate(item.id)}
                        >
                          Mark verified
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <Pagination
                page={data.page}
                totalPages={data.total_pages}
                onPage={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ListingPanel
        id={openId}
        edit={openEdit}
        onClose={() => setOpenId(null)}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selection.count} listing${selection.count === 1 ? "" : "s"}?`}
        description="The selected listings will be permanently removed from the database. This cannot be undone."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteSelected.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteSelected.mutate()}
              disabled={deleteSelected.isPending}
            >
              {deleteSelected.isPending
                ? "Deleting…"
                : `Delete ${selection.count} listing${selection.count === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      />

      <Modal
        open={confirmFile !== null}
        onClose={() => setConfirmFile(null)}
        title={`Delete "${confirmFile?.filename ?? ""}"?`}
        description="This undoes the whole upload: EVERY listing it added is permanently deleted (not just the flagged ones; listings shared with another upload are kept), and its history row is removed so the PDF can be re-uploaded. Managers can only delete their own uploads."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmFile(null)}
              disabled={deleteFile.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => confirmFile && deleteFile.mutate(confirmFile.hash)}
              disabled={deleteFile.isPending}
            >
              {deleteFile.isPending ? "Deleting…" : "Delete file"}
            </Button>
          </>
        }
      />
    </div>
  );
}

interface SourceGroup {
  key: string;
  hash: string | null;
  filename: string | null;
  items: ReviewItem[];
}

/** Group a page of flagged listings by their source upload, page order kept. */
function groupBySource(items: ReviewItem[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const item of items) {
    const key = item.source_content_hash ?? "unknown";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        hash: item.source_content_hash,
        filename: item.source_filename,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
