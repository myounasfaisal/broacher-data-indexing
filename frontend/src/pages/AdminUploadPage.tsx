import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { JobAction } from "@/types/chemical";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderPicker } from "@/components/upload/FolderPicker";
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

  /** Validate client-side, then enqueue every file on the server. */
  async function handleFiles(files: File[]) {
    if (files.length === 0) {
      toast.info("No PDF files found in the selection.");
      return;
    }
    let queued = 0;
    for (const file of files) {
      if (file.size > MAX_SIZE_BYTES) {
        toast.error(`${file.name}: exceeds the 20MB limit.`);
        continue;
      }
      const tempId = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploading((prev) => [...prev, { tempId, name: file.name }]);
      try {
        await api.enqueueUpload(file);
        queued++;
        queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
      } catch (err) {
        toast.error(
          `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`,
        );
      } finally {
        setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      }
    }
    if (queued > 0) {
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
        description="Pick a folder or individual PDFs — each is processed in memory and never stored."
      />

      <Card>
        <CardHeader>
          <CardTitle>Select brochures to upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FolderPicker onFiles={handleFiles} disabled={uploading.length > 0} />
          <p className="text-xs text-fg-muted">
            Pick an entire <strong className="font-medium text-fg">folder</strong> or one / multiple individual
            <strong className="font-medium text-fg"> PDF files</strong>. Each file is queued on the server and
            shows its own progress; you can <strong className="font-medium text-fg">pause, resume, cancel,
            restart or remove</strong> any file. The queue{" "}
            <strong className="font-medium text-fg">survives page reloads</strong>. Only{" "}
            <code className="rounded bg-muted px-1 font-mono text-[0.9em] text-fg">.pdf</code> files
            are processed; each is sent to the AI model in memory and never
            stored.
          </p>
        </CardContent>
      </Card>

      {showCard && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Progress</CardTitle>
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
