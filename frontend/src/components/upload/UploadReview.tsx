import { AlertTriangle, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

/** Above this many files, a selection is likely an accident (a whole folder). */
const CROWD_THRESHOLD = 25;

/**
 * The staging list: what the admin picked, shown BEFORE anything uploads. This
 * is the guardrail against the "pointed the folder picker at Downloads and
 * everything started uploading" trap — the files sit here, reviewable and
 * removable, until an explicit "Upload" click sends them.
 */
export function UploadReview({
  files,
  onRemove,
  onClear,
  onConfirm,
  busy,
}: {
  files: File[];
  onRemove: (index: number) => void;
  onClear: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  if (files.length === 0) return null;

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const crowded = files.length > CROWD_THRESHOLD;

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">
            {files.length} file{files.length === 1 ? "" : "s"} ready to upload
          </p>
          <p className="text-xs text-fg-muted">
            {formatBytes(totalBytes)} total · review before sending — nothing has
            uploaded yet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={busy}
          >
            Clear
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Uploading…
              </>
            ) : (
              <>
                <UploadCloud className="h-4 w-4" aria-hidden />
                Upload {files.length} file{files.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      </div>

      {crowded && (
        <p className="mb-3 flex items-start gap-2 rounded-btn bg-warn-soft px-3 py-2 text-xs text-warn-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            That&rsquo;s a lot of files — if you meant to pick just a few, remove
            the ones you don&rsquo;t want before uploading.
          </span>
        </p>
      )}

      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {files.map((file, i) => (
          <li
            key={`${file.name}-${i}`}
            className="flex items-center justify-between gap-3 rounded-btn px-2 py-1.5 hover:bg-hover"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileText
                className="h-4 w-4 shrink-0 text-fg-muted"
                aria-hidden
              />
              <span className="truncate text-sm text-fg" title={file.name}>
                {file.name}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs text-fg-muted">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name} from the list`}
                onClick={() => onRemove(i)}
                disabled={busy}
                className="touch-target rounded-btn p-1 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
