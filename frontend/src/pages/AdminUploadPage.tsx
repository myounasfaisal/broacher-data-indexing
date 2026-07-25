import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Ban, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import type { JobAction } from "@/types/chemical";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderPicker } from "@/components/upload/FolderPicker";
import { UploadReview } from "@/components/upload/UploadReview";
import {
  UploadQueue,
  type UploadingItem,
} from "@/components/upload/UploadQueue";
import { UploadSummary } from "@/components/upload/UploadSummary";
import { UploadHistory } from "@/components/upload/UploadHistory";
import { PageHeader } from "@/components/layout/PageHeader";

// Client-side cap (fail fast). The backend enforces the real limit — keep this
// in sync with MAX_UPLOAD_SIZE_MB in the backend .env.
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

/** A file that never entered the server queue, kept visible with its reason. */
interface RejectedFile {
  id: string;
  name: string;
  reason: string;
}

/**
 * Admin/manager page: pick brochure PDFs and hand them to the SERVER-side
 * queue, which processes them one at a time and exposes per-file status + a
 * live stage line. Each file has its own progress bar and controls (pause /
 * resume / cancel / restart / remove). Because the queue lives on the server,
 * a page reload loses nothing — jobs keep processing and reappear on return.
 */
export default function AdminUploadPage() {
  const queryClient = useQueryClient();
  const { data: role } = useRole();
  const isAdmin = role === "admin";
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  // Files the admin picked but has NOT yet sent. They sit here for review so a
  // stray folder selection can be caught before a single byte is uploaded.
  const [staged, setStaged] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);
  // Files that never became a job — too large, or the enqueue call failed.
  // These persist in the surface (not just a toast) so a user who looked away
  // still sees which files didn't make it, and why.
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["uploadJobs"],
    queryFn: api.listUploadJobs,
    // Poll while anything is queued/processing; stop when the queue is idle.
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs;
      return jobs?.some(
        (j) => j.status === "queued" || j.status === "processing",
      )
        ? 1200
        : false;
    },
  });
  const jobs = data?.jobs ?? [];
  const active = jobs.some(
    (j) => j.status === "queued" || j.status === "processing",
  );
  const hasFinished = jobs.some(
    (j) =>
      j.status === "done" || j.status === "failed" || j.status === "cancelled",
  );

  // When the queue finishes processing, refresh the persistent history so the
  // just-completed uploads show up without a manual reload.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
    }
    wasActive.current = active;
  }, [active, queryClient]);

  const clearMutation = useMutation({
    mutationFn: api.clearFinishedJobs,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] }),
  });

  const cancelAllMutation = useMutation({
    mutationFn: api.cancelAllJobs,
    onSuccess: ({ cancelled }) => {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
      toast.success(
        cancelled > 0
          ? `Cancelled ${cancelled} file(s).`
          : "Nothing left to cancel.",
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Cancel failed"),
  });

  // Two-step confirm for the bulk stop — it kills every active job, so one
  // stray click shouldn't. First click arms; a second within 3s commits.
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);
  const cancelAllTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (cancelAllTimer.current) window.clearTimeout(cancelAllTimer.current);
    },
    [],
  );
  function handleCancelAll() {
    if (cancelAllTimer.current) window.clearTimeout(cancelAllTimer.current);
    if (!confirmCancelAll) {
      setConfirmCancelAll(true);
      cancelAllTimer.current = window.setTimeout(
        () => setConfirmCancelAll(false),
        3000,
      );
      return;
    }
    setConfirmCancelAll(false);
    cancelAllMutation.mutate();
  }

  /** Apply a control action to one job, then refresh the queue. */
  async function handleAction(id: string, action: JobAction) {
    try {
      await api.jobAction(id, action);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
    }
  }

  /** Record a file that couldn't be queued, in the surface and as a toast. */
  function reject(name: string, reason: string) {
    setRejected((prev) => [
      ...prev,
      { id: `${name}-${Date.now()}-${Math.random()}`, name, reason },
    ]);
    toast.error(`${name}: ${reason}`);
  }

  /**
   * A selection (browse or drop) STAGES files for review — it does not upload.
   * New files are appended to the review list.
   */
  function stageFiles(files: File[]) {
    if (files.length === 0) {
      toast.info("No PDF files found in the selection.");
      return;
    }
    setStaged((prev) => [...prev, ...files]);
  }

  /** Validate client-side, then enqueue every STAGED file on the server. */
  async function startUpload() {
    const files = staged;
    if (files.length === 0) return;
    // A fresh upload supersedes the previous batch's rejections.
    setRejected([]);
    setIsSending(true);
    let queued = 0;
    for (const file of files) {
      if (file.size > MAX_SIZE_BYTES) {
        reject(file.name, "exceeds the 20MB limit");
        continue;
      }
      const tempId = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploading((prev) => [...prev, { tempId, name: file.name }]);
      try {
        await api.enqueueUpload(file);
        queued++;
      } catch (err) {
        reject(file.name, err instanceof Error ? err.message : "upload failed");
      } finally {
        setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      }
    }
    setStaged([]);
    setIsSending(false);
    // One refresh after the batch, not one per file.
    if (queued > 0) {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
      toast.success(
        `${queued} file(s) queued — processing continues even if you reload or leave this page.`,
      );
    }
  }

  const showCard = jobs.length > 0 || uploading.length > 0 || isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload brochures"
        description="Drop or pick brochures, review the list, then upload — each is processed in memory and never stored."
      />

      <Card>
        <CardHeader>
          <CardTitle>Select brochures to upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FolderPicker onFiles={stageFiles} disabled={isSending} />
          <UploadReview
            files={staged}
            onRemove={(i) =>
              setStaged((prev) => prev.filter((_, idx) => idx !== i))
            }
            onClear={() => setStaged([])}
            onConfirm={startUpload}
            busy={isSending}
          />
          <p className="text-xs text-fg-muted">
            Drop a <strong className="font-medium text-fg">folder</strong> or{" "}
            <strong className="font-medium text-fg">PDF files</strong>, review the
            list, then upload. Each file is queued on the server and shows its own
            progress; you can <strong className="font-medium text-fg">pause,
            resume, cancel, restart or remove</strong> any file, or{" "}
            <strong className="font-medium text-fg">cancel everything at once</strong>.
            The queue <strong className="font-medium text-fg">survives page
            reloads</strong>. Only{" "}
            <code className="rounded bg-muted px-1 font-mono text-[0.9em] text-fg">.pdf</code> files
            are processed; each is sent to the AI model in memory and never
            stored.
          </p>
        </CardContent>
      </Card>

      {rejected.length > 0 && (
        <div className="rounded-card border border-danger/30 bg-danger-soft p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-danger-text">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {rejected.length} file{rejected.length === 1 ? "" : "s"} weren&rsquo;t queued
            </p>
            <button
              type="button"
              onClick={() => setRejected([])}
              className="rounded-btn px-2 py-0.5 text-xs font-medium text-danger-text hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              Dismiss all
            </button>
          </div>
          <ul className="space-y-1">
            {rejected.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 text-xs text-danger-text"
              >
                <span className="min-w-0 truncate" title={r.name}>
                  <span className="font-medium">{r.name}</span> — {r.reason}
                </span>
                <button
                  type="button"
                  aria-label={`Dismiss ${r.name}`}
                  onClick={() =>
                    setRejected((prev) => prev.filter((x) => x.id !== r.id))
                  }
                  className="touch-target shrink-0 rounded-btn p-1 hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showCard && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Progress</CardTitle>
              <div className="flex items-center gap-2">
                {active && (
                  <Button
                    variant={confirmCancelAll ? "destructive" : "outline"}
                    size="sm"
                    onClick={handleCancelAll}
                    disabled={cancelAllMutation.isPending}
                  >
                    {confirmCancelAll ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : (
                      <Ban className="h-4 w-4" aria-hidden />
                    )}
                    {confirmCancelAll ? "Click again to cancel all" : "Cancel all"}
                  </Button>
                )}
                {hasFinished && !active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearMutation.mutate()}
                    disabled={clearMutation.isPending}
                  >
                    Clear finished
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && jobs.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-muted">
                Loading queue…
              </p>
            ) : (
              <>
                <UploadQueue
                  jobs={jobs}
                  uploading={uploading}
                  onAction={handleAction}
                />
                <UploadSummary jobs={jobs} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload history</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-fg-muted">
            Past uploads and how many listings each added.{" "}
            {isAdmin
              ? "As an admin you can see everyone's uploads (who, when) and expand any row to see exactly which listings were added."
              : "Expand a row to see which listings that upload added."}{" "}
            This history is saved on the server and persists across restarts.
          </p>
          <UploadHistory isAdmin={isAdmin} />
        </CardContent>
      </Card>
    </div>
  );
}
