"""
Admin-configurable application settings backed by the app_settings table.

Settings are cached in-memory and refreshed on admin writes.  The cache is
a simple dict so every read after the first startup is free (no DB round-
trip).  API keys are masked when returned to the frontend — full values
are never sent over the wire on GET.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from app.services.database import get_client, _db_op, DatabaseError

logger = logging.getLogger(__name__)

# In-memory cache: {key: {key, value, is_secret, category, label, description}}
_cache: dict[str, dict[str, Any]] = {}
_loaded = False
_loaded_at = 0.0

# How long a process trusts its cached copy before re-reading. See
# `ensure_loaded` for why this exists at all.
_CACHE_TTL_SECONDS = 30.0

# Categories in display order.
#
# Four task-shaped sections, not eight type-shaped ones. Each is one complete
# decision the admin makes: what extracts brochures, what answers chat, what
# powers similarity search, and how the box behaves. The old split (API Keys /
# Models / Extraction Pipeline as peers) forced three section visits to
# configure one provider and never said so.
#
# 'credentials' and 'models' are deliberately NOT sections. Their rows are
# shared — qwen_api_key serves extraction, chat and search — so the frontend
# renders each one inside whichever feature is using it, filtered by that
# feature's selected provider. They appear here only so search results can
# still label them.
CATEGORIES = [
    "extraction",
    "chat",
    "search",
    "system",
    "credentials",
    "models",
]

# Display order within a category. Postgres returns rows in no guaranteed
# order without an ORDER BY, so without this the fields shuffle between loads —
# and a settings page whose fields move is one you have to re-read every visit.
# Ordering here rather than in SQL keeps it semantic (concurrency next to DPI)
# instead of alphabetical, and needs no migration.
SETTING_ORDER: list[str] = [
    # extraction — who extracts, then how, then what gets attached afterwards
    "extraction_provider", "page_extract_provider", "search_provider",
    "page_concurrency", "split_dpi",
    "pubchem_enrichment", "pubchem_cas_lookup",
    # chat — the on/off switch first, then who runs it, then its limits
    "chat_enabled", "chat_provider", "chat_effort", "chat_max_messages",
    "chat_max_tool_iterations", "chat_rate_limit",
    # search
    "embeddings_enabled", "embedding_provider",
    "embedding_match_count", "embedding_min_similarity", "embedding_dim",
    # system
    "max_upload_size_mb", "api_max_retries", "allowed_origin",
    "reconciler_interval_seconds", "document_stale_seconds",
    "max_page_attempts",
    # credentials — live keys first, endpoints after
    "anthropic_api_key", "openai_api_key", "qwen_api_key", "gemini_api_key",
    "openrouter_api_key", "nuextract_api_key",
    "openai_api_base", "qwen_api_base", "openrouter_api_base",
    "nuextract_api_base", "nuextract_project_id",
    # models
    "claude_model", "openai_model", "qwen_model", "qwen_vlm_model",
    "qwen_text_model", "gemini_model", "openrouter_model",
    "page_extract_claude_model", "embedding_model",
    "chat_anthropic_model", "chat_gpt_model", "chat_qwen_model",
]

_ORDER_INDEX = {key: i for i, key in enumerate(SETTING_ORDER)}

CATEGORY_LABELS: dict[str, str] = {
    "extraction": "Extraction",
    "chat": "Chat assistant",
    "search": "Semantic search",
    "system": "System",
    "credentials": "API keys",
    "models": "Models",
}

# Sections the rail offers. The two omitted ones are rendered inside these.
NAV_CATEGORIES = ["extraction", "chat", "search", "system"]


def _mask(value: str) -> str:
    """Mask a secret value for display: show first 4 and last 4 chars."""
    if len(value) <= 10:
        return "****" if value else ""
    return value[:4] + "****" + value[-4:]


@_db_op
def _load_all() -> list[dict[str, Any]]:
    resp = get_client().table("app_settings").select("*").execute()
    return resp.data or []


def load_cache() -> None:
    """(Re)load every setting from the DB into the in-memory cache.

    Rebuilds the provider SDK clients if any value actually moved, so a key
    changed in the API process reaches this one's next model call.
    """
    global _loaded, _loaded_at
    try:
        rows = _load_all()
        before = {k: v["value"] for k, v in _cache.items()}
        _cache.clear()
        for row in rows:
            _cache[row["key"]] = row
        _loaded = True
        _loaded_at = time.monotonic()

        after = {k: v["value"] for k, v in _cache.items()}
        if before and before != after:
            # Imported lazily: llm_clients imports config, config imports this.
            from app.services import llm_clients
            llm_clients.reset()
            logger.info("app_settings changed — provider clients reset")
        else:
            logger.info("Loaded %d app_settings from DB", len(_cache))
    except DatabaseError:
        logger.warning("Could not load app_settings — table may not exist yet")
        _loaded = False


def ensure_loaded() -> None:
    """Load on first use, then re-check periodically.

    The TTL is what makes the Settings page work outside the API process. The
    worker and the reconciler are separate processes: they never call
    `update_settings`, so without a refresh their cache would hold whatever
    the DB said when they booted, and a key saved in the admin UI would never
    reach the extraction that actually consumes it. That is the original bug
    (settings that don't apply) surviving in the one process that matters most.

    30s is chosen against the alternatives: a listen/notify channel is a lot of
    machinery for a table written by hand a few times a month, and per-read
    fetching would put a network round-trip in front of every model call.
    """
    if not _loaded or (time.monotonic() - _loaded_at) > _CACHE_TTL_SECONDS:
        load_cache()


def get_raw(key: str) -> str | None:
    """Return the raw (unmasked) value of a setting, or None if not in DB."""
    ensure_loaded()
    entry = _cache.get(key)
    if entry is None:
        return None
    return entry["value"] or None


def _sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    """(category position, position within category, key) — total and stable.
    Anything not listed in SETTING_ORDER sorts to the end of its category by
    key, so a newly seeded setting appears predictably instead of at random."""
    cat = row.get("category", "")
    return (
        CATEGORIES.index(cat) if cat in CATEGORIES else len(CATEGORIES),
        _ORDER_INDEX.get(row["key"], len(_ORDER_INDEX)),
        row["key"],
    )


def get_all_masked() -> list[dict[str, Any]]:
    """Return all settings with secrets masked — for the admin GET endpoint."""
    ensure_loaded()
    result = []
    for row in sorted(_cache.values(), key=_sort_key):
        entry = {
            "key": row["key"],
            "value": _mask(row["value"]) if row["is_secret"] else row["value"],
            "is_secret": row["is_secret"],
            "category": row["category"],
            "label": row["label"],
            "description": row["description"],
            "updated_at": row.get("updated_at"),
        }
        result.append(entry)
    return result


@_db_op
def update_settings(changes: dict[str, str], user_id: str) -> None:
    """
    Write a batch of setting changes to the DB and refresh the cache.
    Also writes audit rows for every changed value.
    """
    client = get_client()
    ensure_loaded()

    for key, new_value in changes.items():
        old_entry = _cache.get(key)
        if old_entry is None:
            continue

        # If this is a secret field and the new value looks like a mask,
        # skip it — the admin didn't change it.
        if old_entry["is_secret"] and "****" in new_value:
            continue

        old_value = old_entry["value"]
        if old_value == new_value:
            continue

        client.table("app_settings").update({
            "value": new_value,
            "updated_at": "now()",
            "updated_by": user_id,
        }).eq("key", key).execute()

        # Audit trail — mask secrets in the log too.
        audit_old = _mask(old_value) if old_entry["is_secret"] else old_value
        audit_new = _mask(new_value) if old_entry["is_secret"] else new_value
        client.table("settings_audit").insert({
            "setting_key": key,
            "old_value": audit_old,
            "new_value": audit_new,
            "changed_by": user_id,
        }).execute()

    load_cache()

    # Provider SDK clients are built from the values we just replaced. Dropping
    # them here means the next extraction/chat/embedding call rebuilds against
    # the new key — without this the page would save correctly and still run on
    # the old credentials, which is indistinguishable from not saving at all.
    # Imported lazily: llm_clients imports config, config imports this module.
    from app.services import llm_clients
    llm_clients.reset()


def get_categories() -> list[dict[str, str]]:
    """Return ordered category metadata for the frontend.

    `nav` marks the four that get a rail entry. Credentials and models are
    returned too — search results still need a label for them — but the rail
    skips them, because their rows are rendered inside the feature sections
    that use them rather than in a section of their own.
    """
    return [
        {
            "key": k,
            "label": CATEGORY_LABELS.get(k, k),
            "nav": k in NAV_CATEGORIES,
        }
        for k in CATEGORIES
    ]
