import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/search/Pagination";
import { PageHeader } from "@/components/layout/PageHeader";
import type { AuditEntry } from "@/types/chemical";

/**
 * Activity log (admin only): a separate, persistent record of who uploaded,
 * edited, and deleted what — written server-side on every upload, listing
 * edit/delete (single + bulk), and upload undo. Read-only by design.
 */
export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["auditLog", page],
    queryFn: () => api.listAuditLog(page),
  });

  useEffect(() => {
    if (data && page > data.total_pages) setPage(data.total_pages);
  }, [data, page]);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Who uploaded, edited, and deleted what — recorded automatically, newest first."
      />

      <Card>
        <CardContent className="pt-6">
          {isPending && (
            <div aria-hidden className="space-y-3 py-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          )}
          {isError && (
            <p className="py-8 text-center text-sm text-danger-text">
              {error instanceof Error ? error.message : "Could not load the log"}
            </p>
          )}

          {data && data.items.length === 0 && (
            <EmptyState
              icon={ScrollText}
              title="No activity yet"
              description="Uploads, edits, and deletions will appear here as they happen."
            />
          )}

          {data && data.items.length > 0 && (
            <>
              <div className="mb-3 text-sm text-fg-muted">
                {data.count} event{data.count === 1 ? "" : "s"}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>What</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-muted">
                        {formatDate(e.created_at)}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-fg-muted">
                        {e.actor_email || e.actor || "—"}
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={e.action} />
                      </TableCell>
                      <TableCell className="max-w-[28rem] text-sm text-fg">
                        {describe(e)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4">
                <Pagination
                  page={data.page}
                  totalPages={data.total_pages}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const ACTION_LABELS: Record<string, { label: string; destructive: boolean }> = {
  upload: { label: "Uploaded", destructive: false },
  update_listing: { label: "Edited listing", destructive: false },
  delete_listing: { label: "Deleted listing", destructive: true },
  bulk_delete_listings: { label: "Bulk deleted", destructive: true },
  undo_upload: { label: "Undid upload", destructive: true },
};

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_LABELS[action] ?? { label: action, destructive: false };
  return (
    <Badge variant={meta.destructive ? "warning" : "secondary"}>
      {meta.label}
    </Badge>
  );
}

/** Human sentence for the details blob of each known action. */
function describe(e: AuditEntry): string {
  const d = e.details;
  const s = (k: string) => {
    const v = d[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);

  switch (e.action) {
    case "upload":
      return `${s("filename") ?? "a PDF"} — ${n("listings") ?? "?"} listing(s)${
        s("company") ? ` from ${s("company")}` : ""
      }`;
    case "update_listing": {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      return `${s("name_en") ?? "a listing"}${
        fields.length ? ` (changed: ${fields.join(", ")})` : ""
      }`;
    }
    case "delete_listing":
      return `${s("name_en") ?? "a listing"}${
        s("company") ? ` — ${s("company")}` : ""
      }`;
    case "bulk_delete_listings": {
      const names = Array.isArray(d.names) ? (d.names as string[]) : [];
      const shown = names.slice(0, 5).join(", ");
      return `${n("count") ?? names.length} listing(s)${
        shown ? `: ${shown}${names.length > 5 ? ", …" : ""}` : ""
      }`;
    }
    case "undo_upload":
      return `${s("filename") ?? "an upload"} — ${
        n("deleted_listings") ?? "?"
      } listing(s) deleted${
        n("kept_shared") ? `, ${n("kept_shared")} kept (shared)` : ""
      }`;
    default:
      return JSON.stringify(d);
  }
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
