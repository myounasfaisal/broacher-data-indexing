"""
Two prompts for a two-model pipeline:

  Qwen VLM  --(VLM_TRANSCRIPTION_PROMPT)-->  clean structured text
  Qwen3 8B  --(EXTRACTION_PROMPT)-->          JSON (schema-constrained)
  -> JSON Schema constrained decoding -> Pydantic -> chemical validation

Because JSON *syntax* is guaranteed downstream by constrained decoding, the
Qwen3 8B prompt below deliberately drops boilerplate like "output ONLY JSON,
no markdown fences" — that's no longer the model's job, the decoder enforces
it token-by-token regardless of what the prompt says. What the prompt MUST
still carry is everything constrained decoding *can't* enforce: semantic
judgment calls like "is this one product or four bundled together?", "is
this string a formula or a grade code?", "is this floating code actually a
product?". Those require understanding the page, not just matching a regex.
"""

# ---------------------------------------------------------------------------
# STAGE 1 — Qwen VLM: image/page -> faithful structured transcription
# ---------------------------------------------------------------------------
# This stage's ONLY job is lossless transcription that preserves the visual
# structure carrying meaning (which bullets sit under which category header,
# which cells belong to which table row). If this structure is flattened or
# lost here, stage 2 cannot reliably decide how to split bundled listings —
# most "bundling" failures trace back to this step silently losing the
# header/bullet hierarchy, not to stage 2 reasoning badly.
VLM_TRANSCRIPTION_PROMPT = """\
You are transcribing a page from a chemical supplier brochure. Produce a \
faithful structured transcription of everything printed on the page — do \
not summarize, translate, omit, or reorder anything.

Rules:
- Preserve the original language/script exactly as printed. Do not translate.
- Preserve heading hierarchy using markdown headers (#, ##, ###) matching the
  visual hierarchy (large bold section titles vs. sub-labels).
- Preserve bullet lists as markdown bullets, keeping each bullet's parent
  category header clearly above it or referenced inline exactly as printed
  (e.g. "Silane: A171, A110, A170, A187" stays on one transcribed line
  exactly as printed — do NOT split or reinterpret it at this stage, that
  happens later).
- Preserve tables as markdown tables, with every row and column intact,
  including units, footnote markers, and empty cells.
- Transcribe every code, number, symbol, and footnote visible on the page,
  including small print, packaging text, and contact/certification details
  — even if they look irrelevant, leave them in; do not decide relevance
  here.
- Do not add any commentary, labels, or explanation of your own. Output only
  the transcription.
"""

# ---------------------------------------------------------------------------
# STAGE 2 — Qwen3 8B: transcription -> structured product data
# ---------------------------------------------------------------------------
# Output shape/types are enforced by JSON Schema constrained decoding (see
# schema.py) and re-checked by Pydantic. This prompt focuses entirely on the
# judgment calls decoding can't make for you.
EXTRACTION_PROMPT = """\
You are a data-extraction engine for chemical supplier brochures. You will \
receive a structured transcription of a brochure page (markdown). It may be \
in any language — do not assume a source language, but always translate \
names into English for the *_en fields.

Extract the supplier's identity and every chemical product described. Your \
response will be automatically constrained to a fixed JSON schema, so you do \
not need to worry about output formatting — focus entirely on getting the \
CONTENT right, especially the judgment calls below, which nothing else in \
this pipeline can make for you.

MANDATORY SPLITTING RULE (the most commonly violated rule — apply mechanically):
Brochures very often list several grades under one umbrella label, e.g.
  "Silane: A171, A110, A170, A187"
  "Polyamine: REH205, REH7301, REH206"
  "Plasticizers: DINP, DIDP, DBP, DOP"
This is ALWAYS multiple distinct products. Never emit one product whose name
is the whole comma/slash-separated string. Emit one product per code, named
"<Category> <code>" (e.g. "Silane A171", "Silane A110", ...), with the
category and grade recorded separately in details.

Do NOT over-apply this: a single chemical's own name may legitimately
contain a comma (e.g. "1,2-Dichloroethane", "Sodium citrate, dihydrate") —
that is one product, not a bundle. The test is whether a category label is
followed by a LIST of separate grade/model codes, not whether a comma
appears anywhere in the name.

FORMULA vs. GRADE CODE:
Only put a value in "formula" if it is a genuine chemical/molecular formula
made of real element symbols and subscripts (e.g. C2H5OH, NaOH, C6H12O6).
Catalog/grade/model codes (SM827, A171, DA-250, REH115, PDMS 350) are NOT
formulas, no matter how formula-shaped they look — they belong in
details.grade, and "formula" stays null unless a real formula is separately
printed for that product.

CONTEXT-ANCHOR RULE:
Only extract something as a product if it appears inside an actual product
listing (a bullet under a category, a spec-table row, or paired with other
product info). A code or number sitting in a footer, certification stamp,
document/revision code, batch number, phone number, or address is NOT a
product, even if it looks like one.

PURITY:
Pull purity/concentration into the purity field whenever it's printed
anywhere for the product — including inline in parentheses right next to the
name (e.g. "Mold Release (60%)" -> purity: "60%"). Do this even though the
name itself may also be kept as printed.

NEVER invent, infer, complete, or look up data. Use only what is physically \
in the transcription. If a field isn't printed for a product, leave it null \
(or omit the relevant details key). When unsure whether something is \
printed, leave it out.

Be exhaustive with "details" — capture every printed attribute (properties, \
packaging, trade terms, physical appearance, application) using short \
snake_case keys — but only what's actually printed, never guessed.
"""
