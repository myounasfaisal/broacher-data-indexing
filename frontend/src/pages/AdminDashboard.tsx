import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Boxes, Building2, FileWarning, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/layout/PageHeader";
import { UploadHistory } from "@/components/upload/UploadHistory";
import { UsersTable } from "@/components/admin/UsersTable";

/**
 * Admin/manager landing page: a dense overview of the whole database.
 *
 * - Stat cards (total listings, suppliers, uploads in 7 days, needs review)
 *   from one aggregate endpoint.
 * - Recent uploads (admin + manager) — reuses <UploadHistory>, so the per-row
 *   "View listings" and Undo actions come for free.
 * - Users table (admin only) — reuses <UsersTable> with its role editor.
 */
export default function AdminDashboard() {
  const { data: role } = useRole();
  const isAdmin = role === "admin";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: api.getDashboardSummary,
  });

  const fmt = (n: number | undefined) =>
    n == null ? "—" : n.toLocaleString();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="An overview of the chemical database — listings, suppliers, and recent activity."
      />

      {isError && (
        <p className="mb-4 text-sm text-danger-text">
          Couldn't load the summary stats. The tables below still work.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total listings"
          value={fmt(data?.total_listings)}
          icon={Boxes}
          tone="brand"
          loading={isLoading}
        />
        <StatCard
          label="Suppliers"
          value={fmt(data?.total_suppliers)}
          icon={Building2}
          loading={isLoading}
        />
        <StatCard
          label="Uploads · 7 days"
          value={fmt(data?.uploads_last_7d)}
          icon={Upload}
          loading={isLoading}
        />
        {/* The "Review" button: the whole card links into the review queue. */}
        <Link
          to="/admin/review"
          className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          title="Open the review queue"
        >
          <StatCard
            label="Needs review"
            value={fmt(data?.needs_review)}
            icon={FileWarning}
            tone={data && data.needs_review > 0 ? "warning" : "default"}
            hint={
              data && data.needs_review > 0
                ? "Matched by name similarity — open the review queue"
                : "All listings verified — open the queue"
            }
            loading={isLoading}
          />
        </Link>
      </div>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent uploads</CardTitle>
            <p className="mt-1 text-sm text-fg-muted">
              {isAdmin
                ? "Every upload across the team — expand a row to see its listings, or undo it."
                : "Your past uploads — expand a row to see its listings, or undo it."}
            </p>
          </CardHeader>
          <CardContent>
            <UploadHistory isAdmin={isAdmin} />
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <p className="mt-1 text-sm text-fg-muted">
                Change a teammate's role. You can't change your own.
              </p>
            </CardHeader>
            <CardContent>
              <UsersTable />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
