"""
Prompt for the supplier-identity pass.

The supplier name is normally printed once, on the cover or the contact/footer
page — not repeated on every product page. Per-page product extraction therefore
misses it reliably. We recover it with one focused pass over the first two and
last two pages (see worker._extract_identity), OCRing them and then asking a text
model only "who published this brochure?".

Kept deliberately narrow: it must not attempt product extraction, because doing
so would duplicate — and disagree with — the per-page pipeline.
"""

from __future__ import annotations

COMPANY_PROMPT = (
    "You are identifying the SUPPLIER company that published this chemical "
    "brochure. From the page text below (typically the cover and the "
    "contact/footer page), return ONLY a JSON object with exactly these keys:\n"
    '{"company_name": <supplier name exactly as printed, in its original '
    'language/script, or null>, "company_name_en": <English form of the name, '
    'or null>, "company_website": <website URL if printed, else null>, '
    '"company_email": <contact email if printed, else null>, '
    '"company_phone": <contact phone number exactly as printed, else null>}\n'
    "Use only what is printed. Do NOT list products. If the name is not "
    "printed, use null."
)
