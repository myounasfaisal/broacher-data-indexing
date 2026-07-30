"""
Every prompt the application sends to a model lives in this package.

SINGLE SOURCE OF TRUTH
----------------------
Two invariants keep this manageable. Both exist because breaking them caused a
real, silent data-loss bug — see `app/prompts/_rules.py` for the incident:

  1. NO PROMPT TEXT OUTSIDE THIS PACKAGE. Service modules import prompts; they
     never define them. If you find yourself writing prompt text in
     `app/services/` or `app/pipeline/`, it belongs here instead.

  2. NO RULE WRITTEN TWICE. Shared extraction rules live once in `_rules.py`,
     and prompts compose from those blocks. Editing a rule there fixes every
     path at once. Never copy a rule between prompt files.

LAYOUT
------
    _rules.py             shared, composable rule blocks  <- EDIT RULES HERE
    extraction_prompt.py  stage 1 vision, stage 2 system, tool schema
    ocr_prompt.py         plain-OCR pass (supplier identity)
    company_prompt.py     supplier-identity extraction
    chat_prompt.py        sourcing-assistant chat
    nl_search_prompt.py   natural-language search -> filter JSON

WHICH PROMPTS ARE ACTUALLY LIVE
-------------------------------
`app/worker.py` runs the per-page pipeline, which uses:
    VLM_TRANSCRIPTION_PROMPT     -> stage 1
    STAGE2_SYSTEM + TOOL_*       -> stage 2
    OCR_PROMPT + COMPANY_PROMPT  -> supplier-identity pass

`EXTRACTION_PROMPT` belongs to the older whole-document path
(services/extraction.py, pipeline/extraction.py) which the worker does NOT call.
It is retained and composed from the same rule blocks so it cannot drift, but
when reasoning about production behaviour, read `STAGE2_SYSTEM`.

`PROMPT_REGISTRY` enumerates prompts (for docs, admin surfacing, or token
budgeting) without importing each module by hand.
"""

from __future__ import annotations

from app.prompts.chat_prompt import CITATION_PATTERN
from app.prompts.chat_prompt import SYSTEM_PROMPT as CHAT_SYSTEM_PROMPT
from app.prompts.chat_prompt import build_system_prompt, build_user_turn
from app.prompts.company_prompt import COMPANY_PROMPT
from app.prompts.extraction_prompt import (
    EXTRACTION_PROMPT,
    STAGE2_JSON_SHAPE,
    STAGE2_SYSTEM,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    VLM_TRANSCRIPTION_PROMPT,
)
from app.prompts.nl_search_prompt import (
    NL_SEARCH_PROMPT_TEMPLATE,
    build_nl_search_prompt,
)
from app.prompts.ocr_prompt import OCR_PROMPT

#: name -> (prompt text, one-line purpose, runs in the live worker path)
PROMPT_REGISTRY: dict[str, tuple[str, str, bool]] = {
    "VLM_TRANSCRIPTION_PROMPT": (
        VLM_TRANSCRIPTION_PROMPT,
        "Stage 1: page image -> faithful structured markdown.",
        True,
    ),
    "STAGE2_SYSTEM": (
        STAGE2_SYSTEM,
        "Stage 2: markdown -> listings via forced tool-use.",
        True,
    ),
    "OCR_PROMPT": (
        OCR_PROMPT,
        "Plain OCR for the supplier-identity pass.",
        True,
    ),
    "COMPANY_PROMPT": (
        COMPANY_PROMPT,
        "Supplier identity from cover/contact pages.",
        True,
    ),
    "CHAT_SYSTEM_PROMPT": (
        CHAT_SYSTEM_PROMPT,
        "Sourcing-assistant chat panel.",
        False,
    ),
    "NL_SEARCH_PROMPT_TEMPLATE": (
        NL_SEARCH_PROMPT_TEMPLATE,
        "Natural-language search -> filter JSON.",
        False,
    ),
    "EXTRACTION_PROMPT": (
        EXTRACTION_PROMPT,
        "Legacy whole-document extraction (the worker does NOT call this).",
        False,
    ),
}

__all__ = [
    "CHAT_SYSTEM_PROMPT",
    "CITATION_PATTERN",
    "COMPANY_PROMPT",
    "EXTRACTION_PROMPT",
    "NL_SEARCH_PROMPT_TEMPLATE",
    "OCR_PROMPT",
    "PROMPT_REGISTRY",
    "STAGE2_JSON_SHAPE",
    "STAGE2_SYSTEM",
    "TOOL_DESCRIPTION",
    "TOOL_NAME",
    "TOOL_PARAMETERS",
    "VLM_TRANSCRIPTION_PROMPT",
    "build_nl_search_prompt",
    "build_system_prompt",
    "build_user_turn",
]
