import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import type {
  HouseNotes,
  RegulatoryNote,
  RegulatoryStatus,
  SubstitutionNote,
  SubstitutionVerdict,
} from "@/types/chemical";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, websiteHref } from "@/lib/format";

/**
 * House knowledge for the chemical behind this listing — BosTech's own
 * substitution calls and recorded regulatory statuses, with the capture form
 * managers write them from.
 *
 * WHY IT SITS IN THE INSPECTOR: this is the one screen where someone is
 * already looking at the product and holding the decision in their head. A
 * separate admin page would collect nothing.
 *
 * These notes are the only source the assistant ranks ABOVE its own chemistry
 * knowledge, so the card is explicit about who wrote each one and when — an
 * unattributed note is just another confident claim.
 *
 * Notes attach to the canonical CHEMICAL, not the listing: a substitution
 * holds for a substance, not for one supplier's packaging of it. A listing
 * whose chemical identity was never resolved therefore can't carry notes, and
 * the card says so rather than silently rendering empty.
 */
export function HouseNotesCard({
  chemicalId,
  chemicalName,
}: {
  chemicalId: string | null;
  chemicalName: string;
}) {
  const { data: role } = useRole();
  const canManage = role === "admin" || role === "manager";
  const [form, setForm] = useState<"substitution" | "regulatory" | null>(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ["notes", chemicalId],
    enabled: !!chemicalId,
    queryFn: () => api.getNotes(chemicalId!),
  });

  if (!chemicalId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">House knowledge</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-fg-subtle">
          This listing isn't linked to a canonical chemical yet, so notes can't
          be attached to it. Setting its CAS number in the edit form links it.
        </CardContent>
      </Card>
    );
  }

  const notes: HouseNotes = data ?? { substitutions: [], regulatory: [] };
  const empty =
    notes.substitutions.length === 0 && notes.regulatory.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">House knowledge</CardTitle>
          <Badge variant="brand">our own judgement</Badge>
        </div>
        <p className="mt-1 text-xs text-fg-subtle">
          Substitutions we've made and regulatory status we've recorded for{" "}
          {chemicalName}. The assistant treats these as outranking its own
          chemistry.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending && <Skeleton className="h-16 w-full" aria-hidden />}
        {isError && (
          <p className="text-sm text-danger-text">Could not load notes.</p>
        )}

        {!isPending && !isError && empty && !form && (
          <p className="text-sm text-fg-subtle">
            Nothing recorded yet.
            {canManage
              ? " Add what the team already knows — it's the one thing here a competitor can't buy."
              : ""}
          </p>
        )}

        {notes.substitutions.length > 0 && (
          <ul className="space-y-3">
            {notes.substitutions.map((note) => (
              <SubstitutionRow
                key={note.id}
                note={note}
                chemicalId={chemicalId}
                canManage={canManage}
              />
            ))}
          </ul>
        )}

        {notes.regulatory.length > 0 && (
          <ul className="space-y-3">
            {notes.regulatory.map((note) => (
              <RegulatoryRow
                key={note.id}
                note={note}
                chemicalId={chemicalId}
                canManage={canManage}
              />
            ))}
          </ul>
        )}

        {canManage && form === null && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm("substitution")}
            >
              <Plus className="h-4 w-4" />
              Substitution note
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForm("regulatory")}
            >
              <Plus className="h-4 w-4" />
              Regulatory note
            </Button>
          </div>
        )}

        {canManage && form === "substitution" && (
          <SubstitutionForm
            chemicalId={chemicalId}
            chemicalName={chemicalName}
            onDone={() => setForm(null)}
          />
        )}
        {canManage && form === "regulatory" && (
          <RegulatoryForm
            chemicalId={chemicalId}
            chemicalName={chemicalName}
            onDone={() => setForm(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

const VERDICT_META: Record<
  SubstitutionVerdict,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  works: { label: "works", variant: "success" },
  conditional: { label: "conditional", variant: "warning" },
  // A swap that was tried and failed. Rendered as loudly as a positive one:
  // "we already know this doesn't work" is the more expensive fact to lose.
  avoid: { label: "avoid", variant: "destructive" },
};

function SubstitutionRow({
  note,
  chemicalId,
  canManage,
}: {
  note: SubstitutionNote;
  chemicalId: string;
  canManage: boolean;
}) {
  const verdict = VERDICT_META[note.verdict];
  return (
    <li className="rounded-btn border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <span className="font-medium">{note.from_name ?? "This product"}</span>
          <span className="text-fg-subtle">→</span>
          <span className="font-medium">{note.to_name}</span>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
          {!note.to_chemical_id && (
            // Not a defect: naming something we don't stock tells the team
            // what to go and source.
            <Badge variant="secondary">not in catalog</Badge>
          )}
        </div>
        {canManage && (
          <DeleteNoteButton
            chemicalId={chemicalId}
            onDelete={() => api.deleteSubstitutionNote(note.id)}
          />
        )}
      </div>
      <p className="mt-1.5 text-sm text-fg-muted">{note.context}</p>
      <Attribution email={note.author_email} created={note.created_at} />
    </li>
  );
}

const STATUS_META: Record<
  RegulatoryStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary" }
> = {
  banned: { label: "banned", variant: "destructive" },
  restricted: { label: "restricted", variant: "warning" },
  phase_out: { label: "phase-out", variant: "warning" },
  permitted: { label: "permitted", variant: "success" },
  unclear: { label: "unclear", variant: "secondary" },
};

function RegulatoryRow({
  note,
  chemicalId,
  canManage,
}: {
  note: RegulatoryNote;
  chemicalId: string;
  canManage: boolean;
}) {
  const status = STATUS_META[note.status];
  return (
    <li className="rounded-btn border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <span className="font-medium">{note.jurisdiction}</span>
          <Badge variant={status.variant}>{status.label}</Badge>
          {/* Jurisdiction and date are never dropped: a status without a
              where and a when is exactly the flattened claim this table
              exists to prevent. */}
          <span className="text-xs text-fg-subtle">
            {note.effective_date
              ? `effective ${formatDate(note.effective_date)}`
              : "no effective date recorded"}
          </span>
        </div>
        {canManage && (
          <DeleteNoteButton
            chemicalId={chemicalId}
            onDelete={() => api.deleteRegulatoryNote(note.id)}
          />
        )}
      </div>
      <p className="mt-1.5 text-sm text-fg-muted">{note.note}</p>
      {note.source_url && (
        <a
          href={websiteHref(note.source_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand-text hover:underline"
        >
          Source
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      <Attribution email={note.author_email} created={note.created_at} />
    </li>
  );
}

/** Who decided this, and when — the whole basis for trusting the note. */
function Attribution({
  email,
  created,
}: {
  email: string | null;
  created: string;
}) {
  return (
    <p className="mt-2 text-xs text-fg-subtle">
      {email ?? "a team member"} · {formatDate(created)}
    </p>
  );
}

function DeleteNoteButton({
  chemicalId,
  onDelete,
}: {
  chemicalId: string;
  onDelete: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      toast.success("Note removed.");
      queryClient.invalidateQueries({ queryKey: ["notes", chemicalId] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not remove the note."),
  });
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Remove note"
      disabled={del.isPending}
      onClick={() => del.mutate()}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function SubstitutionForm({
  chemicalId,
  chemicalName,
  onDone,
}: {
  chemicalId: string;
  chemicalName: string;
  onDone: () => void;
}) {
  const [toName, setToName] = useState("");
  const [verdict, setVerdict] = useState<SubstitutionVerdict>("works");
  const [context, setContext] = useState("");
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.createSubstitutionNote({
        from_chemical_id: chemicalId,
        to_name: toName.trim(),
        verdict,
        context: context.trim(),
      }),
    onSuccess: () => {
      toast.success("Substitution recorded.");
      queryClient.invalidateQueries({ queryKey: ["notes", chemicalId] });
      onDone();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save the note."),
  });

  const ready = toName.trim().length > 0 && context.trim().length > 0;

  return (
    <FormShell title={`Substitute for ${chemicalName}`} onCancel={onDone}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="note-to">Use instead</Label>
          <Input
            id="note-to"
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            placeholder="e.g. zinc oxide"
          />
          {/* Deliberately permissive about substances we don't stock. */}
          <p className="text-xs text-fg-subtle">
            Name it even if we don't stock it — that's a sourcing lead.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note-verdict">Verdict</Label>
          <Select
            id="note-verdict"
            value={verdict}
            onChange={(e) =>
              setVerdict(e.target.value as SubstitutionVerdict)
            }
          >
            <option value="works">Works</option>
            <option value="conditional">Works with conditions</option>
            <option value="avoid">Avoid — we tried it, it failed</option>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note-context">In what context</Label>
        <textarea
          id="note-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          placeholder="e.g. GCC floor coatings, summer cure — matched opacity at 1.2x loading"
          className="flex w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <p className="text-xs text-fg-subtle">
          A substitution is only ever valid in a context — the assistant repeats
          this verbatim.
        </p>
      </div>
      <SaveRow
        disabled={!ready || save.isPending}
        pending={save.isPending}
        onSave={() => save.mutate()}
        onCancel={onDone}
      />
    </FormShell>
  );
}

function RegulatoryForm({
  chemicalId,
  chemicalName,
  onDone,
}: {
  chemicalId: string;
  chemicalName: string;
  onDone: () => void;
}) {
  const [jurisdiction, setJurisdiction] = useState("");
  const [status, setStatus] = useState<RegulatoryStatus>("restricted");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      api.createRegulatoryNote({
        chemical_id: chemicalId,
        jurisdiction: jurisdiction.trim(),
        status,
        effective_date: effectiveDate || null,
        note: note.trim(),
        source_url: sourceUrl.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Regulatory note recorded.");
      queryClient.invalidateQueries({ queryKey: ["notes", chemicalId] });
      onDone();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save the note."),
  });

  const ready = jurisdiction.trim().length > 0 && note.trim().length > 0;

  return (
    <FormShell title={`Regulatory status for ${chemicalName}`} onCancel={onDone}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="reg-jurisdiction">Jurisdiction</Label>
          <Input
            id="reg-jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            placeholder="UAE, GCC, EU REACH…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-status">Status</Label>
          <Select
            id="reg-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as RegulatoryStatus)}
          >
            <option value="banned">Banned</option>
            <option value="restricted">Restricted</option>
            <option value="phase_out">Phase-out</option>
            <option value="permitted">Permitted</option>
            <option value="unclear">Unclear / unconfirmed</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-date">Effective date</Label>
          <Input
            id="reg-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
          <p className="text-xs text-fg-subtle">Leave blank if undated.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-note">The detail</Label>
        <textarea
          id="reg-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. restricted above 0.1% w/w in consumer coatings; industrial use unaffected"
          className="flex w-full rounded-btn border border-line bg-surface px-3 py-2 text-sm text-fg shadow-sm placeholder:text-fg-subtle focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <p className="text-xs text-fg-subtle">
          Record the nuance — most restrictions are partial, and "banned" alone
          is usually wrong.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-source">Source link</Label>
        <Input
          id="reg-source"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://… (optional, but makes the note checkable)"
        />
      </div>
      <SaveRow
        disabled={!ready || save.isPending}
        pending={save.isPending}
        onSave={() => save.mutate()}
        onCancel={onDone}
      />
    </FormShell>
  );
}

function FormShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-btn border border-line bg-muted/40 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-fg">{title}</h4>
        <Button variant="ghost" size="sm" aria-label="Cancel" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function SaveRow({
  disabled,
  pending,
  onSave,
  onCancel,
}: {
  disabled: boolean;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={disabled} onClick={onSave}>
        {pending ? "Saving…" : "Save note"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
