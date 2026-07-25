import { Loader2 } from "lucide-react";
import type { JobAction, UploadJob } from "@/types/chemical";
import { UploadJobRow } from "./UploadJobRow";

/** A file that is still being sent from the browser (before it has a job). */
export interface UploadingItem {
  tempId: string;
  name: string;
}

/**
 * The upload queue: one row PER FILE, each with its own animated progress bar
 * and control buttons. Files still being sent from the browser show as
 * "Uploading…" placeholders until the server returns their job.
 */
export function UploadQueue({
  jobs,
  uploading = [],
  onAction,
}: {
  jobs: UploadJob[];
  uploading?: UploadingItem[];
  onAction: (id: string, action: JobAction) => Promise<void> | void;
}) {
  if (jobs.length === 0 && uploading.length === 0) return null;

  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "processing" || j.status === "paused",
  ).length;

  return (
    <div className="space-y-2">
      {(active > 0 || uploading.length > 0) && (
        <p className="text-xs text-fg-muted">
          {uploading.length > 0 && <>{uploading.length} uploading · </>}
          {active} in progress
        </p>
      )}
      <ul className="divide-y divide-line">
        {jobs.map((job) => (
          <UploadJobRow key={job.id} job={job} onAction={onAction} />
        ))}
        {uploading.map((u) => (
          <li key={u.tempId} className="py-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-fg" title={u.name}>
                {u.name}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
              </span>
            </div>
            {/* Indeterminate: the file is still being sent, so there is no real
                percentage — omit aria-valuenow rather than assert a fake one. */}
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${u.name} uploading`}
              aria-valuetext="Uploading"
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-fg-subtle" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
