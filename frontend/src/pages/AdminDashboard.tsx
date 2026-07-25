import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileWarning, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardMasthead } from "@/components/dashboard/DashboardMasthead";
import { ListingStatusDonut } from "@/components/dashboard/ListingStatusDonut";
import { TopSuppliersBars } from "@/components/dashboard/TopSuppliersBars";
import { UploadHistory } from "@/components/upload/UploadHistory";
import { UsersTable } from "@/components/admin/UsersTable";

/**
 * Admin/manager landing page: a briefing on the whole database.
 *
 * Reads top to bottom as scale → attention → distribution → activity, and no
 * number is shown twice (DESIGN.md → The Briefing Order Rule):
 * - Masthead — the catalog's headline totals (listings, suppliers).
 * - Stat row — the two operational numbers: recent uploads and the review
 *   backlog (the one card that is a real link into the queue).
 * - Insight row — the status donut and top-suppliers bars, from the same
 *   aggregate endpoint.
 * - Recent uploads (<UploadHistory>) and, for admins, <UsersTable>.
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
      <DashboardMasthead
        listings={data?.total_listings}
        suppliers={data?.total_suppliers}
        loading={isLoading}
      />

      {isError && (
        <p className="mb-4 text-sm text-danger-text">
          Couldn't load the summary stats. The tables below still work.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Uploads · 7 days"
          value={fmt(data?.uploads_last_7d)}
          icon={Upload}
          tone="sky"
          hint={
            data ? `${fmt(data.status_distribution?.complete)} listings complete` : undefined
          }
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

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <ListingStatusDonut dist={data?.status_distribution} loading={isLoading} />
        <TopSuppliersBars suppliers={data?.top_suppliers} loading={isLoading} />
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
