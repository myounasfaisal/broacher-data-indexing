/**
 * Shared display formatters. These were duplicated verbatim across six
 * components; the copies had already started to drift (one dropped the empty
 * check, one returned "—" for unparseable input while another fell back to the
 * raw ISO prefix). Keep new formatting helpers here rather than local to a file.
 */

const EM_DASH = "—";

/**
 * Calendar date only — for "first seen" style columns where the time of day
 * carries no meaning. Unparseable or missing input reads as an em-dash.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? EM_DASH : d.toLocaleDateString();
}

/**
 * Date + time, for logs and history where ordering within a day matters.
 * Unlike formatDate, an unparseable value falls back to the raw ISO prefix:
 * in an audit log a malformed-but-present timestamp is still evidence, so
 * showing it beats hiding it behind a dash.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
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

/**
 * Human file size (1536 → "1.5 KB"). Used by the upload review list so a stray
 * folder's heft is legible at a glance. Bytes and KB show whole numbers; MB+
 * keep one decimal.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const rounded = i >= 2 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${units[i]}`;
}

/**
 * Printed URLs often omit the scheme ("titanos.com"), which the browser would
 * otherwise resolve as a relative path. Assume https for those; leave explicit
 * http(s) links alone.
 */
export function websiteHref(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
