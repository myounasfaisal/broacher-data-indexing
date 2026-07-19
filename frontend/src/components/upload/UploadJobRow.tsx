import { useEffect, useRef, useState } from "react";
import { Pause, Play, Ban, RotateCcw, Trash2, Loader2 } from "lucide-react";
import type { JobAction, UploadJob } from "@/types/chemical";

/**
 * One file's row in the upload queue: its own animated progress bar plus the
 * control buttons valid for its current state (pause / resume / cancel /
 * restart / remove). The progress is an estimate ("fake loading") — real
 * extraction is a single opaque AI call — driven by the job's stage:
 * queued → creeps up during extraction → tracks "saving product i/N" → 100%.
 */

const BAR_COLORS: Record<string, string> = {
  queued: "bg-fg-subtle",
  processing: "bg-brand",
  paused: "bg-warn-text",
  done: "bg-ok-text",
  failed: "bg-danger",
  cancelled: "bg-line-strong",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Where the bar should ease toward, based on the job's status + stage text. */
function targetFor(job: UploadJob): number {
  if (job.duplicate) return 100;
  switch (job.status) {
    case "done":
    case "failed":
    case "cancelled":
      return 100; // terminal — full bar in the status color
    case "queued":
      return 6;
    case "paused":
      return 6;
    case "processing": {
      const s = job.stage.toLowerCase();
      const m = s.match(/saving product\s+(\d+)\s*\/\s*(\d+)/);
      if (m) {
        const [, i, n] = m;
        const frac = Number(n) > 0 ? Number(i) / Number(n) : 0;
        return 50 + Math.round(frac * 45); // 50–95% across the products
      }
      if (s.includes("resolving") || s.includes("found")) return 50;
      if (s.includes("cancel") || s.includes("removing")) return 96;
      return 88; // extracting — slow crawl toward 88%
    }
    default:
      return 0;
  }
}

function useFakeProgress(job: UploadJob): number {
  const terminal =
    job.status === "done" ||
    job.status === "failed" ||
    job.status === "cancelled" ||
    job.duplicate;
  const target = targetFor(job);
  const [value, setValue] = useState(terminal ? 100 : Math.min(target, 8));
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (terminal) {
      setValue(100);
      return;
    }
    const id = window.setInterval(() => {
      setValue((v) => {
        if (v >= target) return target;
        // Ease toward the target with a small floor so it always inches up.
        return Math.min(target, v + Math.max(0.4, (target - v) * 0.08));
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [target, terminal]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  return value;
}

export function UploadJobRow({
  job,
  onAction,
}: {
  job: UploadJob;
  onAction: (id: string, action: JobAction) => Promise<void> | void;
}) {
  const value = useFakeProgress(job);
  const [busy, setBusy] = useState<JobAction | null>(null);

  async function run(action: JobAction) {
    setBusy(action);
    try {
      await onAction(job.id, action);
    } finally {
      setBusy(null);
    }
  }

  const barColor = job.duplicate
    ? "bg-line-strong"
    : BAR_COLORS[job.status] ?? "bg-fg-subtle";
  const label = job.duplicate ? "Duplicate" : STATUS_LABEL[job.status] ?? job.status;

  return (
    <li className="py-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{job.filename}</p>
          <p className="truncate text-xs text-fg-muted">
            {job.status === "failed" && job.error ? job.error : job.stage}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              job.status === "failed"
                ? "bg-danger-soft text-danger-text"
                : job.status === "done"
                  ? "bg-ok-soft text-ok-text"
                  : job.status === "processing"
                    ? "bg-brand-soft text-brand-soft-text"
                    : "bg-muted text-fg-muted",
            ].join(" ")}
          >
            {label}
          </span>
          {job.can_pause && (
            <IconBtn title="Pause" busy={busy === "pause"} onClick={() => run("pause")}>
              <Pause className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_resume && (
            <IconBtn title="Resume" busy={busy === "resume"} onClick={() => run("resume")}>
              <Play className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_restart && (
            <IconBtn title="Restart" busy={busy === "restart"} onClick={() => run("restart")}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_cancel && (
            <IconBtn
              title="Cancel"
              busy={busy === "cancel"}
              onClick={() => run("cancel")}
              danger
            >
              <Ban className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          <IconBtn title="Remove" busy={busy === "remove"} onClick={() => run("remove")}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </li>
  );
}

function IconBtn({
  title,
  busy,
  danger,
  onClick,
  children,
}: {
  title: string;
  busy?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-btn border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:opacity-50",
        danger
          ? "border-danger/30 text-danger-text hover:bg-danger-soft"
          : "border-line text-fg-muted hover:bg-hover",
      ].join(" ")}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}
