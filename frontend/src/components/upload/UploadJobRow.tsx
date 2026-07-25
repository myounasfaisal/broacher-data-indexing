import { useEffect, useRef, useState } from "react";
import { Ban, Check, Loader2, RotateCcw } from "lucide-react";
import type { DocumentStatus } from "@/types/chemical";

/**
 * One document's row in the upload progress list. Progress is REAL now (not a
 * fake creep): it tracks pages_done / page_count from the documents/pages status
 * machine. Controls are limited to what the worker model supports: Cancel (stop
 * after the current page — nothing already written is rolled back) and Restart
 * (re-queue a failed/cancelled document, resuming at its first incomplete page).
 */

const ACTIVE = new Set(["pending", "splitting", "split", "extracting"]);

const BAR_COLORS: Record<string, string> = {
  pending: "bg-fg-subtle",
  splitting: "bg-fg-subtle",
  split: "bg-fg-subtle",
  extracting: "bg-brand",
  done: "bg-ok-text",
  failed: "bg-danger",
  cancelled: "bg-line-strong",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  splitting: "Splitting pages",
  split: "Ready to extract",
  extracting: "Extracting",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Progress percent from the status machine. */
function percentFor(doc: DocumentStatus): number {
  if (doc.duplicate || doc.status === "done") return 100;
  if (doc.status === "failed" || doc.status === "cancelled") return 100;
  if (doc.status === "splitting" || doc.status === "pending") return 6;
  if (doc.page_count > 0) {
    return Math.max(10, Math.round((doc.pages_done / doc.page_count) * 100));
  }
  return 10;
}

function stageText(doc: DocumentStatus): string {
  if (doc.duplicate) return "Duplicate — this exact PDF was already processed; skipped.";
  switch (doc.status) {
    case "splitting":
      return "Splitting the PDF into page images…";
    case "split":
      return "Waiting for a worker to pick it up…";
    case "extracting":
      return `Extracting — ${doc.pages_done}/${doc.page_count} pages${
        doc.company_name ? ` · ${doc.company_name}` : ""
      }`;
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

export function UploadJobRow({
  doc,
  onCancel,
  onRestart,
}: {
  doc: DocumentStatus;
  onCancel: (id: string) => Promise<void> | void;
  onRestart: (id: string) => Promise<void> | void;
}) {
  const barColor = doc.duplicate
    ? "bg-line-strong"
    : BAR_COLORS[doc.status] ?? "bg-fg-subtle";
  const label = doc.duplicate ? "Duplicate" : STATUS_LABEL[doc.status] ?? doc.status;
  const pct = percentFor(doc);

  const [busy, setBusy] = useState<"cancel" | "restart" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const canCancel = ACTIVE.has(doc.status) && !doc.duplicate;
  const canRestart = doc.status === "failed" || doc.status === "cancelled";

  async function run(kind: "cancel" | "restart") {
    setBusy(kind);
    try {
      await (kind === "cancel" ? onCancel(doc.id) : onRestart(doc.id));
    } finally {
      setBusy(null);
    }
  }

  // Cancel destroys further processing, so first click arms, second within 3s commits.
  function handleCancel() {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    if (!confirmCancel) {
      setConfirmCancel(true);
      confirmTimer.current = window.setTimeout(() => setConfirmCancel(false), 3000);
      return;
    }
    setConfirmCancel(false);
    run("cancel");
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
          {canCancel && (
            <IconBtn
              title={confirmCancel ? "Click again to cancel" : "Cancel"}
              busy={busy === "cancel"}
              confirming={confirmCancel}
              danger
              onClick={handleCancel}
            >
              {confirmCancel ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
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
