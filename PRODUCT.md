# Product

## Register

product

## Platform

web

## Users

BosTech Polymer's CEO and his team. BosTech is a Dubai-based industrial chemical
supplier trading epoxy raw materials and construction chemicals across the MENA and
GCC markets.

Both tiers use the whole app, including the dense Search/Inspector view — this is not
a system where executives get a summary and staff get the tool. The CEO runs his own
sourcing comparisons. He does so intermittently, between other commitments, often away
from a desk. The team works the same surfaces continuously: reviewing AI-matched
entries, comparing grades and specs across trade names, curating catalog data extracted
from supplier brochures.

The job is the same for both: find who supplies a chemical and on what specification,
and trust the answer. The difference is only tempo — one arrives cold and needs the
interface to explain itself, the other arrives warm and needs it to get out of the way.
Both conditions have to hold at once, on any screen size.

## Product Purpose

BrochureDB identifies the best supplier for a given product. A user searches a chemical
and the app answers **who to buy it from, on what specification**, drawing on a catalog
extracted from supplier brochure PDFs. Everything else — review queues, supplier
records, uploads, activity logs — exists to keep that answer trustworthy.

This is a decision tool, not a database browser. Search does not merely return matches;
it ranks a field of suppliers down to a choice.

Success is a sourcing question answered in seconds with enough confidence to act on,
and a review queue that stays drained because working through it is not a chore.

### Price is not the product — and this is deliberate

**Most supplier brochures do not print prices.** Expo brochures are specification
sheets: grade codes, solid content, viscosity, pH, purity, application
recommendations. Pricing is quoted later, per enquiry, per volume — it is rarely on the
printed page at all. Verified against the live catalog: **zero listings carry a printed
price**, across every supplier processed.

That is a fact about the source documents, not an extraction failure. Nothing is
broken, and no amount of prompt work will change it.

What this means for the product:

- **Price is an opportunistic bonus field, never the spine.** `price`, `currency`, and
  `price_usd` are captured faithfully when a brochure prints them and left null
  otherwise. A null price is the normal case, not a defect.
- **Never rank, gate, or filter by price by default.** Ranking by price ranks the
  catalog by which supplier happened to print a number — which is close to random and
  actively misleading. The assistant ranks by fit; `priced_only` is deliberately not
  exposed in search or in the assistant's tool schema (ARCHITECTURE.md §10, §14.3).
- **The comparison axis is specification, not cost.** Grade, purity, solid content,
  viscosity, family, and application are what a buyer actually discriminates on here.
  Search, the Inspector, and the assistant should all treat those as the primary
  dimensions.
- **"Missing price" is not a data-quality signal.** It says nothing about a listing's
  usefulness, so it must never read as an error or drag a listing down a ranking. It is
  reported in the dashboard's status split for completeness only.

The thing that *does* make or break this product is **identity**: whether a listing
carries the full name of what it is. A grade row stored as bare `DA-100`, stripped of
the `Vinyl acetate-ethylene (VAE) emulsion` family label printed above its table, is
unfindable by anyone searching for the substance — and that has happened
(ARCHITECTURE.md §0). Identity completeness is the metric that deserves the attention
price was getting.

## Positioning

Every supplier's brochure, searchable and comparable — the scattered specifications of
an entire supply base resolved into a single answer about who to buy from.

## Brand Personality

Authoritative at a glance, instrument-dense on demand. The interface carries the
confidence of a system that knows its data is right, without performing that
confidence through decoration.

Ember's warmth is the personality — it keeps a dense, data-heavy tool from feeling
cold or punitive to a user who only opens it once a week. Warmth comes from the accent
and the typography, never from softening the data.

Tone is plain and specific. Numbers are tabular and unrounded. Nothing is hedged, and
nothing is oversold.

## Anti-references

Not stock admin-template UI: not the bootstrap dashboard, the generic card grid, or
the SaaS hero-metric layout with a big gradient number.

Not a consumer analytics product. The data is operational, not celebratory — no
confetti on an empty review queue, no trend arrows implying a narrative the catalog
does not support.

Not an expert-only terminal. Density is earned through information, not through
withholding labels or hiding function behind memorized shortcuts. A user who has not
opened the app in three weeks must not feel locked out of it.

## Design Principles

**Expression is a property of the screen, not the app.** The Dashboard is a briefing
and can afford presence — the hero banner, the KPI tiles, generous type. Search is a
working surface and earns none of it; it runs full-bleed at viewport height so the
Inspector fills the screen. The same product legitimately holds both.

**Legible cold, fast warm.** Every control carries a real label and a discoverable
affordance, and every frequent path also has a keyboard route. These are not in
tension unless the interface treats shortcuts as a substitute for clarity.

**The catalog is neutral.** All suppliers render identically, including BosTech's own
listings. The tool's value is that it can be trusted as an even-handed record; visually
privileging our own rows would trade that away for a highlight the user does not need.

**Density is information, not compression.** Fitting more on screen is only a win when
the added rows are scannable. Tabular numerals, consistent column alignment, and
restrained row chrome do more for comparison than tighter padding.

**Theming is a system, not a skin.** Accent and base palette are user-selectable and
first-class — Teal and Ember are equal citizens, both correct in light and dark. Every
component draws from semantic tokens so no screen has an opinion about which theme is
running.

## Accessibility & Inclusion

WCAG 2.1 AA. Body text at 4.5:1 minimum against its background, large text at 3:1,
placeholders held to the same body-text standard.

Status is never carried by color alone. Complete, needs-review, and missing-price
states take a label or icon alongside their hue — this governs the listing-status
donut, its legend, and every status chip in the results table. Missing-price is the
normal case (most brochures print no price — see Product Purpose), so it must be
styled as neutral information, never as a warning or an error.

Every animation has a `prefers-reduced-motion: reduce` alternative, typically a
crossfade or an instant transition.

Responsive quality is deliberately uneven, and Search is where it must be excellent.
The Inspector's filter / results / detail-panel layout needs a genuine small-screen
form — progressive disclosure, not a horizontally scrolled desktop table. Every other
screen needs only to remain usable and unbroken at small sizes; graceful degradation is
an acceptable outcome there, and effort spent perfecting them is effort taken from
Search.
