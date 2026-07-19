import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Button primitive (shadcn-compatible API), Marine kit — theme-aware via
 * semantic tokens. ~10px radius, soft elevation on solid variants, clear
 * hover / active / focus. Variants: primary (default), secondary, outline,
 * ghost, destructive. Motion capped at 150ms.
 */
type Variant =
  | "default"
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default:
    "bg-brand text-on-brand shadow-sm hover:bg-brand-hover active:bg-brand-hover",
  primary:
    "bg-brand text-on-brand shadow-sm hover:bg-brand-hover active:bg-brand-hover",
  secondary: "bg-muted text-fg hover:bg-hover active:bg-hover",
  outline:
    "border border-line bg-surface text-fg shadow-sm hover:bg-muted hover:border-line-strong active:bg-hover",
  ghost: "text-fg-muted hover:bg-hover hover:text-fg",
  destructive:
    "bg-danger text-on-danger shadow-sm hover:bg-danger-hover active:bg-danger-hover",
};

const sizes: Record<Size, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-8 px-3 text-[13px]",
  lg: "h-11 px-6",
  icon: "h-10 w-10",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-btn text-sm font-medium",
        "transition-[background-color,border-color,color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-app",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
