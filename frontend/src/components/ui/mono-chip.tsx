import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * MonoChip — the design kit's data chip (theme-aware). Precise data (CAS
 * numbers, prices, purity, counts) renders here as small monospace chips so it
 * reads as distinct from prose at a glance, everywhere it appears.
 *
 * The brand accent is reserved for the key decision data:
 *   - `price` — filled brand chip (the hero datum when comparing suppliers)
 *   - `cas`   — outlined brand chip (the identifier; accent, but lighter)
 *   - `neutral` — muted chip for other mono data (purity, MOQ, counts, IDs)
 *
 * Empty values should render a plain "—" by the caller, not an empty chip.
 */
type ChipTone = "price" | "cas" | "neutral";

const tones: Record<ChipTone, string> = {
  price:
    "bg-brand-soft text-brand-soft-text ring-1 ring-inset ring-brand/20 font-medium",
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
