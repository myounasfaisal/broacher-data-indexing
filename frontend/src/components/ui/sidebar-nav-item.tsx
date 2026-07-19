import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sidebar navigation item — icon + label, active / inactive states
 * (theme-aware). Router aware (NavLink): the active route gets a brand-tinted
 * pill and an accent rail. `end` matches the path exactly.
 */
export function SidebarNavItem({
  to,
  icon: Icon,
  label,
  end = false,
  onNavigate,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-btn px-3 py-2 text-sm transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
          isActive
            ? "bg-brand-soft font-medium text-brand-soft-text"
            : "text-fg-muted hover:bg-hover hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand transition-opacity duration-150",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <Icon
            className={cn(
              "h-[18px] w-[18px] shrink-0",
              isActive
                ? "text-brand-text"
                : "text-fg-subtle group-hover:text-fg-muted",
            )}
            aria-hidden
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}
