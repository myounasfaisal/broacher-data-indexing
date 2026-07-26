/**
 * Shared TypeScript types mirroring the database schema (db/schema.sql).
 * Kept in sync by hand — update both when the schema changes.
 */

export type UserRole = "admin" | "manager" | "viewer";

export type UploadJobStatus =
  | "queued"
  | "processing"
  | "paused"
  | "done"
  | "failed"
  | "cancelled";

/**
 * One document in the DB-worker pipeline (backend documents/pages tables).
 * Replaces the old in-memory UploadJob — progress is derived from the
 * documents/pages status machine, so it survives reloads and backend restarts.
 */
export type DocumentStatusValue =
  // Uploaded and durable, but deliberately not claimable: waits for the user to
  // press "Start processing". Nothing costs an AI call until it leaves this state.
  | "staged"
  | "pending"
  | "splitting"
  | "split"
  | "extracting"
  | "paused"
  | "done"
  | "failed"
  | "cancelled";

export interface DocumentStatus {
  id: string;
  content_hash: string;
  filename: string;
  status: DocumentStatusValue;
  page_count: number;
  pages_done: number;
  product_count: number;
  company_name: string | null;
  duplicate: boolean; // skipped because this exact PDF was already processed
  error: string | null;
  created_at: string;
}

/** Date-range filter for the upload history. */
export type UploadRange = "week" | "month" | "year" | "all";

/** Server-paginated upload-history response. */
export interface UploadHistoryResponse {
  items: UploadHistoryItem[];
  count: number; // total matching uploads across ALL pages
  page: number;
  page_size: number;
  total_pages: number;
}

/** One processed-upload record shown in the upload history / admin audit. */
export interface UploadHistoryItem {
  content_hash: string;
  filename: string;
  company_name: string;
  company_name_en: string;
  product_count: number;
  uploaded_by: string | null;
  uploaded_by_email: string | null; // populated only in the admin-wide view
  created_at: string;
}

/** The listings a single upload produced ("which ones were added"). */
export interface DocumentListings {
  content_hash: string;
  filename: string;
  listings: Listing[];
}

/** Aggregate counts for the admin dashboard (GET /admin/dashboard/summary). */
/** Three disjoint listing-quality slices that sum to total_listings. */
export interface StatusDistribution {
  complete: number;
  needs_review: number;
  missing_price: number;
}

/** One bar in the dashboard's "Top suppliers by listings" panel. */
export interface SupplierListingCount {
  company_id: number;
  name: string;
  count: number;
}

export interface DashboardSummary {
  total_listings: number;
  total_suppliers: number;
  uploads_last_7d: number;
  needs_review: number;
  status_distribution: StatusDistribution;
  top_suppliers: SupplierListingCount[];
}

/** One row on the admin user-management page. */
export interface ManagedUser {
  id: string;
  email: string | null;
  role: UserRole;
  created_at: string | null;
  last_sign_in_at: string | null;
}

/** Admin/manager PATCH /listings/{id} body — only the fields to change. */
export interface ListingUpdate {
  name_raw?: string;
  name_en?: string;
  cas_number?: string | null;
  price?: number | null;
  currency?: string | null;
  purity?: string | null;
  needs_review?: boolean;
  /** Full replacement of the technical-details object (reference block kept). */
  details?: Record<string, unknown> | null;
}

/** One supplier in the directory (GET /suppliers). */
export interface Supplier {
  id: number;
  company_name: string;
  company_name_en: string | null;
  email: string | null;
  contact_number: string | null;
  /** Distinct websites printed on this supplier's brochures (from listings). */
  websites: string[];
  listing_count: number;
  created_at: string;
}

