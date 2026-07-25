import type { DocumentStatus } from "@/types/chemical";

/** End-of-batch summary: counts of succeeded / failed documents + products. */
export function UploadSummary({ documents }: { documents: DocumentStatus[] }) {
  const duplicates = documents.filter((d) => d.duplicate).length;
  const done = documents.filter((d) => d.status === "done" && !d.duplicate).length;
  const failed = documents.filter((d) => d.status === "failed").length;
  const cancelled = documents.filter((d) => d.status === "cancelled").length;
  const total = documents.length;

  // Only show once every document has reached a terminal state.
  const finished =
    documents.every(
      (d) =>
        d.status === "done" ||
        d.status === "failed" ||
        d.status === "cancelled" ||
        d.duplicate,
    ) && total > 0;
  if (!finished) return null;

  const products = documents.reduce((sum, d) => sum + (d.product_count || 0), 0);

  return (
    <p className="text-sm text-fg-muted">
      Finished:{" "}
      <span className="font-medium text-ok-text">{done} processed</span>
      {duplicates > 0 && (
        <>
          {" · "}
          <span className="font-medium text-fg-muted">
            {duplicates} duplicate{duplicates === 1 ? "" : "s"} skipped
          </span>
        </>
      )}
      {cancelled > 0 && (
        <>
          {" · "}
          <span className="font-medium text-fg-muted">{cancelled} cancelled</span>
        </>
      )}
      {failed > 0 && (
        <>
          {" · "}
          <span className="font-medium text-danger-text">{failed} failed</span>
        </>
      )}{" "}
      of {total} — {products} product(s) saved.
    </p>
  );
}
