import { supabase } from "./supabaseClient";
import type {
  AuditLogResponse,
  DashboardSummary,
  DocumentListings,
  DocumentStatus,
  HouseNotes,
  Listing,
  ListingUpdate,
  ManagedUser,
  RegulatoryNote,
  RegulatoryStatus,
  ReviewQueueResponse,
  SettingsResponse,
  SubstitutionNote,
  SubstitutionVerdict,
  Suggestion,
  SuppliersResponse,
  SystemStatus,
  TestKeyResult,
  UploadHistoryResponse,
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

/* ------------------------------------------------------------------ */
/* Chat assistant                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the user is currently looking at in the search screen. Sent on every
 * turn so "is this one any good?" resolves without retyping a chemical name.
 */
export interface InspectorContext {
  query?: string;
  supplier?: string;
  cas_number?: string;
  selected_listing_id?: string;
  selected_listing_name?: string;
}

export interface ChatThread {
  thread_id: string;
  messages_remaining: number;
}

export interface ChatReply {
  thread_id: string;
  answer: string;
  /**
   * The products the assistant cited, fetched server-side from the database
   * by id. Render THESE — never numbers parsed out of `answer`. The model can
   * only cite ids that its tools actually returned; anything else is dropped
   * before the response leaves the backend.
   */
  listings: Listing[];
  messages_remaining: number;
}

/** Open an ephemeral chat. Cheap — no model call. */
async function openChatThread(): Promise<ChatThread> {
  const res = await fetch(`${BACKEND_URL}/chat/threads`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Progress events from the assistant while it works. These describe what it is
 * ACTUALLY doing — the tool names and search terms are the real ones — so the
 * UI never has to invent plausible-looking status text.
 */
export type ChatEvent =
  | { type: "thinking" }
  | { type: "tool"; name: string; detail: string }
  | {
      type: "tool_done";
      name: string;
      count: number;
      failed?: boolean;
      /** Blocked as a repeat of a search already run this turn. */
      duplicate?: boolean;
    }
  | ({ type: "done" } & ChatReply)
  | { type: "error"; status: number; detail: string };

/**
 * Streaming send. Calls `onEvent` for each progress update and resolves with
 * the final reply.
 *
 * The stream returns HTTP 200 as soon as it opens, so a failure arrives as an
 * `error` EVENT, not a status code — a stream that ends without `done` is a
 * failure, and that case is turned back into a thrown Error here so callers
 * can treat it like any other rejected request.
 */
async function streamChatMessage(
  threadId: string,
  message: string,
  context: InspectorContext | undefined,
  onEvent: (event: ChatEvent) => void,
  /**
   * Lets the user abort a run in flight. The answer takes ~30s, so "I asked
   * the wrong thing" needs an exit that isn't waiting it out. Aborting rejects
   * with an AbortError, which callers treat as a cancellation, not a failure.
   */
  signal?: AbortSignal,
): Promise<ChatReply> {
  const res = await fetch(
    `${BACKEND_URL}/chat/threads/${encodeURIComponent(threadId)}/messages/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ message, context }),
      signal,
    },
  );
  // Pre-stream failures (rate limit, auth, feature disabled) still arrive as
  // real status codes, because nothing has been written to the body yet.
  if (!res.ok) throw new Error(await extractError(res));
  if (!res.body) throw new Error("The assistant returned an empty stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: ChatReply | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a partial frame stays in the
    // buffer until its terminator arrives.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let event: ChatEvent;
      try {
        event = JSON.parse(line.slice(5).trim()) as ChatEvent;
      } catch {
        continue;
      }
      if (event.type === "error") throw new Error(event.detail);
      if (event.type === "done") {
        const { type: _t, ...reply } = event;
        final = reply as ChatReply;
      }
      onEvent(event);
    }
  }

  if (!final) throw new Error("The assistant stopped before finishing.");
  return final;
}

async function sendChatMessage(
  threadId: string,
  message: string,
  context?: InspectorContext,
): Promise<ChatReply> {
  const res = await fetch(
    `${BACKEND_URL}/chat/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ message, context }),
    },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Close the chat — the conversation is destroyed server-side. Fire-and-forget:
 * a failed close is harmless (the thread expires on its own), and surfacing an
 * error while the user is closing a panel would be noise.
 */
async function closeChatThread(threadId: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/chat/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: { ...(await authHeader()) },
    });
  } catch {
    /* ignore */
  }
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

/** Accept a single brochure PDF: the backend creates a documents row and splits
 * it; the worker extracts it. Returns the document's initial status. */
