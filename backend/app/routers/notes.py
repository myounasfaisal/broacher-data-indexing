"""
House knowledge endpoints — curated substitution and regulatory notes (P4).

GET    /notes?chemical_id=…              everything the house knows about one
                                         substance (any authenticated user)
POST   /notes/substitutions              admin/manager: record a substitution
DELETE /notes/substitutions/{id}         admin/manager: remove one
POST   /notes/regulatory                 admin/manager: record a status
DELETE /notes/regulatory/{id}            admin/manager: remove one

READS ARE OPEN, WRITES ARE NOT. Viewers must see house knowledge — capturing it
is pointless if only the people who wrote it can read it — but a note is
BosTech asserting a professional judgement that the assistant will then repeat,
so writing one needs the manager role.

Notes are keyed by canonical chemical, never by listing: a substitution holds
for a substance, not for one supplier's packaging of it.
"""

# NOTE: no `from __future__ import annotations` in routers — see the slowapi
# gotcha documented in CHANGES.md part 10.
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import require_manager, require_user
from app.schemas.notes import (
    NotesResponse,
    RegulatoryNoteIn,
    RegulatoryNoteOut,
    SubstitutionNoteIn,
    SubstitutionNoteOut,
)
from app.services import database

router = APIRouter(prefix="/notes", tags=["notes"])


def _require_uuid(value: str, what: str) -> None:
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found.")


def _with_authors(rows: list[dict]) -> list[dict]:
    """
    Attach the author's email to each note.

    Resolved here rather than stored on the row so a changed email is never
    stale — and skipped entirely when there are no notes, because the lookup
    costs a full user list.
    """
    ids = {str(r["author_id"]) for r in rows if r.get("author_id")}
    if not ids:
        return rows
    try:
        emails = database.get_user_emails(ids)
    except Exception:  # noqa: BLE001 — a missing name must not hide the note
        emails = {}
    for row in rows:
        row["author_email"] = emails.get(str(row.get("author_id") or ""))
    return rows


def _stringify(rows: list[dict], *keys: str) -> list[dict]:
    """Coerce uuid/date columns to strings for the response models."""
    for row in rows:
        for key in keys:
            if row.get(key) is not None:
                row[key] = str(row[key])
    return rows


@router.get("", response_model=NotesResponse)
async def get_notes(
    chemical_id: str = Query(min_length=1, max_length=64),
    _user_id: str = Depends(require_user),
) -> NotesResponse:
    """Every substitution and regulatory note touching one chemical."""
    _require_uuid(chemical_id, "Chemical")

    subs = _with_authors(database.list_substitution_notes([chemical_id]))
    regs = _with_authors(database.list_regulatory_notes([chemical_id]))
    _stringify(
        subs, "id", "from_chemical_id", "to_chemical_id", "author_id", "created_at"
    )
    _stringify(
        regs, "id", "chemical_id", "author_id", "created_at", "effective_date"
    )
    return NotesResponse(
        substitutions=[SubstitutionNoteOut(**r) for r in subs],
        regulatory=[RegulatoryNoteOut(**r) for r in regs],
    )


@router.post(
    "/substitutions",
    response_model=SubstitutionNoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_substitution_note(
    body: SubstitutionNoteIn,
    manager_id: str = Depends(require_manager),
) -> SubstitutionNoteOut:
    """
    Record "we can use B in place of A, in this context".

    The substitute arrives as a NAME. We resolve it to a canonical chemical
    when one exists and store the id alongside the text, but a note about a
    substance we do not stock is deliberately still writable — that is a
    sourcing instruction for the team, not an incomplete record.
    """
    _require_uuid(body.from_chemical_id, "Chemical")
    if not database.get_chemicals_by_ids([body.from_chemical_id]):
        raise HTTPException(status_code=404, detail="Chemical not found.")

    match = database.find_chemical_by_name_en(body.to_name)
    row = database.create_substitution_note(
        from_chemical_id=body.from_chemical_id,
        to_chemical_id=match["id"] if match else None,
        to_name=body.to_name,
        verdict=body.verdict,
        context=body.context,
        author_id=manager_id,
    )
    database.audit(
        manager_id,
        "create_substitution_note",
        {
            "note_id": str(row["id"]),
            "from": row.get("from_name"),
            "to": row.get("to_name"),
            "verdict": row.get("verdict"),
            "in_catalog": bool(row.get("to_chemical_id")),
        },
    )
    rows = _with_authors([row])
    _stringify(
        rows, "id", "from_chemical_id", "to_chemical_id", "author_id", "created_at"
    )
    return SubstitutionNoteOut(**rows[0])


@router.delete(
    "/substitutions/{note_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_substitution_note(
    note_id: str,
    manager_id: str = Depends(require_manager),
) -> None:
    _require_uuid(note_id, "Note")
    if database.get_substitution_note(note_id) is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    database.delete_substitution_note(note_id)
    database.audit(manager_id, "delete_substitution_note", {"note_id": note_id})


@router.post(
    "/regulatory",
    response_model=RegulatoryNoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_regulatory_note(
    body: RegulatoryNoteIn,
    manager_id: str = Depends(require_manager),
) -> RegulatoryNoteOut:
    """
    Record a jurisdiction-scoped, dated regulatory status.

    This is the only in-house regulatory source the assistant may cite. It
    exists because the model must never assert regulatory status from memory:
    bans are jurisdiction-specific, dated, and usually partial, and that nuance
    is exactly what a confident model answer flattens.
    """
    _require_uuid(body.chemical_id, "Chemical")
    if not database.get_chemicals_by_ids([body.chemical_id]):
        raise HTTPException(status_code=404, detail="Chemical not found.")

    row = database.create_regulatory_note(
        chemical_id=body.chemical_id,
        jurisdiction=body.jurisdiction,
        status=body.status,
        effective_date=body.effective_date.isoformat() if body.effective_date else None,
        note=body.note,
        source_url=body.source_url,
        author_id=manager_id,
    )
    database.audit(
        manager_id,
        "create_regulatory_note",
        {
            "note_id": str(row["id"]),
            "chemical": row.get("chemical_name"),
            "jurisdiction": row.get("jurisdiction"),
            "status": row.get("status"),
        },
    )
    rows = _with_authors([row])
    _stringify(rows, "id", "chemical_id", "author_id", "created_at", "effective_date")
    return RegulatoryNoteOut(**rows[0])


@router.delete("/regulatory/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_regulatory_note(
    note_id: str,
    manager_id: str = Depends(require_manager),
) -> None:
    _require_uuid(note_id, "Note")
    if database.get_regulatory_note(note_id) is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    database.delete_regulatory_note(note_id)
    database.audit(manager_id, "delete_regulatory_note", {"note_id": note_id})
