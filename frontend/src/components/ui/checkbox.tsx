import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Checkbox primitive — the same styled native checkbox already used inline
 * by the filter/admin forms (native input + brand accent color; theme-aware
 * via accent-color), extracted so row-selection checkboxes look identical
 * everywhere. Always give it an aria-label when it has no visible label.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "h-4 w-4 cursor-pointer rounded border-line accent-brand",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
