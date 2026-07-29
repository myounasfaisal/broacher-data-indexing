import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SupplierValue {
  /** Existing supplier id, or null when the typed name doesn't match one. */
  id: number | null;
  name: string;
}

/**
 * Supplier field for the listing editor: search the existing directory as
 * you type, pick a match, or keep typing a name that isn't there yet — on
 * save that becomes a brand-new supplier. This is the fix for extraction
 * finding no supplier (or the wrong one): a human names the right one
 * instead of it staying blank forever.
 */
export function SupplierPicker({
  value,
  onChange,
}: {
  value: SupplierValue;
  onChange: (next: SupplierValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();

  const q = value.name.trim();
  const { data, isFetching } = useQuery({
    queryKey: ["supplierSearch", q],
    queryFn: () => api.listSuppliers(1, 6, q),
    enabled: open && q.length >= 2,
    staleTime: 30_000,
  });
  const matches = data?.items ?? [];

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  const isNew = value.id === null && q.length > 0;

  return (
    <div className="relative space-y-1 sm:col-span-2">
      <Label htmlFor="edit-supplier">Supplier</Label>
      <div className="relative">
        <Building2
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          id="edit-supplier"
          value={value.name}
          onChange={(e) => {
            onChange({ id: null, name: e.target.value });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a click on a suggestion registers before the list unmounts.
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder="Search suppliers, or type a new one"
          autoComplete="off"
          className="pl-9"
        />
      </div>

      {open && q.length >= 2 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-btn border border-line bg-surface shadow-pop">
          {isFetching ? (
            <p className="px-3 py-2 text-xs text-fg-subtle">Searching…</p>
          ) : matches.length > 0 ? (
            <ul>
              {matches.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-hover"
                    onClick={() => {
                      onChange({ id: s.id, name: s.company_name_en || s.company_name });
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value.id === s.id ? "opacity-100 text-brand" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{s.company_name_en || s.company_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-fg-subtle">
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              No match — saving will create “{q}” as a new supplier.
            </p>
          )}
        </div>
      )}

      {!open && isNew && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Plus className="h-3 w-3 shrink-0" aria-hidden />
          Will create “{q}” as a new supplier when you save.
        </p>
      )}
    </div>
  );
}
