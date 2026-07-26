"""Request/response models for the chat assistant endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.chemical import ListingOut


class InspectorContext(BaseModel):
    """
    What the user is currently looking at in the Search screen.

    Sent on every turn so references like "this one" or "cheaper than this"
    resolve without the user retyping a chemical name. All fields optional —
    the panel works with none of them.
    """

    query: str | None = Field(default=None, max_length=200)
    supplier: str | None = Field(default=None, max_length=200)
    cas_number: str | None = Field(default=None, max_length=50)
    selected_listing_id: str | None = Field(default=None, max_length=64)
    selected_listing_name: str | None = Field(default=None, max_length=200)

    @field_validator("*", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: InspectorContext | None = None


class ChatThreadResponse(BaseModel):
    """A freshly opened chat. Ephemeral — destroyed when the panel closes."""

    thread_id: str
    messages_remaining: int


class ChatReplyResponse(BaseModel):
    thread_id: str
    answer: str
    # The products the assistant cited, fetched from the database by id.
    # The UI renders THESE, never numbers parsed out of `answer` — that is the
    # trust boundary (see services/chat_agent.py).
    listings: list[ListingOut] = []
    # Turns left before the thread hits its cap and the UI offers a new chat.
    messages_remaining: int
