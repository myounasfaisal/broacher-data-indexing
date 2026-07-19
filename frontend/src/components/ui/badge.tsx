import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge primitive (shadcn-compatible API), Marine kit — theme-aware. Pill
 * status / label chips for roles, the "needs review" flag, and upload status.
 *
 * NOTE: precise data (CAS numbers, prices) uses <MonoChip> instead.
 */
type BadgeVariant =
  | "default"
  | "secondary"
  | "brand"
  | "success"
  | "warning"
  | "destructive";

const variants: Record<BadgeVariant, string> = {
  default: "bg-fg text-app",
  secondary: "bg-muted text-fg-muted ring-1 ring-inset ring-line",
  brand: "bg-brand-soft text-brand-soft-text ring-1 ring-inset ring-brand/20",
  success: "bg-ok-soft text-ok-text ring-1 ring-inset ring-ok-text/20",
  warning: "bg-warn-soft text-warn-text ring-1 ring-inset ring-warn-text/20",
  destructive:
    "bg-danger-soft text-danger-text ring-1 ring-inset ring-danger-text/20",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
