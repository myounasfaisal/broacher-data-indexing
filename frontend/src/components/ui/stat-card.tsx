import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Stat card — a single headline metric for the dashboard (theme-aware). Big
 * tabular value, quiet label, optional tinted icon and hint. `tone` tints the
 * icon/value for metrics that should draw attention (e.g. "needs review").
 */
type Tone = "default" | "brand" | "warning";

const iconTones: Record<Tone, string> = {
  default: "bg-muted text-fg-muted",
  brand: "bg-brand-soft text-brand-text",
  warning: "bg-warn-soft text-warn-text",
};

const valueTones: Record<Tone, string> = {
  default: "text-fg",
  brand: "text-fg",
  warning: "text-warn-text",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-[9px]",
              iconTones[tone],
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p
          className={cn(
            "mt-2 text-3xl font-semibold tabular-nums tracking-tight",
            valueTones[tone],
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
    </Card>
  );
}
