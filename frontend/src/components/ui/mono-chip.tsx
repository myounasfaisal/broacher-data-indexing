import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * MonoChip — the design kit's data chip (theme-aware). Precise data (CAS
 * numbers, prices, purity, counts) renders here as small monospace chips so it
 * reads as distinct from prose at a glance, everywhere it appears.
 *
 * The brand accent is reserved for the key decision data:
 *   - `price` — filled brand chip (the hero datum when comparing suppliers)
 *   - `approx` — same geometry, no fill: a price we derived, not one a
 *     supplier printed. The accent is reserved for figures that came off the
 *     brochure, so an estimate must not wear it — a buyer quoting an
 *     exchange-rate conversion as a supplier's price is a commercial error.
 *     The tone is never the only signal; callers pair it with an "est." label.
 *   - `cas`   — outlined brand chip (the identifier; accent, but lighter)
 *   - `neutral` — muted chip for other mono data (purity, MOQ, counts, IDs)
 *
 * Empty values should render a plain "—" by the caller, not an empty chip.
 */
type ChipTone = "price" | "approx" | "cas" | "neutral";

const tones: Record<ChipTone, string> = {
  price:
    "bg-brand-soft text-brand-soft-text ring-1 ring-inset ring-brand/20 font-medium",
  approx: "bg-surface text-fg ring-1 ring-inset ring-line-strong font-medium",
  cas: "text-brand-text ring-1 ring-inset ring-brand/30",
  neutral: "bg-muted text-fg-muted ring-1 ring-inset ring-line",
};

export function MonoChip({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-chip px-1.5 py-0.5",
        "font-mono text-[12px] leading-5 tracking-tight tabular-nums",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
