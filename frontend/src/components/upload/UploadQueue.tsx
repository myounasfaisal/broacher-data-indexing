import { Loader2 } from "lucide-react";
import type { DocumentStatus } from "@/types/chemical";
import { UploadJobRow } from "./UploadJobRow";

/** A file that is still being sent from the browser (before it has a document). */
export interface UploadingItem {
  tempId: string;
  name: string;
}

/**
 * The upload progress list: one row per document, each tracking its real
 * pages-done progress from the DB status machine. Files still being sent from
 * the browser show as "Uploading…" placeholders until the server returns them.
 */
export function UploadQueue({
  documents,
  uploading = [],
  onCancel,
  onRestart,
}: {
  documents: DocumentStatus[];
  uploading?: UploadingItem[];
  onCancel: (id: string) => Promise<void> | void;
  onRestart: (id: string) => Promise<void> | void;
}) {
  if (documents.length === 0 && uploading.length === 0) return null;

  const active = documents.filter(
    (d) =>
      d.status === "pending" ||
      d.status === "splitting" ||
      d.status === "split" ||
      d.status === "extracting",
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
        {documents.map((doc) => (
          <UploadJobRow
            key={doc.id}
            doc={doc}
            onCancel={onCancel}
            onRestart={onRestart}
          />
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
