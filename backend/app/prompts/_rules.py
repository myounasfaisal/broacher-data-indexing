"""
Shared, composable prompt blocks — the SINGLE source of truth for every
extraction rule.

WHY THIS FILE EXISTS
--------------------
Extraction rules used to be written twice: once in `EXTRACTION_PROMPT` (the
whole-document path) and once, much more thinly, in `_STAGE2_SYSTEM` (the
per-page path the worker actually runs). They drifted, and the drift cost real
data:

  A Dairen Chemical brochure has a spec table whose FIRST ROW is a merged,
  full-width cell reading "Vinyl acetate-ethylene (VAE) emulsion 醋酸乙烯 –
  乙烯共聚物", followed by ~14 grade rows (DA-100, DA-100L, DA-101, ...). Every
  one of those rows landed in the database as a bare code — "DA-100" — with no
  family name anywhere. Searching "Vinyl acetate-ethylene" returns zero results
  for products we actually hold. A second table on the same brochure (EVAC,
  DA-801+) kept its family name, so the failure was silent and inconsistent.

  Two independent causes, one per stage:
    STAGE 1 — a merged full-width label row cannot be represented in a markdown
      table. Transcribed naively it becomes a ragged row (or vanishes), so the
      label stops being attached to the rows beneath it.
    STAGE 2 — the only inheritance rule in the live prompt covered labels
      "printed on an earlier page". This label was on the SAME page, so no rule
      applied and compliance was left to chance.

  The fix for the stage-2 half already existed — in EXTRACTION_PROMPT, which is
  dead code the worker never calls.

So: every rule lives here exactly once, and every prompt composes from these
blocks. Fixing a rule here fixes it on all paths simultaneously. Never restate
a rule inline in a prompt file — edit the block here instead.

COST NOTE
---------
These blocks make the per-page prompts meaningfully longer. That is affordable
because both call sites mark them `cache_control: ephemeral` — the text is
byte-identical on every page, so it bills at 0.1x base input after the first
page of a document. Prompt caching is what buys us room for rules this explicit.
"""

from __future__ import annotations

# ===========================================================================
# STAGE 1 BLOCKS — faithful transcription
# ===========================================================================
# Stage 1's only job is lossless structure-preserving transcription. Every
# "stage 2 reasoned badly" bug we have traced ended up being stage 1 quietly
# destroying the structure that carried the meaning.

TABLE_FIDELITY = """\
TABLES — STRUCTURE IS MEANING (the highest-value rule here):

Reproduce every table with all rows, columns, units, footnote markers, and \
empty cells intact.

MERGED / SPANNING LABEL ROWS need special handling. Brochure spec tables very \
often contain a row that spans the full table width and holds a category, \
family, or section name rather than data — it silently labels every row below \
it until the next such row. A markdown table CANNOT represent a merged cell, so \
transcribing it as a normal row destroys the relationship.

When you meet a full-width label row, do NOT emit it as a table row. Instead \
close the table, emit the label as a markdown heading, and start a fresh table \
for the rows beneath it:

  ### Vinyl acetate-ethylene (VAE) emulsion 醋酸乙烯 – 乙烯共聚物
  | Grade | Stabilization system | Solid content (wt%) | Viscosity (cP) |
  | --- | --- | --- | --- |
  | DA-100 | P | 55.0 | 1100-1600 |
  | DA-100L | P | 54.5 | 500-1000 |

  ### Ethylene-vinyl acetate-vinyl chloride (EVAC) emulsion
  | Grade | Stabilization system | Solid content (wt%) | Viscosity (cP) |
  | --- | --- | --- | --- |
  | DA-801 | P+S | 50.0 | 3000-4000 |

Repeat the column header row for each new sub-table so no section is left \
headerless. Keep the label text EXACTLY as printed, in every language/script it \
appears in — never translate, abbreviate, or normalise it here.

PRODUCT PHOTOS IN TABLE CELLS carry text you must not drop. Many brochures have \
a "Product" column holding a photograph of the labelled container rather than \
the product's name in text. The brand and product name are PRINTED ON THAT \
LABEL, and they are frequently the only place the real SKU appears anywhere on \
the page. Read the label and transcribe what it says into the cell, as text:

  | 1. | RESSI EPO CRACK FILL | A three-part solvent free epoxy system ... |
  | 2. | RESSI EPO CRACK FILL LV | A three-part solvent free low viscosity ... |

Zoom in mentally on the packaging and read every legible line: brand name, \
product name, and any variant suffix (LV, WR, CR, HD, 2K, ...). The suffix is \
often what distinguishes one row from the next, so losing it collapses distinct \
products into one.

If the label text is genuinely too small or blurred to read, write \
[product image: unreadable] in that cell. Do NOT write a generic placeholder \
like "Product Image 1", do NOT invent a filename, and NEVER fabricate an image \
URL — a downstream step decides what to do with an unreadable label, and it can \
only do that if you reported honestly that you could not read it.

The same applies to a label printed immediately above a table rather than \
inside it: keep it directly above that table as a heading, never separated from \
it by other content.

If a table continues from a previous page without reprinting its column \
headers, transcribe the rows you can see and note "(table continues)" — do not \
invent headers.
"""

