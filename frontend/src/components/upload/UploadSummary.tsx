import type { UploadJob } from "@/types/chemical";

/** End-of-batch summary: counts of succeeded / failed brochures + listings. */
export function UploadSummary({ jobs }: { jobs: UploadJob[] }) {
  const duplicates = jobs.filter((j) => j.duplicate).length;
  const done = jobs.filter((j) => j.status === "done" && !j.duplicate).length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const cancelled = jobs.filter((j) => j.status === "cancelled").length;
  const total = jobs.length;

  // Only show once every job has reached a terminal state.
  const finished =
    jobs.every(
      (j) =>
        j.status === "done" ||
        j.status === "failed" ||
        j.status === "cancelled",
    ) && total > 0;
  if (!finished) return null;

  const listings = jobs.reduce((sum, j) => sum + j.listings_inserted, 0);
  const review = jobs.reduce((sum, j) => sum + j.needs_review, 0);

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
          <span className="font-medium text-fg-muted">
            {cancelled} cancelled
          </span>
        </>
      )}
      {failed > 0 && (
        <>
          {" · "}
          <span className="font-medium text-danger-text">{failed} failed</span>
        </>
      )}{" "}
      of {total} — {listings} listing(s) saved
      {review > 0 && <>, {review} flagged for review</>}.
    </p>
  );
}
