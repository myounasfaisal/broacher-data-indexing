import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
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

const ACTIVE_STATUSES = ["pending", "splitting", "split", "extracting"] as const;

/** A file that never entered the pipeline, kept visible with its reason. */
interface RejectedFile {
  id: string;
  name: string;
  reason: string;
}

/**
 * Admin/manager page: pick brochure PDFs and hand them to the DB-worker
 * pipeline. Each upload creates a `documents` row, is split into page images in
 * Storage, and is extracted by the background worker. Progress (splitting →
 * extracting → done, with a real pages-done bar) is read from the DB, so a page
 * reload — or even a backend restart — loses nothing.
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
  // Files that never entered the pipeline — too large, or the upload call failed.
  const [rejected, setRejected] = useState<RejectedFile[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["uploadJobs"],
    queryFn: api.listUploadJobs,
    // Poll while anything is still splitting/extracting; stop when all terminal.
    refetchInterval: (query) => {
      const docs = query.state.data?.documents;
      return docs?.some((d) => ACTIVE_STATUSES.includes(d.status as never))
        ? 1500
        : false;
    },
  });
  const documents = data?.documents ?? [];
  const active = documents.some((d) =>
    ACTIVE_STATUSES.includes(d.status as never),
  );

  // When the batch finishes processing, refresh the persistent history so the
  // just-completed uploads show up without a manual reload.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      queryClient.invalidateQueries({ queryKey: ["uploadHistory"] });
    }
    wasActive.current = active;
  }, [active, queryClient]);

  /** Cancel a document (worker stops after the current page; keeps what's saved). */
  async function handleCancel(id: string) {
    try {
      await api.cancelDocument(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
    }
  }

  /** Restart a failed/cancelled document from its first incomplete page. */
  async function handleRestart(id: string) {
    try {
      await api.restartDocument(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
    }
  }

  /** Record a file that couldn't be uploaded, in the surface and as a toast. */
  function reject(name: string, reason: string) {
    setRejected((prev) => [
      ...prev,
      { id: `${name}-${Date.now()}-${Math.random()}`, name, reason },
    ]);
    toast.error(`${name}: ${reason}`);
  }

  /**
   * A selection (browse or drop) STAGES files for review — it does not upload.
   */
  function stageFiles(files: File[]) {
    if (files.length === 0) {
      toast.info("No PDF files found in the selection.");
      return;
    }
    setStaged((prev) => [...prev, ...files]);
  }

  /** Validate client-side, then upload every STAGED file. */
  async function startUpload() {
    const files = staged;
    if (files.length === 0) return;
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
    if (queued > 0) {
      queryClient.invalidateQueries({ queryKey: ["uploadJobs"] });
      toast.success(
        `${queued} file(s) uploaded — the worker extracts them in the background; progress keeps updating even if you reload or leave.`,
      );
    }
  }

  const showCard = documents.length > 0 || uploading.length > 0 || isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload brochures"
        description="Drop or pick brochures, review the list, then upload — each is split into pages and extracted by the background worker."
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
            list, then upload. Each file is split into page images and handed to
            the background worker, which extracts it page by page. Progress is
            stored in the database, so it{" "}
            <strong className="font-medium text-fg">survives page reloads</strong>{" "}
            and backend restarts. Only{" "}
            <code className="rounded bg-muted px-1 font-mono text-[0.9em] text-fg">.pdf</code>{" "}
            files are processed.
          </p>
        </CardContent>
      </Card>

      {rejected.length > 0 && (
        <div className="rounded-card border border-danger/30 bg-danger-soft p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-danger-text">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {rejected.length} file{rejected.length === 1 ? "" : "s"} weren&rsquo;t uploaded
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
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && documents.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-muted">
                Loading…
              </p>
            ) : (
              <>
                <UploadQueue
                  documents={documents}
                  uploading={uploading}
                  onCancel={handleCancel}
                  onRestart={handleRestart}
                />
                <UploadSummary documents={documents} />
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
