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
from typing import Any

from app.services.database import get_client, _db_op, DatabaseError

logger = logging.getLogger(__name__)

# In-memory cache: {key: {key, value, is_secret, category, label, description}}
_cache: dict[str, dict[str, Any]] = {}
_loaded = False

# Categories in display order.
CATEGORIES = [
    "extraction",
    "api_keys",
    "models",
    "chat",
    "embeddings",
    "enrichment",
    "limits",
    "reconciler",
]

CATEGORY_LABELS: dict[str, str] = {
    "extraction": "Extraction Pipeline",
    "api_keys": "API Keys",
    "models": "Models",
    "chat": "Chat Assistant",
    "embeddings": "Embeddings & Semantic Search",
    "enrichment": "PubChem Enrichment",
    "limits": "Behaviour & Limits",
    "reconciler": "Reconciler",
}


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
    """(Re)load every setting from the DB into the in-memory cache."""
    global _loaded
    try:
        rows = _load_all()
        _cache.clear()
        for row in rows:
            _cache[row["key"]] = row
        _loaded = True
        logger.info("Loaded %d app_settings from DB", len(_cache))
    except DatabaseError:
        logger.warning("Could not load app_settings — table may not exist yet")
        _loaded = False


def ensure_loaded() -> None:
    if not _loaded:
        load_cache()


def get_raw(key: str) -> str | None:
    """Return the raw (unmasked) value of a setting, or None if not in DB."""
    ensure_loaded()
    entry = _cache.get(key)
    if entry is None:
        return None
    return entry["value"] or None


def get_all_masked() -> list[dict[str, Any]]:
    """Return all settings with secrets masked — for the admin GET endpoint."""
    ensure_loaded()
    result = []
    for row in _cache.values():
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


def get_categories() -> list[dict[str, str]]:
    """Return ordered category metadata for the frontend."""
    return [
        {"key": k, "label": CATEGORY_LABELS.get(k, k)}
        for k in CATEGORIES
    ]
