import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * Appearance menu — one control for both appearance axes: theme (light/dark)
 * and accent (teal/ember). A trigger button opens a small popover holding a
 * light/dark segment and two accent swatches.
 *
 * The popover is portalled to <body> and `position: fixed`, so it escapes the
 * sidebar's `overflow-y-auto` nav (an absolutely-positioned panel would be
 * clipped there) and never widens the layout. It closes on Escape, on a click
 * outside, and on selection of the accent; focus moves in on open and returns
 * to the trigger on close.
 */
export function AppearanceMenu({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "full";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const label = "Appearance settings";

  const trigger =
    variant === "full" ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-btn px-3 py-2 text-sm text-fg-muted transition-colors duration-150",
          "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
          className,
        )}
      >
        <Palette className="h-4 w-4" aria-hidden />
        Appearance
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={label}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-btn text-fg-muted transition-colors duration-150",
          "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
          className,
        )}
      >
        <Palette className="h-[18px] w-[18px]" aria-hidden />
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <AppearancePopover
          id={menuId}
          anchor={triggerRef.current}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function AppearancePopover({
  id,
  anchor,
  onClose,
}: {
  id: string;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const { resolvedTheme, setTheme, accent, setAccent } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the panel above the trigger, right-aligned to it, before paint so
  // it never flashes in the wrong spot. Clamped to the viewport.
  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return;
    const a = anchor.getBoundingClientRect();
    const p = panelRef.current.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - p.width - 8));
    const top =
      a.top - p.height - gap >= 8
        ? a.top - p.height - gap // above
        : a.bottom + gap; // fall back below if there's no room above
    setPos({ top, left });
  }, [anchor]);

  // Close on Escape or a click outside; move focus into the panel on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !anchor?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-label="Appearance"
      tabIndex={-1}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Hidden until measured, so it never paints at the fallback coords.
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 w-60 rounded-panel border border-line bg-elevated p-3 shadow-pop focus:outline-none"
    >
      <fieldset className="space-y-1.5">
        <legend className="label-caption mb-1.5">Theme</legend>
        <div className="grid grid-cols-2 gap-1 rounded-btn bg-muted p-1">
          <SegmentButton
            active={resolvedTheme === "light"}
            onClick={() => setTheme("light")}
            icon={<Sun className="h-4 w-4" aria-hidden />}
            label="Light"
          />
          <SegmentButton
            active={resolvedTheme === "dark"}
            onClick={() => setTheme("dark")}
            icon={<Moon className="h-4 w-4" aria-hidden />}
            label="Dark"
          />
        </div>
      </fieldset>

      <fieldset className="mt-3 space-y-1.5">
        <legend className="label-caption mb-1.5">Accent</legend>
        <div className="flex gap-2">
          <AccentSwatch
            active={accent === "teal"}
            onClick={() => setAccent("teal")}
            label="Teal"
            swatch="#0f7a72"
          />
          <AccentSwatch
            active={accent === "ember"}
            onClick={() => setAccent("ember")}
            label="Ember"
            swatch="#d4611a"
          />
        </div>
      </fieldset>
    </div>,
    document.body,
  );
}

function SegmentButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        active
          ? "bg-surface text-fg shadow-sm"
          : "text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function AccentSwatch({
  active,
  onClick,
  label,
  swatch,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  /** The accent's mid-tone, for the swatch fill only — not a token. */
  swatch: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        "group flex flex-1 items-center gap-2 rounded-btn border px-2.5 py-2 text-sm transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        active
          ? "border-brand bg-brand-soft text-brand-soft-text"
          : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: swatch }}
      >
        {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
