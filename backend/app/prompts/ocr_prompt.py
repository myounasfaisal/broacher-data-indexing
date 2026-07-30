"""
Prompt for the plain-OCR pass (services/ocr.py).

Distinct from `VLM_TRANSCRIPTION_PROMPT`: this one is used where we want raw
text and nothing else — currently the supplier-identity pass, which OCRs the
cover and contact pages and then asks a text model who the supplier is. It
deliberately does NOT carry the table/heading-structure rules, because the
identity pass does not care about product tables and structure work would only
add tokens and latency for no benefit.

Use `VLM_TRANSCRIPTION_PROMPT` (app/prompts/extraction_prompt.py) for anything
whose output feeds product extraction.
"""

from __future__ import annotations

OCR_PROMPT = """\
You are an OCR engine. The image is one page of a scanned document.
Extract ALL visible text from the image faithfully and completely.

Rules:
- Reproduce the text exactly as it appears, preserving the original language \
and script (Chinese, English, Japanese, Korean, German, Arabic, etc.).
- Maintain the logical reading order (top to bottom, left to right for LTR \
scripts, right to left for RTL scripts).
- Separate distinct sections or columns with blank lines.
- Do NOT summarise, interpret, or add commentary. Output only the extracted text.
- If a section is illegible, write [illegible] in its place.
"""
