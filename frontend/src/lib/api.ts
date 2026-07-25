import { supabase } from "./supabaseClient";
import type {
  AuditLogResponse,
  DashboardSummary,
  DocumentListings,
  JobAction,
  Listing,
  ListingUpdate,
  ManagedUser,
  ReviewQueueResponse,
  Suggestion,
  SuppliersResponse,
  UploadHistoryResponse,
  UploadJob,
  UploadRange,
  UserRole,
} from "@/types/chemical";

// Base URL of the FastAPI backend, from env (no trailing slash).
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string)?.replace(
  /\/$/,
  "",
);

/** Attach the current Supabase access token as a Bearer JWT. */
async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export type SortOption = "name_asc" | "name_desc" | "price_asc" | "price_desc";

export interface SearchParams {
  q?: string;
  /**
   * Supplier name substring. A separate axis from `q` on purpose: `q` already
   * matches supplier names, so it can't express "this product, from this
   * supplier". Set both to do exactly that.
   */
  supplier?: string;
  cas?: string;
  minPrice?: number;
  maxPrice?: number;
  minPurity?: number;
  maxPurity?: number;
  /** Loose match against the flexible per-listing details blob. */
  detailsQ?: string;
  /** Only listings with a printed price. */
  pricedOnly?: boolean;
  sort?: SortOption;
  /** Single A-Z letter for the alphabet tabs; omit for "All". */
  letter?: string;
  page?: number;
  pageSize?: number; // backend caps at 15
}

/**
 * What the AI search agent understood from a sentence. These are plain
 * search filters — the backend runs them through the SAME query path as the
 * manual search; the model never produces chemical data itself.
 */
export interface InterpretedFilters {
  name_query: string | null;
  cas_number: string | null;
  min_price: number | null;
  max_price: number | null;
  min_purity: number | null;
  max_purity: number | null;
  details_query: string | null;
  sort: SortOption;
}

export interface SearchResponse {
  count: number; // total matching rows across ALL pages
  page: number;
  page_size: number;
  total_pages: number;
  results: Listing[];
}

export interface AISearchResponse extends SearchResponse {
  interpreted_filters: InterpretedFilters;
}

