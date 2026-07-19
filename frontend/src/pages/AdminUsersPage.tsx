import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { UsersTable } from "@/components/admin/UsersTable";

/**
 * Admin-only page: list every registered user and change their role.
 * The table + role-edit logic lives in <UsersTable> (shared with the
 * dashboard). Your own row is locked — an admin cannot demote themselves.
 */
export default function AdminUsersPage() {
  return (
    <div>
      <PageHeader
        title="Manage users"
        description="List every registered user and change their role. You can't change your own role."
      />

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <p className="mt-1 text-sm text-fg-muted">
            <strong className="font-medium text-fg">Admin</strong>: search, upload &amp; manage users ·{" "}
            <strong className="font-medium text-fg">Manager</strong>: search &amp; upload brochures ·{" "}
            <strong className="font-medium text-fg">Viewer</strong>: search only.
          </p>
        </CardHeader>
        <CardContent>
          <UsersTable />
        </CardContent>
      </Card>
    </div>
  );
}