TRANSCRIPTION_FIDELITY = """\
FIDELITY RULES:
- Preserve the original language and script exactly as printed. Do NOT \
translate anything at this stage.
- Preserve heading hierarchy with markdown headers (#, ##, ###) mirroring the \
visual hierarchy — large bold section titles outrank sub-labels.
- Preserve bullet lists as markdown bullets, keeping each bullet under its \
parent category heading. A line that bundles several codes together \
("Silane: A171, A110, A170, A187") stays on ONE line exactly as printed — do \
NOT split or reinterpret it here; that decision happens later with more context.
- Transcribe every code, number, symbol, and footnote on the page, including \
small print, packaging text, legend/footnote keys (e.g. "P = PVOH 聚乙烯醇"), \
and contact or certification details. Even if something looks irrelevant, keep \
it — relevance is not decided at this stage.
- Reproduce symbol-based rating marks as printed (◎, ○, ●) rather than \
interpreting them, and keep any legend that explains them.
- If a region is genuinely illegible, write [illegible] in its place rather \
than guessing.
- Add no commentary, labels, headings, or explanation of your own. Output only \
the transcription.
"""


# ===========================================================================
# STAGE 2 BLOCKS — transcription to structured listings
# ===========================================================================
# Ordered as a funnel: gate junk out, then get identity right, then fields,
# then the floor, then a re-read. Prompts should preserve this order.

# --- 1. Is it a product at all? -------------------------------------------
# Two failure modes that both manufacture listings which do not exist.

IS_IT_A_PRODUCT = """\
STEP 1 — WHAT COUNTS AS A PRODUCT (decide this before naming anything):

CONTEXT-ANCHOR RULE — extract something as a product only if it sits inside an \
actual product listing: a row in a spec table, a bullet under a product \
category, or text paired with other product information. A code or number in a \
footer, header, certification stamp, document/revision code, batch number, \
phone number, address, or page number is NOT a product, however \
product-shaped it looks.

APPLICATIONS ARE NOT PRODUCTS — never emit a product for an application, \
end-use, industry, or market segment that the brochure says its products are \
USED FOR. These are never products on their own: "primer", "tile adhesive", \
"joint compound", "joint filler", "mortar additive", "cement admixture", \
"waterproofing membrane", "interior paint", "adhesives", "coatings", \
"construction", "general adhesive", "wood adhesive", "cigarette adhesive", \
"nonwoven/carpet". Spec tables often carry an "Application" column listing \
exactly these — those are column headers describing recommended uses, not \
items for sale. Record them as characteristics.application on the product they \
describe.

Emit a product only when there is a named grade / model / SKU code, or a \
distinct chemical named as something offered.

SECTION HEADINGS — emit once, never twice. A heading like "EPOXY CRACK \
FILLERS" or "EPOXY PRIMERS" names a category, and how you treat it depends \
entirely on whether the section has product rows beneath it:

- IF the section HAS rows and you are emitting them: do NOT also emit the \
heading as a listing of its own. Every row already carries the category in its \
`product_family`, which is what makes the category searchable. Emitting the \
heading too creates a duplicate that inflates the supplier's product count and \
returns the same supplier repeatedly for one category search.
- IF the section has NO rows beneath it — the supplier simply states they offer \
this category, with no variants listed — then DO emit one listing for it, so \
the offering is not lost. Name it "<Supplier> <Category>" in Title Case \
("Ressichem Epoxy Primer"), never the raw heading in caps.

The test: would emitting this heading duplicate something already covered by a \
row's product_family? If yes, skip it. If it is the only record that the \
supplier offers this category at all, keep it.
"""

