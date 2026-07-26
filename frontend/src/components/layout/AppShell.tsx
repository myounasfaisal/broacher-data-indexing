import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Building2,
  FileWarning,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Search,
  Settings,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarNavItem } from "@/components/ui/sidebar-nav-item";
import { AppearanceMenu } from "@/components/ui/appearance-menu";
import { cn } from "@/lib/utils";

/**
 * Application shell — persistent glass sidebar (desktop) that collapses to a
 * drawer behind a top bar (mobile), wrapping a full-width content area.
 *
 * Navigation is role-aware: viewers see only Search; managers add Dashboard
 * and Upload; admins add Users. The links here are UX only — every protected
 * route is re-checked server-side.
 */
interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  show: (role: string | undefined) => boolean;
}

const isUploader = (r: string | undefined) => r === "admin" || r === "manager";

const NAV_ITEMS: NavItem[] = [
  {
    to: "/admin/dashboard",
    icon: LayoutDashboard,
    label: "Dashboard",
    show: isUploader,
  },
  { to: "/search", icon: Search, label: "Search", show: () => true },
  { to: "/suppliers", icon: Building2, label: "Suppliers", show: () => true },
  {
    to: "/admin/review",
    icon: FileWarning,
    label: "Review",
    show: isUploader,
  },
  { to: "/admin/upload", icon: Upload, label: "Upload", show: isUploader },
  {
    to: "/admin/users",
    icon: Users,
    label: "Users",
    show: (r) => r === "admin",
  },
  {
    to: "/admin/audit",
    icon: ScrollText,
    label: "Activity",
    show: (r) => r === "admin",
  },
  {
    to: "/admin/settings",
    icon: Settings,
    label: "Settings",
    show: (r) => r === "admin",
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-app text-fg">
      {/* Desktop sidebar — fixed, glass. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line glass lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile top bar — glass, sticky. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line glass px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-btn text-fg-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BrandMark />
        <AppearanceMenu className="ml-auto" />
      </header>

      {/* Mobile drawer + scrim. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 scrim animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-line glass-strong animate-fade-in">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-btn text-fg-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      {/* Content area. */}
      <div className="lg:pl-64">
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Shared sidebar body — brand mark, role-gated nav, user + theme footer. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const { data: role } = useRole();

  return (
    <>
      <div className="flex h-14 items-center px-5 lg:h-16">
        <BrandMark />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.filter((item) => item.show(role)).map((item) => (
          <SidebarNavItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            end={item.end}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <AppearanceMenu variant="full" className="mb-1" />
        <div className="flex items-center gap-3 rounded-btn px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-medium text-brand-soft-text">
            {(user?.email?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">
              {user?.email ?? "—"}
            </p>
            {role && (
              <Badge variant="secondary" className="mt-0.5 capitalize">
                {role}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </>
  );
}

/** Brand lockup — flask mark + wordmark, links home. */
function BrandMark() {
  return (
    <Link
      to="/search"
      className={cn(
        "flex items-center gap-2.5 rounded-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand text-on-brand shadow-sm">
        <FlaskConical className="h-[18px] w-[18px]" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-fg">
        Brochure<span className="text-brand-text">DB</span>
      </span>
    </Link>
  );
}
