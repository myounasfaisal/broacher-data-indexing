import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Listing, ListingUpdate } from "@/types/chemical";
import { REFERENCE_KEY } from "@/components/listing/ListingDetailBody";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FormState {
  name_en: string;
  name_raw: string;
  cas_number: string;
  price: string;
  currency: string;
  purity: string;
  needs_review: boolean;
}

/** One editable technical-detail entry; `id` is only a stable React key. */
interface DetailRow {
  id: number;
  key: string;
  value: string;
}

function fromListing(l: Listing): FormState {
  return {
    name_en: l.name_en,
    name_raw: l.name_raw,
    cas_number: l.cas_number ?? "",
    price: l.price == null ? "" : String(l.price),
    currency: l.currency ?? "",
    purity: l.purity ?? "",
    needs_review: l.needs_review,
  };
}

/** The brochure-printed details as editable rows (reference block excluded). */
function rowsFromListing(l: Listing, nextId: () => number): DetailRow[] {
  const details = (l.details ?? {}) as Record<string, unknown>;
  return Object.entries(details)
    .filter(([key]) => key !== REFERENCE_KEY)
    .map(([key, value]) => ({
      id: nextId(),
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
}

/**
 * Rebuild the details object from the edited rows.
 *
 * An UNTOUCHED row (text identical to how the stored value was rendered)
 * keeps the original value byte-for-byte — no type drift, no false "dirty".
 * For NEW or EDITED text: values that look like JSON ({…}, […], numbers,
 * true/false) are parsed into structured data; everything else is stored as
 * plain text. The PubChem reference block is re-attached untouched.
 */
function buildDetails(
  rows: DetailRow[],
  original: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const orig = (original ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const raw = row.value.trim();
    if (!key || !raw) continue; // empty rows are dropped, not stored

    const origVal = orig[key];
    if (origVal !== undefined) {
      const origText =
        typeof origVal === "string" ? origVal : JSON.stringify(origVal);
      if (origText === raw) {
        out[key] = origVal;
        continue;
      }
    }
    if (
      raw.startsWith("{") ||
      raw.startsWith("[") ||
      /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false)$/.test(raw)
    ) {
      try {
        out[key] = JSON.parse(raw);
        continue;
      } catch {
        /* fall through to plain text */
      }
    }
    out[key] = raw;
  }
  const reference = orig[REFERENCE_KEY];
  if (reference !== undefined) out[REFERENCE_KEY] = reference;
  return Object.keys(out).length > 0 ? out : null;
}

/** Order-insensitive equality for the edited-vs-stored details comparison. */
function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Only the fields that actually changed; "" clears a nullable field. */
function diff(form: FormState, rows: DetailRow[], l: Listing): ListingUpdate {
  const out: ListingUpdate = {};
  if (form.name_en.trim() && form.name_en.trim() !== l.name_en)
    out.name_en = form.name_en.trim();
  if (form.name_raw.trim() && form.name_raw.trim() !== l.name_raw)
    out.name_raw = form.name_raw.trim();
  const cas = form.cas_number.trim() || null;
  if (cas !== (l.cas_number ?? null)) out.cas_number = cas;
  const price = form.price.trim() === "" ? null : Number(form.price);
  if (price !== (l.price ?? null)) out.price = price;
  const currency = form.currency.trim() || null;
  if (currency !== (l.currency ?? null)) out.currency = currency;
  const purity = form.purity.trim() || null;
  if (purity !== (l.purity ?? null)) out.purity = purity;
  if (form.needs_review !== l.needs_review)
    out.needs_review = form.needs_review;
  const details = buildDetails(rows, l.details);
  if (!sameJson(details, l.details ?? null)) out.details = details;
  return out;
}

/**
 * Admin/manager data-fix panel on the product page & slide-in panel: correct
 * extraction mistakes — including adding/editing the flexible technical
 * details — without touching SQL. The backend recomputes the dedup key and
 * USD/PKR conversions; an edit that would make this identical to another
 * listing is rejected with a clear 409 message.
 *
 * `onDeleted` overrides what happens after a delete — the slide-in panel
 * closes itself; the standalone product page (no override) navigates back
 * to search.
 */
export function ListingAdminCard({
  listing,
  onDeleted,
}: {
  listing: Listing;
  onDeleted?: () => void;
}) {
  const idCounter = useRef(0);
  const nextId = () => ++idCounter.current;
  const [form, setForm] = useState<FormState>(() => fromListing(listing));
  const [rows, setRows] = useState<DetailRow[]>(() =>
    rowsFromListing(listing, nextId),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const changes = diff(form, rows, listing);
  const dirty = Object.keys(changes).length > 0;
  const priceInvalid =
    form.price.trim() !== "" &&
    (Number.isNaN(Number(form.price)) || Number(form.price) < 0);

  const save = useMutation({
    mutationFn: () => api.updateListing(listing.id, changes),
    onSuccess: (updated) => {
      toast.success("Listing updated.");
      setForm(fromListing(updated));
      setRows(rowsFromListing(updated, nextId));
      queryClient.invalidateQueries({ queryKey: ["listing", listing.id] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["reviewQueue"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const del = useMutation({
    mutationFn: () => api.deleteListing(listing.id),
    onSuccess: () => {
      toast.success("Listing deleted.");
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["search"] });
      queryClient.invalidateQueries({ queryKey: ["reviewQueue"] });
      queryClient.invalidateQueries({ queryKey: ["uploadListings"] });
      if (onDeleted) onDeleted();
      else navigate("/search", { replace: true });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setConfirmDelete(false);
    },
  });

  const busy = save.isPending || del.isPending;

  const updateRow = (id: number, patch: Partial<DetailRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Edit listing</CardTitle>
        <p className="mt-1 text-xs text-fg-subtle">
          Fix extraction mistakes here — no SQL needed. USD/PKR conversions
          and duplicate detection update automatically. Unchecking “needs
          review” resolves the review flag.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !priceInvalid && !busy) save.mutate();
          }}
        >
          <TextField
            id="edit-name-en"
            label="Name (EN)"
            value={form.name_en}
            onChange={(v) => setForm({ ...form, name_en: v })}
          />
          <TextField
            id="edit-name-raw"
            label="Name (as printed)"
            value={form.name_raw}
            onChange={(v) => setForm({ ...form, name_raw: v })}
          />
          <TextField
            id="edit-cas"
            label="CAS number"
            value={form.cas_number}
            onChange={(v) => setForm({ ...form, cas_number: v })}
            placeholder="empty = none"
          />
          <TextField
            id="edit-purity"
            label="Purity"
            value={form.purity}
            onChange={(v) => setForm({ ...form, purity: v })}
            placeholder="e.g. 99.5%"
          />
          <div className="space-y-1">
            <Label htmlFor="edit-price">Price</Label>
            <Input
              id="edit-price"
              type="number"
              min={0}
              step="any"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="empty = no price"
            />
            {priceInvalid && (
              <p className="text-xs text-danger-text">
                Price must be a non-negative number.
              </p>
            )}
          </div>
          <TextField
            id="edit-currency"
            label="Currency"
            value={form.currency}
            onChange={(v) => setForm({ ...form, currency: v })}
            placeholder="e.g. USD/ton, Yuan/ton"
          />

          {/* Flexible technical details — add, change, or remove entries.
              The PubChem reference block is preserved automatically. */}
          <div className="space-y-2 sm:col-span-2">
            <Label>Technical details</Label>
            {rows.length === 0 && (
              <p className="text-xs text-fg-subtle">
                No technical details yet — add whatever the brochure prints
                (flash point, hazard class, storage, MOQ, …).
              </p>
            )}
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  aria-label="Detail name"
                  className="w-2/5"
                  value={row.key}
                  placeholder="e.g. flash_point"
                  onChange={(e) => updateRow(row.id, { key: e.target.value })}
                />
                <Input
                  aria-label="Detail value"
                  className="flex-1"
                  value={row.value}
                  placeholder="value"
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => prev.filter((r) => r.id !== row.id))
                  }
                  aria-label={`Remove detail ${row.key || "(unnamed)"}`}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-btn text-fg-muted hover:bg-danger-soft hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  { id: nextId(), key: "", value: "" },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              Add detail
            </Button>
            <p className="text-xs text-fg-subtle">
              Empty rows are dropped. Removing every row clears the details.
            </p>
          </div>

          <label
            htmlFor="edit-review"
            className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted sm:col-span-2"
          >
            <input
              id="edit-review"
              type="checkbox"
              className="h-4 w-4 rounded border-line accent-brand"
              checked={form.needs_review}
              onChange={(e) =>
                setForm({ ...form, needs_review: e.target.checked })
              }
            />
            Needs review (uncheck once you have verified this listing)
          </label>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={!dirty || priceInvalid || busy}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-danger/40 text-danger-text hover:border-danger/60 hover:bg-danger-soft"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete listing
            </Button>
            {dirty && !busy && (
              <span className="text-xs text-fg-subtle">Unsaved changes</span>
            )}
          </div>
        </form>

        <Modal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this listing?"
          description={`"${listing.name_en}" will be permanently removed from the database. This cannot be undone.`}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={del.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => del.mutate()}
                disabled={del.isPending}
              >
                {del.isPending ? "Deleting…" : "Delete listing"}
              </Button>
            </>
          }
        />
      </CardContent>
    </Card>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
