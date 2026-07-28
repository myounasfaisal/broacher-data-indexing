"""
Provider SDK clients, built from the *effective* configuration.

Every module that talks to a model provider used to build its own client from
`settings.<key>` — the env snapshot taken at process start. Six copies of the
same three lines, and none of them could ever see a key an admin saved on the
Settings page: the page wrote `app_settings` rows that no runtime path read.

This module is the single place a provider client is constructed. Two rules
make the Settings page actually work:

  * Credentials are read through `eff_str` at **call** time, so a saved change
    is visible on the next call.
  * Each cached client remembers the credentials it was built from and is
    rebuilt when they change. A plain `if client is None` cache would pin the
    first key read for the life of the process, which is the same bug wearing
    a different hat.

Clients are cheap to construct (no connection is opened until a request), so
rebuilding on a credential change costs nothing worth optimising.
"""

from __future__ import annotations

import threading
from typing import Any

import anthropic
from google import genai
from openai import OpenAI

from app.config import eff_str

# One lock for the whole module. Extraction runs pages through a
# ThreadPoolExecutor, so two workers can reach a factory at once; without this
# they can race to build the same client and one of them discards the other's.
_lock = threading.Lock()

# name -> (client, credentials it was built from)
_cache: dict[str, tuple[Any, tuple[str, ...]]] = {}


def _cached(name: str, creds: tuple[str, ...], build) -> Any:
    """Return the cached client for `name`, rebuilding when `creds` differ."""
    with _lock:
        hit = _cache.get(name)
        if hit is not None and hit[1] == creds:
            return hit[0]
        client = build()
        _cache[name] = (client, creds)
        return client


def reset() -> None:
    """Drop every cached client. Called after an admin saves settings so the
    next call rebuilds even if a credential changed in a way the tuple can't
    see (a base URL cleared back to its default, say)."""
    with _lock:
        _cache.clear()


def anthropic_client() -> anthropic.Anthropic:
    key = eff_str("anthropic_api_key")
    return _cached("anthropic", (key,), lambda: anthropic.Anthropic(api_key=key))


def gemini_client() -> genai.Client:
    key = eff_str("gemini_api_key")
    return _cached("gemini", (key,), lambda: genai.Client(api_key=key))


def qwen_client() -> OpenAI:
    """Qwen via DashScope's OpenAI-compatible endpoint. Shared by extraction,
    OCR, the two-stage pipeline, chat and embeddings — one key, one client."""
    key = eff_str("qwen_api_key")
    base = eff_str("qwen_api_base")
    return _cached(
        "qwen", (key, base), lambda: OpenAI(api_key=key, base_url=base)
    )


def openai_client() -> OpenAI:
    """Real OpenAI — or whatever OpenAI-compatible endpoint the base URL names.
    Distinct from `qwen_client`, which points the same SDK at DashScope."""
    key = eff_str("openai_api_key")
    base = eff_str("openai_api_base")

    def build() -> OpenAI:
        kwargs: dict[str, Any] = {"api_key": key}
        if base:
            kwargs["base_url"] = base
        return OpenAI(**kwargs)

    return _cached("openai", (key, base), build)


def openrouter_client() -> OpenAI:
    key = eff_str("openrouter_api_key")
    base = eff_str("openrouter_api_base")
    return _cached(
        "openrouter", (key, base), lambda: OpenAI(api_key=key, base_url=base)
    )
