"""
Exchange rates: normalize listing prices to USD (cross-currency sort/filter)
and convert to PKR (display).

Rate source, in order of preference:
  1. In-memory cache (12h TTL).
  2. Live fetch from open.er-api.com (free, no API key). On success the
     snapshot is upserted into the exchange_rates table.
  3. The exchange_rates table (last successful snapshot — survives restarts
     and offline operation).
  4. A small hardcoded seed, so conversion never hard-fails.

Conversions use CURRENT rates — honest approximations for comparison, not
historical accounting values (the UI labels them with "≈").
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_RATES_URL = "https://open.er-api.com/v6/latest/USD"
_TTL_SECONDS = 12 * 60 * 60

# Emergency fallback (approximate mid-2026 values, units per 1 USD) — used
# only when both the live API and the DB snapshot are unavailable.
_SEED_RATES: dict[str, float] = {
    "USD": 1.0,
    "CNY": 7.2,
    "EUR": 0.93,
    "GBP": 0.79,
    "JPY": 155.0,
    "INR": 87.0,
    "PKR": 283.0,
    "AED": 3.67,
    "SAR": 3.75,
    "KRW": 1400.0,
}

# What extraction actually puts in `currency` (live data: "Yuan/ton",
# "USD/ton", "Yuan/mt", plus symbols): the token before any "/unit" suffix,
# mapped to an ISO code. "¥" maps to CNY — this platform's brochures are
# overwhelmingly Chinese suppliers; Japanese ones print JPY/円.
_CURRENCY_ALIASES: dict[str, str] = {
    "USD": "USD", "US$": "USD", "$": "USD", "DOLLAR": "USD", "DOLLARS": "USD",
    "CNY": "CNY", "RMB": "CNY", "YUAN": "CNY", "元": "CNY", "¥": "CNY",
    "EUR": "EUR", "€": "EUR",
    "GBP": "GBP", "£": "GBP",
    "JPY": "JPY", "YEN": "JPY", "円": "JPY",
    "INR": "INR", "₹": "INR",
    "PKR": "PKR", "RS": "PKR", "₨": "PKR", "RUPEE": "PKR", "RUPEES": "PKR",
    "AED": "AED", "SAR": "SAR",
    "KRW": "KRW", "₩": "KRW",
}

_lock = threading.Lock()
_cache: dict[str, float] = {}
_cache_at: float = 0.0


def normalize_currency(raw: str | None) -> str | None:
    """'Yuan/ton' -> 'CNY', 'USD/mt' -> 'USD', '$' -> 'USD'; None if unknown."""
    if not raw:
        return None
    token = raw.strip().split("/")[0].strip().upper()
    if not token:
        return None
    if token in _CURRENCY_ALIASES:
        return _CURRENCY_ALIASES[token]
    # A plain ISO-looking code we don't have an alias row for.
    if len(token) == 3 and token.isalpha():
        return token
    return None


def get_rates() -> dict[str, float]:
    """Current rates (units per 1 USD); cached, live-refreshed, DB-backed."""
    global _cache, _cache_at
    with _lock:
        if _cache and time.time() - _cache_at < _TTL_SECONDS:
            return _cache
        rates = _fetch_live()
        if rates:
            _save_snapshot(rates)
        else:
            rates = _load_snapshot() or dict(_SEED_RATES)
        _cache, _cache_at = rates, time.time()
        return _cache


def to_usd(price: float | None, currency: str | None) -> float | None:
    """Convert a listing price to USD; None when unpriced or unrecognized."""
    if price is None:
        return None
    code = normalize_currency(currency)
    if code is None:
        return None
    rate = get_rates().get(code)
    if not rate or rate <= 0:
        return None
    return round(float(price) / rate, 4)


def convert_usd(price_usd: Any, code: str) -> float | None:
    """Convert a USD amount into another currency (display helper)."""
    if not isinstance(price_usd, (int, float)):
        return None
    rate = get_rates().get(code)
    if not rate or rate <= 0:
        return None
    return round(float(price_usd) * rate, 2)


def _fetch_live() -> dict[str, float] | None:
    try:
        resp = httpx.get(_RATES_URL, timeout=6.0)
        resp.raise_for_status()
        data = resp.json()
        rates = data.get("rates") or {}
        if data.get("result") == "success" and rates.get("USD") == 1:
            out = {
                code: float(v)
                for code, v in rates.items()
                if isinstance(v, (int, float)) and v > 0
            }
            logger.info("Fetched %d exchange rates", len(out))
            return out
    except Exception:  # noqa: BLE001 — fall back to snapshot/seed
        logger.warning("Live exchange-rate fetch failed", exc_info=True)
    return None


def _save_snapshot(rates: dict[str, float]) -> None:
    """Best-effort persist so restarts / offline runs keep converting."""
    try:
        # Lazy import: database.py imports this module, so a top-level import
        # here would be circular.
        from app.services.database import get_client

        rows = [{"code": c, "rate_per_usd": r} for c, r in rates.items()]
        get_client().table("exchange_rates").upsert(rows, on_conflict="code").execute()
    except Exception:  # noqa: BLE001
        logger.warning("Could not persist exchange-rate snapshot", exc_info=True)


def _load_snapshot() -> dict[str, float] | None:
    try:
        from app.services.database import get_client  # lazy: see _save_snapshot

        resp = (
            get_client().table("exchange_rates").select("code, rate_per_usd").execute()
        )
        rows = resp.data or []
        if rows:
            return {r["code"]: float(r["rate_per_usd"]) for r in rows}
    except Exception:  # noqa: BLE001
        logger.warning("Could not load exchange-rate snapshot", exc_info=True)
    return None
