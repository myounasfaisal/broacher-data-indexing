"""
Chat assistant orchestration.

Ties together the ephemeral thread store, the active provider loop, and the
citation trust boundary. Provider-agnostic: everything protocol-specific lives
in chat_providers.py.

THE TRUST BOUNDARY. The model writes prose, so the rule from nl_search.py — the
model never produces chemical data — is enforced structurally here rather than
by prompting alone:

  1. Every product the model cites is an id in a [[marker]].
  2. `validate_citations` intersects those ids with the ids that tools actually
     RETURNED this turn. Anything else is dropped.
  3. The markers are stripped from the prose before it reaches the UI, and the
     surviving ids are returned separately.
  4. The frontend fetches those listings from the API and renders real rows.

So even a model that invents a price in a sentence cannot put a fake number in
front of the user: the numbers come from the database row, not the sentence.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.config import settings
from app.prompts.chat_prompt import (
    CITATION_PATTERN,
    build_system_prompt,
    build_user_turn,
)
from app.services import chat_providers, chat_session, database

logger = logging.getLogger(__name__)

# Beyond this the reply stops being a chat message and starts being a report.
MAX_CITATIONS = 5

_CITATION_RE = re.compile(CITATION_PATTERN)


class ChatDisabled(Exception):
    """CHAT_ENABLED is off for this deployment."""


def validate_citations(
    text: str, allowed_ids: set[str]
) -> tuple[str, list[str]]:
    """
    Strip [[id]] markers from the prose and return the ids that survive
    validation, in the order the model mentioned them.

    Unknown ids are dropped silently rather than surfaced as an error: a
    hallucinated citation should degrade the reply to plain prose, not fail the
    whole exchange in front of the user. It is logged so the prompt can be
    tuned.
    """
    seen: list[str] = []

    for match in _CITATION_RE.finditer(text):
        listing_id = match.group(1)
        if listing_id in allowed_ids:
            if listing_id not in seen:
                seen.append(listing_id)
        else:
            logger.warning(
                "Chat cited a listing id not present in any tool result: %s",
                listing_id,
            )

    cleaned = _CITATION_RE.sub("", text)
    # Collapse the double spaces left where a marker sat mid-sentence.
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned).strip()

    return cleaned, seen[:MAX_CITATIONS]


def send(
    *,
    user_id: str,
    thread_id: str,
    message: str,
    context: dict[str, Any] | None = None,
    on_event: chat_providers.ProgressFn = chat_providers._noop,
) -> dict[str, Any]:
    """
    Run one exchange. Raises ChatDisabled, chat_session.ThreadNotFound,
    chat_session.ThreadFull, or chat_providers.ChatProviderError — the router
    maps each to a status code.

    `on_event` receives progress updates (thinking / tool started / tool done)
    as the loop runs, so the UI can report what is ACTUALLY happening during
    the 30-odd seconds an answer takes. It is called from this thread; the
    router bridges it onto the event loop.
    """
    if not settings.chat_enabled:
        raise ChatDisabled()

    thread = chat_session.get(thread_id, user_id)

    # Append BEFORE calling the provider so the cap is enforced on the way in.
    # Appending after would let a full thread make one extra paid model call
    # before being refused.
    chat_session.append(
        thread, {"role": "user", "content": build_user_turn(message, context)}
    )

    provider = chat_providers.get_provider()
    try:
        result = provider.run(build_system_prompt(), thread.messages, on_event)
    except chat_providers.ChatProviderError:
        # Roll the user turn back so a transient provider failure doesn't burn
        # a slot in a 20-message thread.
        thread.messages.pop()
        raise

    answer, cited_ids = validate_citations(result.text, result.seen_listing_ids)

    if result.assistant_message:
        # Store the cleaned text: the markers are an interface detail and
        # keeping them would invite the model to copy stale ids forward.
        thread.messages.append({"role": "assistant", "content": answer})

    listings = database.get_listings_by_ids(cited_ids) if cited_ids else []

    _record_audit(user_id, message, result, cited_ids)

    return {
        "thread_id": thread.id,
        "answer": answer,
        "listings": listings,
        "messages_remaining": chat_session.remaining(thread),
    }


def _record_audit(
    user_id: str,
    message: str,
    result: chat_providers.ChatResult,
    cited_ids: list[str],
) -> None:
    """
    One row per exchange. The chat itself is ephemeral, so without this a
    sourcing recommendation that later turns out wrong would be unreviewable —
    which is exactly the kind of gap the review queue exists to close.

    Never raises: an audit failure must not lose the user's answer.
    """
    try:
        database.audit(
            user_id,
            "chat_query",
            {
                "provider": settings.chat_provider,
                "question": message[:500],
                "tools": [t["name"] for t in result.trace],
                "cited_listing_ids": cited_ids,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Chat audit write failed: %s", exc)
