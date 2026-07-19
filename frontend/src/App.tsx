import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AdminDashboard from "./pages/AdminDashboard";
import AdminUploadPage from "./pages/AdminUploadPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import SearchPage from "./pages/SearchPage";
import SuppliersPage from "./pages/SuppliersPage";
import ReviewQueuePage from "./pages/ReviewQueuePage";
import AuditLogPage from "./pages/AuditLogPage";
import ProductDetail from "./pages/ProductDetail";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Top-level route map.
 *
 * Auth pages (and the temporary /kit preview) render bare; everything else
 * renders inside <AppShell> via the <ShellLayout> layout route, which also
 * enforces that the user is signed in. Admin-only pages additionally get a
 * server-side role check on every request — the guards here are UX only.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ShellLayout />}>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute role="uploader">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/review"
          element={
            <ProtectedRoute role="uploader">
              <ReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/upload"
          element={
            <ProtectedRoute role="uploader">
              <AdminUploadPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute role="admin">
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <ProtectedRoute role="admin">
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<RootRedirect />} />
      </Route>
    </Routes>
  );
}

/**
 * Layout route: requires a session, then wraps the matched page in the app
 * shell (sidebar + content). Unauthenticated users are sent to /login.
 */
function ShellLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-app p-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/**
 * Role-aware landing. Admins and managers get the dashboard; viewers get
 * search. Used for "/" and any unknown path.
 */
function RootRedirect() {
  const { data: role, isLoading } = useRole();

  if (isLoading) {
    return (
      <div aria-hidden className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const toDashboard = role === "admin" || role === "manager";
  return <Navigate to={toDashboard ? "/admin/dashboard" : "/search"} replace />;
}
