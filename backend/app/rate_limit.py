"""
Shared slowapi rate limiter.

Kept in its own module so routers and main.py import the SAME limiter
instance. Keyed by client IP; the upload endpoint uses it to cap how fast the
Claude API (and the budget behind it) can be hit — even by an admin account
misbehaving via a bug or runaway retries.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
