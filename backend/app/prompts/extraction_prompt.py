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
# v5 addition — TABLE-LEVEL HEADER INHERITANCE RULE.
# Real-world run (wsccp.pdf / Dairen Chemical): a brochure had a section header
#   "Vinyl acetate-ethylene (VAE) emulsion 醋酸乙烯 – 乙烯共聚物"
# printed ONCE, above a table of ~50 grade-code rows (DA-100, DA-101, ...) that
# spans several pages. The model extracted the grade codes but dropped the VAE
# family designation, because nothing in each row repeats it. Same root cause as
# the v4 bundling issue (context living outside the row gets lost) but the
# opposite direction: v4 un-bundles one row's text into several products; v5
# carries shared context INTO every row of a table, since it's printed once but
# applies many times — including across page breaks (see the continuation-context
# hint the per-page extractor injects in services/extraction.py).
EXTRACTION_PROMPT = """\
You are a data-extraction engine for chemical supplier brochures. You will \
receive a structured transcription of a brochure page. It may be in any \
language — do not assume a source language, but always translate names into \
English for the *_en fields.

Extract the supplier's identity and every chemical product described.

OUTPUT SHAPE — return ONE JSON object with EXACTLY these top-level keys (do
not rename them, do not invent alternatives like "supplier" or "manufacturer"):
{
  "company_name": <supplier name exactly as printed, original script, or null>,
  "company_name_en": <English supplier name, or null>,
  "company_website": <website URL if printed, else null>,
  "company_email": <contact email if printed, else null>,
  "company_phone": <contact phone/tel number exactly as printed, else null>,
  "products": [
    {
      "name_raw": <product name exactly as printed>,
      "name_en": <English product name>,
      "cas_number": <CAS number if printed, else null>,
      "price": <number if printed, else null>,
      "currency": <ISO code or symbol if printed, else null>,
      "purity": <e.g. "60%" if printed, else null>,
      "details": { <short snake_case keys for every OTHER printed attribute> }
    }
  ]
}
Rules for the shape:
- The supplier key is ALWAYS "company_name" (never "supplier"/"company"). If
  this page shows the supplier (cover, letterhead, or contact/footer), fill it;
  otherwise set company_name to null — do NOT omit the key.
- Output raw JSON only: no markdown code fences, no comments, no trailing
  commas, and escape every quote/newline inside string values so the result
  parses. If a page has no products, return "products": [].

Focus on getting the CONTENT right, especially the judgment calls below, which
nothing else in this pipeline can make for you.

TABLE-LEVEL HEADER INHERITANCE RULE (read carefully — a common miss):
Brochures very often print a category/family label ONCE, above a table of \
many grade-code rows, rather than repeating it on every row. Example:

  Vinyl acetate-ethylene (VAE) emulsion 醋酸乙烯 – 乙烯共聚物
  [table]
  Grade | Stabilization | Solid content | Viscosity | ...
  DA-100  | P    | 55.0 | 1100-1600 | ...
  DA-100L | P    | 54.5 | 500-1000  | ...
  DA-101  | P    | 55.0 | 1500-2500 | ...
  ... (dozens more rows)

The header "Vinyl acetate-ethylene (VAE) emulsion" is NOT itself a product —
but it is NOT optional context either. It describes what EVERY row in the
table below it actually is. You must carry it into EVERY product extracted
from that table:
  - Include the FULL header text (not an abbreviation you invent) as part of
    name_raw/name_en for every row, e.g. "Vinyl acetate-ethylene (VAE)
    emulsion DA-100" — not just "DA-100", and not a shortened "VAE DA-100"
    unless that abbreviated form is itself what's printed.
  - Also record it as its own field in details (e.g. details.category or
    details.polymer_family) with BOTH the English and any other-language
    form printed, so it's queryable independent of the name string.
  - This inheritance continues for every subsequent row UNTIL a new header
    appears (e.g. later in the same brochure, "Ethylene-vinyl acetate-vinyl
    chloride (EVAVC) emulsion" starts a new table — rows under THAT header
    inherit EVAVC, not VAE).
  - This applies to any shared context printed once above/beside a table or
    list, not just polymer family names — section titles, category labels,
    and umbrella headings all behave the same way. If you're extracting a
    row and had to look upward on the page to know what kind of thing it is,
    that upward-context must show up in the extracted record, not just in
    your own understanding of the page.

WORKED EXAMPLE:
Printed page shows header "Vinyl acetate-ethylene (VAE) emulsion 醋酸乙烯 –
乙烯共聚物" above a table containing row "DA-100 | P | 55.0 | 1100-1600 | ...".

WRONG — header dropped, only the row survives:
  { "name_raw": "DA-100", "name_en": "DA-100", "details": { "grade": "DA-100" } }

ALSO WRONG — header captured but abbreviated/invented rather than using the
full printed form:
  { "name_raw": "VAE DA-100", "name_en": "VAE DA-100", "details": { "grade": "DA-100" } }

RIGHT — full header text carried into both the name and a dedicated field:
  {
    "name_raw": "Vinyl acetate-ethylene (VAE) emulsion DA-100",
    "name_en": "Vinyl acetate-ethylene (VAE) emulsion DA-100",
    "details": {
      "grade": "DA-100",
      "polymer_family": "Vinyl acetate-ethylene (VAE) emulsion",
      "polymer_family_zh": "醋酸乙烯 – 乙烯共聚物"
    }
  }

MANDATORY SPLITTING RULE (the opposite situation — still applies):
Some brochures instead bundle several grades onto ONE row, e.g. "Silane: \
A171, A110, A170, A187". That is still always multiple distinct products — \
split into one entry per code, named "<Category> <code>". Do not confuse \
this with the header-inheritance case above: a table header shared above \
many already-separate rows is NOT a bundle to split; a single row \
containing a comma-separated list of codes IS a bundle to split. The test: \
does the shared text sit above/outside the row (inherit it downward into \
every row), or is it packed inside one row's own name field alongside \
multiple codes (split it apart)?

FORMULA vs. GRADE CODE:
Only put a value in "formula" if it is a genuine chemical/molecular formula \
made of real element symbols and subscripts (e.g. C2H5OH, NaOH, C6H12O6). \
Catalog/grade/model codes (SM827, A171, DA-250, DA-100, PDMS 350) are NOT \
formulas, no matter how formula-shaped they look — they belong in \
details.grade, and "formula" stays null unless a real formula is separately \
printed for that product.

CONTEXT-ANCHOR RULE:
Only extract something as a product if it appears inside an actual product \
listing (a bullet under a category, a spec-table row, or paired with other \
product info). A code or number sitting in a footer, certification stamp, \
document/revision code, batch number, phone number, or address is NOT a \
product, even if it looks like one.

APPLICATIONS ARE NOT PRODUCTS:
Do NOT emit a product for an application, end-use, or market segment that the \
brochure lists as something its products are USED FOR — e.g. "primer", "tile \
adhesive", "joint compound", "joint filler", "mortar additive", "cement \
admixture", "waterproofing membrane", "interior paint", "adhesives", \
"coatings", "construction". These are use-cases, not items for sale. Only emit \
a product when there is an actual named grade / model / SKU (e.g. a DA-xxx \
code) or a distinct chemical named as a product. If a section says a product \
is "recommended for primer and tile adhesive", that is `details.application`, \
never separate products.

PURITY:
Pull purity/concentration/content into the purity field whenever it's printed \
anywhere for the product, even when it is written as part of the product name \
or a spec label. Recognise ALL of these forms and copy the value into purity:
  "Mold Release (60%)"            -> purity: "60%"
  "Sulfamic acid Content 99.5%"   -> purity: "99.5%"
  "Copper sulfate ≥98%"           -> purity: "≥98%"
  "Purity: 99.9%" / "content: 70%"-> purity: "99.9%" / "70%"
  "Industrial Grade ≥99.6%"       -> purity: "≥99.6%"
Keep the value exactly as printed (including a leading ≥ or ≤), and still keep \
the full name in name_raw. If several numbers appear, use the one labelled \
purity/content/assay/concentration, not packaging sizes (e.g. "25kg/bag") or \
model numbers.

NEVER invent, infer, complete, or look up data. Use only what is physically \
in the transcription. If a field isn't printed for a product, leave it null \
(or omit the relevant details key). When unsure whether something is \
printed, leave it out.

Be exhaustive with "details" — capture every printed attribute (typical \
properties, packaging, trade terms, physical appearance, application \
recommendations) using short snake_case keys — but only what's actually \
printed, never guessed.

SELF-CHECK (do this before finalizing):
- For every product, ask: did I have to look above/outside this row on the \
  page to know its full identity (family, category, section)? If yes, is \
  that context actually present in name_raw/name_en and details — not just \
  implied? If it's missing, add it now.
- For every product whose name_raw contains a comma, slash, or "and"/"or" \
  joining codes: that's a bundle, split it now.
"""