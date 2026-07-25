import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitives (shadcn-compatible API), Marine kit — theme-aware. Clean
 * row separation, hoverable rows, a quiet header. Wrapped in an overflow-x
 * container so wide tables scroll inside their panel.
 */
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-line" {...props} />;
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        // The row hover is the click affordance where rows are clickable, so
        // it reads at full strength rather than as a faint tint.
        "border-b border-line/60 transition-colors duration-150 hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        // Sentence case, not uppercase: column headers are read as words while
        // scanning rows, and all-caps measurably slows that down. Uppercase in
        // this system is reserved for sidebar section labels and stat captions.
        "h-10 px-3 text-left align-middle text-xs font-medium text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-3 py-2.5 align-middle text-fg", className)}
      {...props}
    />
  );
}
