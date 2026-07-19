import * as React from "react";
import { cn } from "@/lib/utils";

// Skeleton primitive (shadcn-compatible API), Marine kit — theme-aware: a soft
// pulsing block sized by the caller. Used wherever data is still loading.
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