async function search(params: SearchParams): Promise<SearchResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.supplier) qs.set("supplier", params.supplier);
  if (params.cas) qs.set("cas", params.cas);
  if (params.minPrice != null) qs.set("min_price", String(params.minPrice));
  if (params.maxPrice != null) qs.set("max_price", String(params.maxPrice));
  if (params.minPurity != null) qs.set("min_purity", String(params.minPurity));
  if (params.maxPurity != null) qs.set("max_purity", String(params.maxPurity));
  if (params.detailsQ) qs.set("details_q", params.detailsQ);
  if (params.pricedOnly) qs.set("priced_only", "true");
  if (params.sort) qs.set("sort", params.sort);
  if (params.letter) qs.set("letter", params.letter);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("page_size", String(params.pageSize));

  const res = await fetch(`${BACKEND_URL}/search?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Natural-language search. The backend's model converts the sentence into
 * structured filters and runs the normal search with them; the response
 * carries both the rows and the interpreted filters (for the chips UI).
 */
async function aiSearch(query: string): Promise<AISearchResponse> {
  const res = await fetch(`${BACKEND_URL}/search/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Full detail for one listing (product page), including `details`/website. */
async function getListing(id: string): Promise<Listing> {
  const res = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(id)}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Admin data-fix: change selected fields on one listing. */
async function updateListing(
  id: string,
  changes: ListingUpdate,
): Promise<Listing> {
  const res = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Admin: permanently delete one listing. */
async function deleteListing(id: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`${BACKEND_URL}/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Admin: permanently delete a selected set of listings in one call (bulk
 * select). Returns how many rows were actually removed — already-deleted
 * ids are skipped server-side, not an error.
 */
async function bulkDeleteListings(ids: string[]): Promise<{ deleted: number }> {
  const res = await fetch(`${BACKEND_URL}/listings/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Undo one upload: deletes the listings it produced (except ones another
 * upload also produced) and its history row, so the PDF can be re-uploaded.
 */
async function undoUpload(
  contentHash: string,
): Promise<{ deleted_listings: number; kept_shared: number }> {
  const res = await fetch(
    `${BACKEND_URL}/uploads/${encodeURIComponent(contentHash)}`,
    { method: "DELETE", headers: { ...(await authHeader()) } },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Typeahead suggestions for the search box (chemical names / CAS / suppliers). */
async function suggest(
  q: string,
  limit = 8,
): Promise<{ suggestions: Suggestion[] }> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  const res = await fetch(`${BACKEND_URL}/suggest?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

// ---------------------------------------------------------------------
// Upload jobs (server-side queue — survives page reloads)
// ---------------------------------------------------------------------

/** Enqueue a single brochure PDF for extraction; returns the created job. */
async function enqueueUpload(file: File): Promise<UploadJob> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BACKEND_URL}/upload-jobs`, {
    method: "POST",
    headers: { ...(await authHeader()) }, // do NOT set Content-Type — the browser sets the multipart boundary
    body: form,
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** All of the caller's upload jobs (queued/processing/done/failed). */
async function listUploadJobs(): Promise<{ jobs: UploadJob[] }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Remove the caller's finished (done/failed/cancelled) jobs from the view. */
async function clearFinishedJobs(): Promise<{ removed: number }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/clear-finished`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Cancel every active (queued/paused/processing) job in one shot. */
async function cancelAllJobs(): Promise<{ cancelled: number }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/cancel-all`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Apply a control action to one upload job (pause/resume/cancel/restart/remove). */
async function jobAction(
  jobId: string,
  action: JobAction,
): Promise<{ job?: UploadJob; removed?: boolean }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${jobId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

// ---------------------------------------------------------------------
// Upload history (persistent audit — survives backend restarts)
// ---------------------------------------------------------------------

/**
 * The caller's past uploads, filtered by date range and server-paginated.
 * Pass all=true (admin) for the org-wide audit.
 */
async function listUploadHistory(
  all = false,
  range: UploadRange = "all",
  page = 1,
  pageSize = 10,
): Promise<UploadHistoryResponse> {
  const path = all ? "/uploads/history/all" : "/uploads/history";
  const qs = new URLSearchParams({
    range,
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await fetch(`${BACKEND_URL}${path}?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** The listings a single upload produced ("which ones were added"). */
async function getUploadListings(
  contentHash: string,
): Promise<DocumentListings> {
  const res = await fetch(
    `${BACKEND_URL}/uploads/${encodeURIComponent(contentHash)}/listings`,
    { headers: { ...(await authHeader()) } },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

// ---------------------------------------------------------------------
// Suppliers directory (all roles)
// ---------------------------------------------------------------------

/**
 * Paginated suppliers directory: extracted company details + listing counts.
 * `q` filters server-side on company name (either script) or email;
 * `direction` sorts by supplier name ("asc" default, or "desc").
 */
async function listSuppliers(
  page = 1,
  pageSize = 10,
  q?: string,
  direction: "asc" | "desc" = "asc",
): Promise<SuppliersResponse> {
  const qs = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  // Omitted entirely when blank, so the unfiltered request stays byte-identical
  // to what it was before search existed.
  if (q?.trim()) qs.set("q", q.trim());
  // Only send a non-default direction, keeping the default request unchanged.
  if (direction === "desc") qs.set("direction", "desc");
  const res = await fetch(`${BACKEND_URL}/suppliers?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

// ---------------------------------------------------------------------
// Admin dashboard (admin + manager)
// ---------------------------------------------------------------------

/** Aggregate stat counts for the dashboard (role-checked server-side). */
async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch(`${BACKEND_URL}/admin/dashboard/summary`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Paginated needs-review queue (admin + manager), newest first. */
async function listReviewQueue(page = 1): Promise<ReviewQueueResponse> {
  const qs = new URLSearchParams({ page: String(page) });
  const res = await fetch(`${BACKEND_URL}/admin/review?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Paginated activity log — who uploaded/edited/deleted what (admin only). */
async function listAuditLog(page = 1): Promise<AuditLogResponse> {
  const qs = new URLSearchParams({ page: String(page) });
  const res = await fetch(`${BACKEND_URL}/admin/audit?${qs.toString()}`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

// ---------------------------------------------------------------------
// User management (admin only)
// ---------------------------------------------------------------------

async function listUsers(): Promise<{ users: ManagedUser[] }> {
  const res = await fetch(`${BACKEND_URL}/users`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function setUserRole(
  userId: string,
  role: UserRole,
): Promise<ManagedUser> {
  const res = await fetch(`${BACKEND_URL}/users/${userId}/role`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
    },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Pull a human-readable message out of a FastAPI error response. */
async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    return `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export const api = {
  backendUrl: BACKEND_URL,
  authHeader,
  search,
  aiSearch,
  getListing,
  updateListing,
  deleteListing,
  bulkDeleteListings,
  undoUpload,
  suggest,
  enqueueUpload,
  listUploadJobs,
  clearFinishedJobs,
  cancelAllJobs,
  jobAction,
  listUploadHistory,
  getUploadListings,
  listSuppliers,
  getDashboardSummary,
  listReviewQueue,
  listAuditLog,
  listUsers,
  setUserRole,
};
