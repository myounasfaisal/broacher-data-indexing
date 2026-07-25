import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRole } from "@/types/chemical";
import { formatDate } from "@/lib/format";

const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "search + upload + manage users" },
  { value: "manager", label: "Manager", hint: "search + upload brochures" },
  { value: "viewer", label: "Viewer", hint: "search only" },
];

/**
 * The admin user list + inline role editor. Shared by the Users page and the
 * dashboard so the role-change logic lives in exactly one place. Your own row
 * is locked — an admin cannot demote themselves.
 */
export function UsersTable() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users"],
    queryFn: api.listUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.setUserRole(id, role),
    onSuccess: (updated) => {
      toast.success(`${updated.email ?? "User"} is now ${updated.role}.`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Role update failed"),
  });

  if (isLoading) {
    return (
      <div aria-hidden className="space-y-3 py-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-danger-text">
        {error instanceof Error ? error.message : "Failed to load users"}
      </p>
    );
  }
  if (!data) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead>Last sign-in</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.users.map((u) => {
          const isSelf = u.id === user?.id;
          return (
            <TableRow key={u.id}>
              <TableCell className="font-medium text-fg">
                {u.email ?? "—"}
                {isSelf && (
                  <Badge variant="secondary" className="ml-2">
                    you
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <Select
                  className="h-9 w-36"
                  value={u.role}
                  disabled={isSelf || roleMutation.isPending}
                  title={
                    isSelf
                      ? "You cannot change your own role"
                      : ROLE_OPTIONS.find((r) => r.value === u.role)?.hint
                  }
                  onChange={(e) =>
                    roleMutation.mutate({
                      id: u.id,
                      role: e.target.value as UserRole,
                    })
                  }
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </TableCell>
              <TableCell className="text-fg-muted">
                {formatDate(u.created_at)}
              </TableCell>
              <TableCell className="text-fg-muted">
                {formatDate(u.last_sign_in_at)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

