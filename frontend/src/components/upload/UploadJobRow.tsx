import { useEffect, useRef, useState } from "react";
import { Pause, Play, Ban, RotateCcw, Trash2, Loader2, Check } from "lucide-react";
import type { JobAction, UploadJob } from "@/types/chemical";

/** Actions that destroy work and so ask for a second click to confirm. */
const DESTRUCTIVE: ReadonlySet<JobAction> = new Set(["cancel", "remove"]);

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

  useEffect(() => {
    if (terminal) {
      setValue(100);
      return;
    }
    // Ease toward the target, then STOP: once the bar reaches the current
    // target there is nothing left to animate, so clear the interval rather
    // than keep firing a no-op every 120ms for the life of the row. A new
    // target (the next stage) remounts this effect and starts a fresh timer.
    const id = window.setInterval(() => {
      setValue((v) => {
        if (v >= target) {
          window.clearInterval(id);
          return target;
        }
        return Math.min(target, v + Math.max(0.4, (target - v) * 0.08));
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [target, terminal]);

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
  const [confirm, setConfirm] = useState<JobAction | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  async function run(action: JobAction) {
    setBusy(action);
    try {
      await onAction(job.id, action);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Destructive actions (cancel, remove) destroy work, so the first click arms
   * a confirm and the second within 3s commits — matching how Upload history
   * gates its undo/delete. Non-destructive actions run immediately.
   */
  function handle(action: JobAction) {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    if (DESTRUCTIVE.has(action) && confirm !== action) {
      setConfirm(action);
      confirmTimer.current = window.setTimeout(() => setConfirm(null), 3000);
      return;
    }
    setConfirm(null);
    run(action);
  }

  const barColor = job.duplicate
    ? "bg-line-strong"
    : BAR_COLORS[job.status] ?? "bg-fg-subtle";
  const label = job.duplicate ? "Duplicate" : STATUS_LABEL[job.status] ?? job.status;
  const stageText =
    job.status === "failed" && job.error ? job.error : job.stage;
  const pct = Math.min(100, Math.max(0, Math.round(value)));

  return (
    <li className="py-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg" title={job.filename}>
            {job.filename}
          </p>
          {/* Announce stage/status changes to screen readers as they happen. */}
          <p className="truncate text-xs text-fg-muted" aria-live="polite">
            {stageText}
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
            <IconBtn title="Pause" busy={busy === "pause"} onClick={() => handle("pause")}>
              <Pause className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_resume && (
            <IconBtn title="Resume" busy={busy === "resume"} onClick={() => handle("resume")}>
              <Play className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_restart && (
            <IconBtn title="Restart" busy={busy === "restart"} onClick={() => handle("restart")}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {job.can_cancel && (
            <IconBtn
              title={confirm === "cancel" ? "Click again to cancel" : "Cancel"}
              busy={busy === "cancel"}
              confirming={confirm === "cancel"}
              onClick={() => handle("cancel")}
              danger
            >
              <Ban className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          <IconBtn
            title={confirm === "remove" ? "Click again to remove" : "Remove"}
            busy={busy === "remove"}
            confirming={confirm === "remove"}
            onClick={() => handle("remove")}
            danger
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${job.filename} upload progress`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

function IconBtn({
  title,
  busy,
  danger,
  confirming,
  onClick,
  children,
}: {
  title: string;
  busy?: boolean;
  danger?: boolean;
  /** Armed for a confirm click — shows a check and a solid danger fill. */
  confirming?: boolean;
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
      // `.touch-target` grows the hit area to 44px on coarse pointers without
      // changing the 28px visual size — the dense controls stay tappable.
      className={[
        "touch-target inline-flex h-7 w-7 items-center justify-center rounded-btn border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:opacity-50",
        confirming
          ? "border-danger bg-danger text-on-danger"
          : danger
            ? "border-danger/30 text-danger-text hover:bg-danger-soft"
            : "border-line text-fg-muted hover:bg-hover",
      ].join(" ")}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : confirming ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        children
      )}
    </button>
  );
}
