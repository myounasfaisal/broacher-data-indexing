import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input primitive (shadcn-compatible API), Marine kit — theme-aware. Shares
 * the button's 10px radius and shadow language; clear brand focus ring.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm",
      "transition-[border-color,box-shadow] duration-150",
      "placeholder:text-fg-subtle",
      "focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-0",
      "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
