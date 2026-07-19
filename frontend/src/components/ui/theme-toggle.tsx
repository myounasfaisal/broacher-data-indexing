import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * Theme toggle — flips between light and dark. Shows the icon for the theme
 * you'd switch TO. `variant="full"` renders a labelled row (sidebar);
 * `variant="icon"` renders a compact square button (mobile top bar).
 */
export function ThemeToggle({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "full";
  className?: string;
}) {
  const { resolvedTheme, toggle } = useTheme();
  const toDark = resolvedTheme === "light";
  const label = toDark ? "Switch to dark theme" : "Switch to light theme";
  const Icon = toDark ? Moon : Sun;

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className={cn(
          "flex w-full items-center gap-3 rounded-btn px-3 py-2 text-sm text-fg-muted transition-colors duration-150",
          "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
          className,
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {toDark ? "Dark theme" : "Light theme"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-btn text-fg-muted transition-colors duration-150",
        "hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}
