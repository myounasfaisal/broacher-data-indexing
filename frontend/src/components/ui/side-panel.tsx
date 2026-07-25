import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Everything focusable we care about trapping, in DOM order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Generic right-side slide-in drawer — the shell shared by the product panel
 * and the supplier panel so every "details from the right" surface behaves
 * identically: drawer in a portal over a scrim, closes on Escape, scrim click,
 * or the X; locks body scroll.
 *
 * Because it declares `aria-modal`, it has to earn that: focus moves in on
 * open, is trapped while open, and returns to whatever opened it on close,
 * and the rest of the app is marked `inert` so it stays out of the tab order
 * and the accessibility tree rather than just being visually dimmed.
 */
export function SidePanel({
  open,
  onClose,
  title,
  headerActions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional extra controls rendered left of the close button. */
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Remember what had focus so we can hand it back on close — otherwise a
    // keyboard user restarts tabbing from the top of the document.
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      // Wrap at both ends. Focus that has escaped the panel entirely (portals
      // and async content can do this) gets pulled back to the near edge.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    // Hide the rest of the app from AT and the tab order. The portal renders
    // into <body>, so inerting the app root leaves the drawer itself active.
    const appRoot = document.getElementById("root");
    appRoot?.setAttribute("inert", "");

    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      appRoot?.removeAttribute("inert");
      // Only restore if the opener is still in the document; a row that was
      // re-rendered away can't take focus back.
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 scrim animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-line bg-elevated shadow-pop animate-slide-in-right"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold tracking-tight text-fg">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-fg-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