# --- 2. Product identity: the two mirror-image context failures ------------
# These rules pull in OPPOSITE directions and are easy to confuse, so they are
# stated together with an explicit disambiguating test. The worked example is
# retained in full — without it, compliance measurably drops.

PRODUCT_IDENTITY = """\
STEP 2 — PRODUCT IDENTITY AND INHERITED CONTEXT (the most common and most \
damaging miss — read carefully):

Brochures routinely state a category / family / section label ONCE, then list \
many grade-code rows under it without ever repeating it. That label is not \
itself a product, and it is not optional context either: it states what every \
row beneath it IS. A bare grade code like "DA-100" is meaningless alone and \
undiscoverable by anyone searching for the substance.

Carry inherited context into EVERY product beneath it:

1. NAME — put the FULL label text, exactly as printed, into both name_raw and \
name_en, combined with the row's own code. Write "Vinyl acetate-ethylene (VAE) \
emulsion DA-100", not "DA-100". Never invent an abbreviation; use a short form \
only if the short form is itself what the page printed.
2. FIELD — also set `product_family` to that label on its own, so it is \
queryable independently of the name string. If the label appears in several \
languages, put the English (or primary) form in `product_family` and the other \
form in characteristics (e.g. characteristics.product_family_zh).
3. SCOPE — inheritance continues down the page for every following row UNTIL a \
new label appears. A later "Ethylene-vinyl acetate-vinyl chloride (EVAC) \
emulsion" heading opens a new group; rows under THAT inherit EVAC, not the \
earlier label.
4. BREADTH — this applies to ANY context printed once that applies many times: \
section titles, category labels, umbrella headings, family names, a bold line \
above a table, a merged row spanning a table's full width. Not only polymer \
families.
5. ACROSS PAGES — it applies identically whether the label is on THIS page or \
was printed earlier and handed to you as CONTINUATION CONTEXT. A table \
continuing across a page break does not lose its identity.

WORKED EXAMPLE
The transcription contains the heading "Vinyl acetate-ethylene (VAE) emulsion \
醋酸乙烯 – 乙烯共聚物" above a table with the row \
"DA-100 | P | 55.0 | 1100-1600 | 4.5-6.5 | 0 | 0".

WRONG — label dropped, only the row survives. This is the real failure that \
made an entire product family unsearchable:
  {"name_raw": "DA-100", "name_en": "DA-100", "product_family": null}

ALSO WRONG — label captured but abbreviated into a form the page never printed:
  {"name_raw": "VAE DA-100", "name_en": "VAE DA-100", "product_family": "VAE"}

RIGHT — full printed label in the name AND in its own field:
  {
    "name_raw": "Vinyl acetate-ethylene (VAE) emulsion DA-100",
    "name_en": "Vinyl acetate-ethylene (VAE) emulsion DA-100",
    "product_family": "Vinyl acetate-ethylene (VAE) emulsion",
    "characteristics": {
      "grade": "DA-100",
      "product_family_zh": "醋酸乙烯 – 乙烯共聚物",
      "stabilization_system": "P",
      "solid_content_wt_pct": "55.0",
      "viscosity_cp": "1100-1600",
      "ph": "4.5-6.5"
    }
  }

IDENTITY FALLBACK LADDER — what to name a row whose own name cell is unusable.

Some tables have no product-name column at all: the "Product" cell holds a \
photograph, or is blank, and only a row number (S.No) identifies it. NEVER \
manufacture a SKU-shaped name from the section title plus that row number. \
"EPOXY PRIMER 6" and "EPOXY PRIMER S.No 10" are inventions — they look like \
real part numbers, they are not, and a buyer who searches for them finds \
nothing while trusting the catalog less. Row indices are positions in a \
printed table, not product identity.

Work DOWN this ladder and stop at the first level that yields a real name:

1. LABEL TEXT — the product name transcribed from the packaging photo in that \
row (e.g. "RESSI EPO CRACK FILL LV"). Use it verbatim, in the printed casing \
if it is a brand-style name.
2. NAME IN THE DESCRIPTION — brochure descriptions very often name the product \
in prose even when the name column is a photo: "Ressi EPO Roll Coat can be \
applied to steel and concrete internal tank surfaces". Extract "Ressi EPO Roll \
Coat" and use it.
3. CHEMISTRY FROM THE DESCRIPTION — when no trade name exists anywhere, build \
the name from the chemistry the description states, e.g. \
"Bisphenol-A / polyamide epoxy crack filler". This is honest, and it is \
searchable by the substance a buyer actually asks for.
4. SUPPLIER + CATEGORY — last resort: "<Supplier> <Category>" in Title Case, \
e.g. "Ressichem Epoxy Crack Filler". Set confidence "low" so the row is \
flagged for a human to fill in the real name later.

Levels 3 and 4 will repeat the same name across several rows of a section. \
That is correct and expected — the rows are still distinct products, \
differentiated by their packaging, density, coverage and chemistry, all of \
which belong in characteristics. Do not merge them, and do not add a number to \
tell them apart.

Never emit SCREAMING CAPS as a product name unless the source itself prints \
the brand that way. "EPOXY CRACK FILLERS" is a section heading; \
"Ressichem Epoxy Crack Filler" is a product name.

MANDATORY SPLITTING RULE (the mirror image — also always applies):
Some brochures instead bundle several grades onto ONE line, e.g. \
"Silane: A171, A110, A170, A187". That is always multiple distinct products — \
emit one listing per code, each named "<Category> <code>".

THE TEST that separates these two rules: does the shared text sit ABOVE or \
OUTSIDE the rows? Inherit it downward into every row. Is it packed INSIDE one \
row's own name alongside several codes? Split that row apart. A label above \
many already-separate rows is inheritance, never a bundle.
"""

