"""
Request/response models for house knowledge — the curated substitution and
regulatory notes managers write from the Inspector (P4).

These are the one place in the system where a HUMAN, not an extractor and not
a model, is the source of a claim. The output models carry the author and the
date for exactly that reason: a house note is only worth overriding the model
with if you can see who wrote it and when.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# 'works' is the ordinary case. 'avoid' exists because a note recording that a
# swap FAILED is house knowledge too, and without a verdict the assistant would
# read it as an endorsement.
Verdict = Literal["works", "conditional", "avoid"]

# Deliberately includes 'unclear': "we think it's restricted but haven't
# confirmed" is a real state, and forcing it into 'restricted' would turn an
# uncertainty into an assertion — the exact failure §6.3 is written to avoid.
RegulatoryStatus = Literal["banned", "restricted", "phase_out", "permitted", "unclear"]


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class SubstitutionNoteIn(BaseModel):
    from_chemical_id: str = Field(max_length=64)
    # The substitute is given BY NAME, not by id. The manager is recording a
    # decision, and the most useful decisions name substances we do not stock
    # yet — those have no chemical row to point at. The server resolves the
    # name to an id when it can and stores both.
    to_name: str = Field(min_length=1, max_length=200)
    verdict: Verdict = "works"
    context: str = Field(min_length=1, max_length=2000)

    _clean = field_validator("to_name", "context", mode="before")(_strip)


class SubstitutionNoteOut(BaseModel):
    id: str
    from_chemical_id: str
    from_name: str | None = None
    from_cas: str | None = None
    to_chemical_id: str | None = None
    to_name: str
    to_cas: str | None = None
    verdict: Verdict
    context: str
    author_id: str | None = None
    author_email: str | None = None
    created_at: str


class RegulatoryNoteIn(BaseModel):
    chemical_id: str = Field(max_length=64)
    jurisdiction: str = Field(min_length=1, max_length=100)
    status: RegulatoryStatus
    effective_date: date | None = None
    note: str = Field(min_length=1, max_length=2000)
    source_url: str | None = Field(default=None, max_length=500)

    _clean = field_validator(
        "jurisdiction", "note", "source_url", mode="before"
    )(_strip)

    @field_validator("source_url", mode="after")
    @classmethod
    def _blank_url_to_none(cls, v: str | None) -> str | None:
        return v or None


class RegulatoryNoteOut(BaseModel):
    id: str
    chemical_id: str
    chemical_name: str | None = None
    chemical_cas: str | None = None
    jurisdiction: str
    status: RegulatoryStatus
    effective_date: str | None = None
    note: str
    source_url: str | None = None
    author_id: str | None = None
    author_email: str | None = None
    created_at: str


class NotesResponse(BaseModel):
    """Everything the house knows about one chemical, for the Inspector."""

    substitutions: list[SubstitutionNoteOut] = []
    regulatory: list[RegulatoryNoteOut] = []
