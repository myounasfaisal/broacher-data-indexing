import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route guard. Redirects unauthenticated users to /login, and (when a `role`
 * is required) redirects users without that role to /search.
 *
 * - role="admin"    → admins only (user management)
 * - role="uploader" → admins AND managers (brochure upload)
 *
 * This is UX only — it stops the wrong page from rendering. The actual
 * security boundary is the backend, which re-verifies the JWT and role on
 * every protected request.
 */
export function ProtectedRoute({
  children,
  role,
}: {
  children: ReactNode;
  role?: "admin" | "uploader";
}) {
  const { session, loading } = useAuth();
  const { data: userRole, isLoading: roleLoading } = useRole();

  if (loading) return <PageSkeleton />;
  if (!session) return <Navigate to="/login" replace />;

  if (role) {
    if (roleLoading) return <PageSkeleton />;
    const allowed =
      role === "admin"
        ? userRole === "admin"
        : userRole === "admin" || userRole === "manager";
    if (!allowed) return <Navigate to="/search" replace />;
  }

  return <>{children}</>;
}

// Rough page shape (title + content block) while the session/role loads.
function PageSkeleton() {
  return (
    <div aria-hidden className="space-y-4 p-8">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
