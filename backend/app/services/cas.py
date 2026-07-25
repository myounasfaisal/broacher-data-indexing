"""
Deterministic CAS-number normalization + checksum (IMPLEMENTATION_BRIEF.md §5).

Pure functions — no DB, no API, no model. Reformatting a CAS number from its
raw digit string is mechanical and unambiguous, so it belongs in code: instant,
free, 100% consistent, and identical regardless of which model produced the
extraction. Keeping the model's output raw also preserves a clean error signal —
a checksum failure means a genuine OCR/transcription problem, not a formatting
decision the model made silently.

The model is instructed to transcribe the CAS number EXACTLY as printed
(`cas_number_raw`); everything below runs afterwards, before insert.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Label prefixes suppliers put in front of the number ("CAS", "CAS No.",
# "CAS#", "CAS-No:", "C.A.S.", ...). Stripped case-insensitively.
_LABEL_RE = re.compile(r"(?i)\bc\.?\s*a\.?\s*s\.?\b[\s.:#\-n№o]*")

# Per the brief: a stripped digit count outside this range means the text
# wasn't really a CAS number — leave cas_number null rather than force a match.
_MIN_DIGITS = 3
_MAX_DIGITS = 10


@dataclass(frozen=True)
class CasNormalization:
    """Outcome of normalizing one raw CAS string.

    `raw` is always preserved (goes to listings.cas_number_raw regardless of
    outcome). `canonical` is the hyphenated form for listings.cas_number, or
    None when the digit count is out of range. `checksum_ok` is only meaningful
    when `canonical` is set; it drives the needs_review CAS trigger (§6).
    """

    raw: str | None
    canonical: str | None
    checksum_ok: bool


def _digits_only(text: str) -> str:
    """Strip label prefixes, then everything that isn't a digit."""
    without_label = _LABEL_RE.sub("", text)
    return re.sub(r"\D", "", without_label)


def canonicalize(raw: str | None) -> str | None:
    """Return the canonical hyphenated CAS form, or None if the digit count is
    out of range (3–10). Format is `(leading)-(2 digits)-(1 check digit)`."""
    if not raw:
        return None
    digits = _digits_only(raw)
    if not (_MIN_DIGITS <= len(digits) <= _MAX_DIGITS):
        return None
    lead, middle, check = digits[:-3], digits[-3:-1], digits[-1]
    return f"{lead}-{middle}-{check}" if lead else f"{middle}-{check}"


def checksum_ok(canonical: str | None) -> bool:
    """Validate the CAS check digit: the weighted sum of the preceding digits
    (rightmost weighted 1, next 2, ...) mod 10 must equal the final digit."""
    if not canonical:
        return False
    digits = [c for c in canonical if c.isdigit()]
    if len(digits) < 2:
        return False
    check = int(digits[-1])
    body = digits[:-1]
    total = sum(int(d) * weight for weight, d in enumerate(reversed(body), start=1))
    return total % 10 == check


def normalize(raw: str | None) -> CasNormalization:
    """Full normalization for one raw CAS string: preserve raw, produce the
    canonical form (or None), and report whether the checksum passes."""
    canonical = canonicalize(raw)
    return CasNormalization(
        raw=raw,
        canonical=canonical,
        checksum_ok=checksum_ok(canonical) if canonical else False,
    )