# --- 3. Field-level discipline --------------------------------------------
# Each rule encodes a specific observed miscategorisation.

FIELD_RULES = """\
STEP 3 — FIELD RULES:

CAS NUMBERS — transcribe exactly as printed. Never reformat, correct, complete \
missing digits, or supply a CAS you happen to know for the substance. Null when \
none is printed for that product. Checksum validation is deterministic code \
downstream, not your job.

PURITY — pull purity / concentration / content / assay into `purity` whenever \
it is printed for the product, INCLUDING when embedded in the product name or a \
spec label. Recognise all of these:
  "Mold Release (60%)"             -> purity "60%"
  "Sulfamic acid Content 99.5%"    -> purity "99.5%"
  "Copper sulfate >=98%"           -> purity ">=98%"
  "Purity: 99.9%" / "content: 70%" -> purity "99.9%" / "70%"
  "Industrial Grade >=99.6%"       -> purity ">=99.6%"
Keep the value exactly as printed, including a leading >= or <=, and still keep \
the full name in name_raw. When several numbers appear, use the one labelled \
purity / content / assay / concentration — never a packaging size ("25kg/bag"), \
a solid-content spec, or a model number.

FORMULA vs GRADE CODE — treat a value as a chemical formula only if it is a \
genuine molecular formula of real element symbols (C2H5OH, NaOH, C6H12O6). \
Catalog / grade / model codes are NOT formulas however formula-shaped they look \
(SM827, A171, DA-250, DA-100, PDMS 350); those belong in characteristics.grade.

PRICE AND CURRENCY — only when printed for that product. Never derive a price \
from another product, a range, or a packaging size.

CHARACTERISTICS — be exhaustive, using short snake_case keys. Capture every \
other printed attribute: viscosity, solid content, pH, Tg, MFFT, spindle/RPM, \
stabilization system, appearance, packaging, storage, hazard class, trade \
terms, special features, recommended applications. Carry units into the key or \
value as the page shows them (solid_content_wt_pct, viscosity_cp). Expand \
legend codes when the page provides a legend (e.g. a "P" stabilization value \
with legend "P = PVOH" may be recorded as "P (PVOH)"). Only what is printed.
"""