async function enqueueUpload(file: File): Promise<DocumentStatus> {
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

/** The caller's recent pipeline documents with live status/progress. */
async function listUploadJobs(): Promise<{ documents: DocumentStatus[] }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs`, {
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/**
 * Release staged uploads for processing — the "Start processing" button.
 * Uploading is free and durable; this is where the batch starts costing AI
 * calls. Omit `docIds` to release everything the caller has staged.
 */
async function startProcessing(
  docIds?: string[],
): Promise<{ started: number; documents: DocumentStatus[] }> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ document_ids: docIds ?? null }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Delete a staged upload the user decided not to process. Only valid before
 * processing starts — afterwards use cancel + undo. */
async function discardDocument(docId: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${docId}/discard`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
}

/** Request cancellation of a document (stops after the current page; keeps
 * anything already extracted). */
async function cancelDocument(docId: string): Promise<DocumentStatus> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${docId}/cancel`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Re-queue a failed/cancelled document; the worker resumes at its first
 * incomplete page. */
async function restartDocument(docId: string): Promise<DocumentStatus> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${docId}/restart`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Pause a document (worker won't claim it; an in-flight page finishes first). */
async function pauseDocument(docId: string): Promise<DocumentStatus> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${docId}/pause`, {
    method: "POST",
    headers: { ...(await authHeader()) },
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Resume a paused document; the worker picks it up at its first incomplete page. */
async function resumeDocument(docId: string): Promise<DocumentStatus> {
  const res = await fetch(`${BACKEND_URL}/upload-jobs/${docId}/resume`, {
    method: "POST",
    headers: { ...(await authHeader()) },
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
// House knowledge — curated substitution / regulatory notes
// ---------------------------------------------------------------------
// Reads are open to every authenticated user (a note nobody can read is
// pointless); writes need admin/manager and are re-checked server-side.

/** Every note touching one canonical chemical. */
async function getNotes(chemicalId: string): Promise<HouseNotes> {
  const res = await fetch(
    `${BACKEND_URL}/notes?chemical_id=${encodeURIComponent(chemicalId)}`,
    { headers: { ...(await authHeader()) } },
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export interface SubstitutionNoteInput {
  from_chemical_id: string;
  /**
   * The substitute BY NAME. The server resolves it to a chemical id when one
   * exists, but a note about something we don't stock is still valid — that is
   * a sourcing instruction, not an incomplete record.
   */
  to_name: string;
  verdict: SubstitutionVerdict;
  context: string;
}

async function createSubstitutionNote(
  body: SubstitutionNoteInput,
): Promise<SubstitutionNote> {
  const res = await fetch(`${BACKEND_URL}/notes/substitutions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function deleteSubstitutionNote(noteId: string): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/notes/substitutions/${encodeURIComponent(noteId)}`,
    { method: "DELETE", headers: { ...(await authHeader()) } },
  );
  if (!res.ok) throw new Error(await extractError(res));
}

export interface RegulatoryNoteInput {
  chemical_id: string;
  jurisdiction: string;
  status: RegulatoryStatus;
  /** ISO date, or null when the change is announced but undated. */
  effective_date: string | null;
  note: string;
  source_url: string | null;
}

async function createRegulatoryNote(
  body: RegulatoryNoteInput,
): Promise<RegulatoryNote> {
  const res = await fetch(`${BACKEND_URL}/notes/regulatory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function deleteRegulatoryNote(noteId: string): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/notes/regulatory/${encodeURIComponent(noteId)}`,
    { method: "DELETE", headers: { ...(await authHeader()) } },
  );
  if (!res.ok) throw new Error(await extractError(res));
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

// ---------------------------------------------------------------------------
// Admin settings
// ---------------------------------------------------------------------------

async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${BACKEND_URL}/admin/settings`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function updateSettings(
  changes: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/admin/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
    },
    body: JSON.stringify({ changes }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}

async function testApiKey(
  provider: string,
  apiKey: string,
  apiBase: string = "",
): Promise<TestKeyResult> {
  const res = await fetch(`${BACKEND_URL}/admin/settings/test-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
    },
    body: JSON.stringify({ provider, api_key: apiKey, api_base: apiBase }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

async function getSystemStatus(): Promise<SystemStatus> {
  const res = await fetch(`${BACKEND_URL}/admin/settings/status`, {
    headers: await authHeader(),
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
  startProcessing,
  discardDocument,
  cancelDocument,
  restartDocument,
  pauseDocument,
  resumeDocument,
  listUploadHistory,
  getUploadListings,
  listSuppliers,
  getDashboardSummary,
  listReviewQueue,
  listAuditLog,
  listUsers,
  setUserRole,
  getNotes,
  createSubstitutionNote,
  deleteSubstitutionNote,
  createRegulatoryNote,
  deleteRegulatoryNote,
  openChatThread,
  sendChatMessage,
  streamChatMessage,
  closeChatThread,
  getSettings,
  updateSettings,
  testApiKey,
  getSystemStatus,
};
