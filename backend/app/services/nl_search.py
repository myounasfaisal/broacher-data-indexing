"""
NL search agent: one natural-language sentence → structured search filters.

CRITICAL DESIGN RULE: the model's only job is filter extraction. It never
generates chemical data — every result row comes from
database.search_listings(), the exact same trusted query path the manual
filter search uses. If the model returns garbage we fail with NLSearchError
(→ a clean 502 in the router) rather than degrade into letting the model
"answer" the question.

Provider: SEARCH_PROVIDER in .env ("qwen" | "gemini" | "claude"); empty means
"whatever EXTRACTION_PROVIDER is". This is a lightweight text-only call, so it
reuses extraction.complete_text (same clients, same retry policy) instead of
adding a fourth provider code path.
"""

from __future__ import annotations

import json
import logging

from app.config import eff_str
from app.prompts.nl_search_prompt import build_nl_search_prompt
from app.schemas.chemical import InterpretedFilters
from app.services import extraction

logger = logging.getLogger(__name__)


class NLSearchError(Exception):
    """The model call failed or returned something that isn't a filter object."""


def parse_query(query: str) -> InterpretedFilters:
    """Ask the configured provider to turn `query` into InterpretedFilters."""
    provider = (eff_str("search_provider") or eff_str("extraction_provider")).lower()
    prompt = build_nl_search_prompt(query)

    try:
        raw = extraction.complete_text(
            prompt, provider=provider, max_tokens=400, feature="AI search"
        )
    except extraction.ExtractionError as exc:
        raise NLSearchError(str(exc)) from exc

    try:
        # Same fence-tolerant JSON parser the extraction pipeline uses.
        data = extraction._parse_json(raw)
    except json.JSONDecodeError as exc:
        logger.warning("NL search returned non-JSON output: %s", raw[:300])
        raise NLSearchError("The model did not return valid filter JSON.") from exc

    try:
        # Pydantic normalizes: text fields trimmed/capped, unknown sort falls
        # back to price_asc, numeric bounds enforced, extra keys ignored.
        return InterpretedFilters.model_validate(data)
    except Exception as exc:  # pydantic ValidationError and friends
        logger.warning("NL search filters failed validation: %s", exc)
        raise NLSearchError(f"Interpreted filters were invalid: {exc}") from exc