# --- 4. The floor ---------------------------------------------------------

NEVER_INVENT = """\
STEP 4 — NEVER invent, infer, complete, or look up data. Use only what is \
physically present in the transcription. If a field is not printed for a \
product, leave it null or omit the characteristics key. When unsure whether \
something was printed, leave it out. Set confidence "low" when the source was \
unclear, the table structure ambiguous, or any value had to be inferred rather \
than read.
"""

# --- 5. Self-check --------------------------------------------------------
# A cheap re-read targeting the rules models endorse in principle and violate
# in practice.

SELF_CHECK = """\
STEP 5 — SELF-CHECK before finalizing. Verify each of these and fix what fails:
- For EVERY product: did I have to look above, beside, or outside its own row \
to know what kind of thing it is? If yes, is that context actually present in \
name_raw, name_en AND product_family — not merely implied by page position? A \
listing whose name is only a bare code has almost certainly failed this check.
- For EVERY product whose name contains a comma, slash, or "and"/"or" joining \
several codes: that is a bundle. Split it now.
- Did I emit any listing whose name is an application or end-use ("primer", \
"wood adhesive") rather than a named grade or chemical? Remove it.
- Did I emit anything sourced from a footer, page number, or certification \
stamp? Remove it.
- Does any product name contain a row number or S.No index ("EPOXY PRIMER 6", \
"Product 12")? That is invented identity. Rename it using the identity \
fallback ladder — label text, then a name in the description, then the \
chemistry, then "<Supplier> <Category>".
- Did I emit a section heading as its own listing while ALSO emitting the rows \
underneath it? Drop the heading; the rows carry the category in product_family.
- Is any product name in SCREAMING CAPS that the source did not print that way? \
Convert it to Title Case.
"""


# ===========================================================================
# Composition
# ===========================================================================

#: Stage-1 transcription blocks, in order.
STAGE1_BLOCKS: tuple[str, ...] = (
    TRANSCRIPTION_FIDELITY,
    TABLE_FIDELITY,
)

#: Stage-2 judgment-call blocks, in funnel order. Both the per-page stage-2
#: prompt and the whole-document EXTRACTION_PROMPT compose from this exact
#: tuple — that shared reference is what stops them drifting apart again.
STAGE2_BLOCKS: tuple[str, ...] = (
    IS_IT_A_PRODUCT,
    PRODUCT_IDENTITY,
    FIELD_RULES,
    NEVER_INVENT,
    SELF_CHECK,
)


def compose(*blocks: str) -> str:
    """Join prompt blocks into one section, blank-line separated, no stray gaps."""
    return "\n\n".join(block.strip() for block in blocks if block and block.strip())
