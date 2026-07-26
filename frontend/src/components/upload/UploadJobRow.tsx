import { useEffect, useRef, useState } from "react";
import { Ban, Check, Loader2, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import type { DocumentStatus } from "@/types/chemical";

/**
 * One document's row in the upload progress list. Progress is REAL now (not a
 * fake creep): it tracks pages_done / page_count from the documents/pages status
 * machine. Controls are limited to what the worker model supports: Cancel (stop
 * after the current page — nothing already written is rolled back) and Restart
 * (re-queue a failed/cancelled document, resuming at its first incomplete page).
 *
 * A 'staged' document hasn't started: it is waiting for "Start processing", so
 * its only control is Discard (delete it outright — safe, nothing has run yet).
 */

// Statuses where the worker still has (or will have) work to do. 'staged' is
// deliberately NOT here — it is waiting on the user, not on a worker.
const ACTIVE = new Set(["pending", "splitting", "split", "extracting"]);

const BAR_COLORS: Record<string, string> = {
  staged: "bg-line-strong",
  pending: "bg-fg-subtle",
  splitting: "bg-fg-subtle",
  split: "bg-fg-subtle",
  extracting: "bg-brand",
  paused: "bg-warn-text",
  done: "bg-ok-text",
  failed: "bg-danger",
  cancelled: "bg-line-strong",
};

const STATUS_LABEL: Record<string, string> = {
  staged: "Ready to start",
  pending: "Queued",
  splitting: "Preparing",
  split: "Ready to extract",
  extracting: "Extracting",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Progress percent from the status machine. */
function percentFor(doc: DocumentStatus): number {
  if (doc.duplicate || doc.status === "done") return 100;
  if (doc.status === "failed" || doc.status === "cancelled") return 100;
  // Staged = uploaded but not started. An empty bar is the honest reading.
  if (doc.status === "staged") return 0;
  if (doc.status === "splitting" || doc.status === "pending") return 6;
  if (doc.page_count > 0) {
    return Math.max(10, Math.round((doc.pages_done / doc.page_count) * 100));
  }
  return 10;
}

function stageText(doc: DocumentStatus): string {
  if (doc.duplicate) return "Duplicate — this exact PDF was already processed; skipped.";
  switch (doc.status) {
    case "staged":
      return "Uploaded — waiting for you to start processing.";
    case "splitting":
      return "Preparing the upload…";
    case "pending":
      return "Queued — waiting for a worker.";
    case "split":
      return "Ready — waiting for a worker to pick it up…";
    case "extracting":
      return `Extracting — ${doc.pages_done}/${doc.page_count} pages${
        doc.company_name ? ` · ${doc.company_name}` : ""
      }`;
    case "paused":
      return `Paused${
        doc.product_count ? ` — ${doc.product_count} product(s) saved so far` : ""
      }.`;
    case "done":
      return `${doc.product_count} product(s) saved${
        doc.company_name ? ` from ${doc.company_name}` : ""
      }`;
    case "failed":
      return "Extraction failed — restart to try again.";
    case "cancelled":
      return `Cancelled${
        doc.product_count ? ` — ${doc.product_count} product(s) were already saved` : ""
      }.`;
    default:
      return "Queued";
  }
}

type Control = "pause" | "resume" | "cancel" | "restart" | "discard";

export function UploadJobRow({
  doc,
  onPause,
  onResume,
  onCancel,
  onRestart,
  onDiscard,
}: {
  doc: DocumentStatus;
  onPause: (id: string) => Promise<void> | void;
  onResume: (id: string) => Promise<void> | void;
  onCancel: (id: string) => Promise<void> | void;
  onRestart: (id: string) => Promise<void> | void;
  onDiscard: (id: string) => Promise<void> | void;
}) {
  const barColor = doc.duplicate
    ? "bg-line-strong"
    : BAR_COLORS[doc.status] ?? "bg-fg-subtle";
  const label = doc.duplicate ? "Duplicate" : STATUS_LABEL[doc.status] ?? doc.status;
  const pct = percentFor(doc);

  const [busy, setBusy] = useState<Control | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "discard" | null>(null);
  const confirmTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const canPause = ACTIVE.has(doc.status) && !doc.duplicate;
  const canResume = doc.status === "paused";
  // A paused doc can also be cancelled; duplicates never have controls.
  const canCancel = (ACTIVE.has(doc.status) || doc.status === "paused") && !doc.duplicate;
  const canRestart = doc.status === "failed" || doc.status === "cancelled";
  // Discard only before anything has run — afterwards it's cancel + undo.
  const canDiscard = doc.status === "staged" && !doc.duplicate;

  const HANDLERS: Record<Control, (id: string) => Promise<void> | void> = {
    pause: onPause,
    resume: onResume,
    cancel: onCancel,
    restart: onRestart,
    discard: onDiscard,
  };

  async function run(kind: Control) {
    setBusy(kind);
    try {
      await HANDLERS[kind](doc.id);
    } finally {
      setBusy(null);
    }
  }

  // Cancel and Discard are destructive, so the first click arms and a second
  // within 3s commits.
  function armOrRun(kind: "cancel" | "discard") {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    if (confirming !== kind) {
      setConfirming(kind);
      confirmTimer.current = window.setTimeout(() => setConfirming(null), 3000);
      return;
    }
    setConfirming(null);
    run(kind);
  }

  return (
    <li className="py-3">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg" title={doc.filename}>
            {doc.filename}
          </p>
          <p className="truncate text-xs text-fg-muted" aria-live="polite">
            {stageText(doc)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              doc.status === "failed"
                ? "bg-danger-soft text-danger-text"
                : doc.status === "done"
                  ? "bg-ok-soft text-ok-text"
                  : doc.status === "extracting"
                    ? "bg-brand-soft text-brand-soft-text"
                    : "bg-muted text-fg-muted",
            ].join(" ")}
          >
            {label}
          </span>
          {canPause && (
            <IconBtn title="Pause" busy={busy === "pause"} onClick={() => run("pause")}>
              <Pause className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {canResume && (
            <IconBtn title="Resume" busy={busy === "resume"} onClick={() => run("resume")}>
              <Play className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {canCancel && (
            <IconBtn
              title={confirming === "cancel" ? "Click again to cancel" : "Cancel"}
              busy={busy === "cancel"}
              confirming={confirming === "cancel"}
              danger
              onClick={() => armOrRun("cancel")}
            >
              {confirming === "cancel" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Ban className="h-3.5 w-3.5" />
              )}
            </IconBtn>
          )}
          {canDiscard && (
            <IconBtn
              title={
                confirming === "discard"
                  ? "Click again to discard this upload"
                  : "Discard — delete this upload without processing it"
              }
              busy={busy === "discard"}
              confirming={confirming === "discard"}
              danger
              onClick={() => armOrRun("discard")}
            >
              {confirming === "discard" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </IconBtn>
          )}
          {canRestart && (
            <IconBtn title="Restart" busy={busy === "restart"} onClick={() => run("restart")}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${doc.filename} extraction progress`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
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
      className={[
        "touch-target inline-flex h-7 w-7 items-center justify-center rounded-btn border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 disabled:opacity-50",
        confirming
          ? "border-danger bg-danger text-on-danger"
          : danger
            ? "border-danger/30 text-danger-text hover:bg-danger-soft"
            : "border-line text-fg-muted hover:bg-hover",
      ].join(" ")}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}