/** Server-paginated suppliers directory response. */
export interface SuppliersResponse {
  items: Supplier[];
  count: number; // total suppliers across ALL pages
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * A flagged listing in the review queue (GET /admin/review) — a Listing plus
 * the upload that produced it (null for uploads predating the ledger column).
 */
export interface ReviewItem extends Listing {
  source_content_hash: string | null;
  source_filename: string | null;
}

/** Server-paginated review queue response. */
export interface ReviewQueueResponse {
  items: ReviewItem[];
  count: number; // total flagged listings across ALL pages
  page: number;
  page_size: number;
  total_pages: number;
}

/** One activity-log entry (GET /admin/audit): who did what, when. */
export interface AuditEntry {
  id: number;
  actor: string | null;
  actor_email: string | null;
  action:
    | "upload"
    | "update_listing"
    | "delete_listing"
    | "bulk_delete_listings"
    | "undo_upload"
    | string;
  details: Record<string, unknown>;
  created_at: string;
}

/** Server-paginated activity log response. */
export interface AuditLogResponse {
  items: AuditEntry[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** One typeahead suggestion for the search box. */
export interface Suggestion {
  type: "chemical" | "supplier";
  label: string; // display text, and what fills the search box when picked
  cas_number: string | null; // set for chemical suggestions when known
  count: number; // how many listings back this suggestion
}

/** A canonical chemical, deduplicated across suppliers. */
export interface Chemical {
  id: string;
  cas_number: string | null;
  name_en: string;
  created_at: string;
}

/** One supplier's listing of a product, as extracted from a brochure. */
export interface Listing {
  id: string;
  chemical_id: string | null;
  company_id: number | null;
  company_name: string; // supplier name as printed (original language)
  company_name_en: string; // English translation of the supplier name
  name_raw: string; // exactly as printed, in the brochure's own language/script
  name_en: string; // English translation for consistent search/sort/dedup
  cas_number: string | null;
  price: number | null;
  currency: string | null;
  /** Price normalized to USD (stored server-side; drives price sorting). */
  price_usd?: number | null;
  /** PKR display value, computed from the current rate at read time. */
  price_pkr?: number | null;
  purity: string | null;
  needs_review: boolean;
  created_at: string;
  /**
   * Flexible per-listing technical details (flash point, hazard class,
   * storage, MOQ, ...) — keys vary per brochure. Only populated by the
   * single-listing detail endpoint; search rows omit it.
   */
  details?: Record<string, unknown> | null;
  /** Website printed on the brochure (the company's GENERAL site). */
  company_website?: string | null;
}

/* ------------------------------------------------------------------ */
/* House knowledge — curated notes managers write from the Inspector   */
/* ------------------------------------------------------------------ */

/** Did the swap work? `avoid` records one that was tried and failed. */
export type SubstitutionVerdict = "works" | "conditional" | "avoid";

export type RegulatoryStatus =
  | "banned"
  | "restricted"
  | "phase_out"
  | "permitted"
  /** Suspected but unconfirmed — kept distinct so it can't harden into a fact. */
  | "unclear";

/**
 * "We used B in place of A, in this context." BosTech's own judgement, and the
 * one source the assistant ranks above its own chemistry.
 */
export interface SubstitutionNote {
  id: string;
  from_chemical_id: string;
  from_name: string | null;
  from_cas: string | null;
  /** Null when the substitute isn't in the catalog — a sourcing lead, not a gap. */
  to_chemical_id: string | null;
  to_name: string;
  to_cas: string | null;
  verdict: SubstitutionVerdict;
  /** Free text, and the point of the note: "GCC floor coatings, summer cure". */
  context: string;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
}

/** A jurisdiction-scoped, dated regulatory status recorded by a manager. */
export interface RegulatoryNote {
  id: string;
  chemical_id: string;
  chemical_name: string | null;
  chemical_cas: string | null;
  jurisdiction: string;
  status: RegulatoryStatus;
  effective_date: string | null;
  note: string;
  source_url: string | null;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
}

/** Everything the house knows about one chemical. */
export interface HouseNotes {
  substitutions: SubstitutionNote[];
  regulatory: RegulatoryNote[];
}

/** A single admin-configurable setting. */
export interface AppSetting {
  key: string;
  value: string;
  is_secret: boolean;
  category: string;
  label: string;
  description: string;
  updated_at: string | null;
}

export interface SettingsCategory {
  key: string;
  label: string;
}

export interface SettingsResponse {
  settings: AppSetting[];
  categories: SettingsCategory[];
}

export interface SystemStatus {
  workers_active: number;
  documents_processing: number;
  total_listings: number;
  total_chemicals: number;
  embeddings_indexed: number;
  extraction_provider: string;
  chat_enabled: boolean;
  embeddings_enabled: boolean;
}

export interface TestKeyResult {
  ok: boolean;
  message: string;
}
