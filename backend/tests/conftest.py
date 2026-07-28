"""
Shared test fixtures.

The one thing every test in this suite needs: the DB settings overlay off.

Runtime config is read through `config.eff_*`, which prefers an `app_settings`
row over the env value. That is the whole point of the admin Settings page —
but in a test it means a developer with real Supabase credentials in their
environment gets the *deployment's* saved settings instead of the ones the test
just monkeypatched onto `settings`, and the suite passes or fails depending on
whose machine it runs on. Disabling the overlay makes `eff_*` fall through to
the env/pydantic defaults, which is what tests patch and assert against.

Tests that specifically exercise the overlay can populate
`app_settings._cache` themselves; this fixture only guarantees the starting
state is empty.
"""

import pytest

from app.services import app_settings


@pytest.fixture(autouse=True)
def _no_db_settings_overlay(monkeypatch):
    """Make `get_raw` answer None for everything, so `eff_*` uses env values."""
    monkeypatch.setattr(app_settings, "_cache", {})
    # `ensure_loaded` is stubbed rather than the `_loaded` flag set: the real
    # one re-reads on a TTL, so a flag alone would let the DB back in partway
    # through a slow test run.
    monkeypatch.setattr(app_settings, "ensure_loaded", lambda: None)
