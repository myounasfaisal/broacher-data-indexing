import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Generic right-side slide-in drawer — the shell shared by the product panel
 * and the supplier panel so every "details from the right" surface behaves
 * identically: glass drawer in a portal over a scrim, closes on Escape,
 * scrim click, or the X; locks body scroll; moves focus in on open.
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // Move keyboard focus into the panel so Escape/tabbing work immediately.
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-line glass-strong shadow-pop animate-slide-in-right"
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
