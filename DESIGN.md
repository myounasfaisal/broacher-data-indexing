---
name: BrochureDB
description: A supplier-comparison instrument that turns brochure PDFs into a verdict.
colors:
  brand-teal: "#0F7A72"
  brand-teal-hover: "#0B615A"
  brand-teal-dark: "#21B6A8"
  brand-ember: "#BF5010"
  brand-ember-hover: "#A8440A"
  brand-ember-dark: "#F5842F"
  brand-ember-dark-fill-text: "#2A1002"
  app: "#F6F7F9"
  surface: "#FFFFFF"
  elevated: "#FFFFFF"
  muted: "#ECEEF2"
  hover: "#E7EAEF"
  fg: "#171B24"
  fg-muted: "#525C6E"
  fg-subtle: "#697485"
  line: "#DDE1E8"
  line-strong: "#C4CBD5"
  app-dark: "#0E1116"
  surface-dark: "#161A21"
  elevated-dark: "#1C212A"
  fg-dark: "#E7EAF0"
  line-dark: "#262D39"
  ok: "#0E6D4A"
  ok-soft: "#E9F7EF"
  warn: "#8F5E12"
  warn-soft: "#FCF3E6"
  danger: "#C6413B"
  danger-soft: "#FCECEC"
  c-teal: "#0F7A72"
  c-teal-soft: "#E2F4F2"
  c-indigo: "#4F5BD5"
  c-indigo-soft: "#EAECFB"
  c-violet: "#8B3FD4"
  c-violet-soft: "#F3E9FC"
  c-amber: "#A6720F"
  c-amber-soft: "#FBF1DD"
  c-rose: "#C14B74"
  c-rose-soft: "#FCEAF1"
  c-green: "#0E6D4A"
  c-green-soft: "#E4F5EC"
  c-sky: "#1F7BB8"
  c-sky-soft: "#E3F1FB"
  c-teal-dark: "#46D0C2"
  c-indigo-dark: "#8B9BFB"
  c-violet-dark: "#C58CF5"
  c-amber-dark: "#E6B968"
  c-rose-dark: "#EF8FAE"
  c-green-dark: "#63D19E"
  c-sky-dark: "#63B6EA"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "-0.006em"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.06em"
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    fontFeature: "tnum 1, cv01 1"
  stat:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1"
rounded:
  chip: "7px"
  btn: "10px"
  card: "14px"
  panel: "18px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.brand-teal}"
    textColor: "#FFFFFF"
    rounded: "{rounded.btn}"
    padding: "8px 16px"
    height: "40px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.brand-teal-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.btn}"
    padding: "8px 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.btn}"
    padding: "8px 16px"
    height: "40px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.btn}"
    padding: "8px 12px"
    height: "40px"
  badge-brand:
    backgroundColor: "#E8F6F4"
    textColor: "{colors.brand-teal-hover}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  badge-warning:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  nav-item-active:
    backgroundColor: "#E8F6F4"
    textColor: "{colors.brand-teal-hover}"
    rounded: "{rounded.btn}"
    padding: "9px 12px"
  card-surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  badge-status-processing:
    backgroundColor: "#E8F6F4"
    textColor: "{colors.brand-teal-hover}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-status-done:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-status-failed:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-status-idle:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  progress-track:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.full}"
    height: "6px"
  progress-fill-active:
    backgroundColor: "{colors.brand-teal}"
    rounded: "{rounded.full}"
    height: "6px"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.btn}"
    height: "28px"
    width: "28px"
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "20px"
  stat-card-value:
    textColor: "{colors.fg}"
    typography: "{typography.stat}"
  stat-card-icon-tile:
    backgroundColor: "#E8F6F4"
    textColor: "{colors.brand-teal-hover}"
    rounded: "9px"
    height: "32px"
    width: "32px"
  stat-card-alert:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warn}"
    rounded: "{rounded.card}"
    padding: "20px"
  dashboard-masthead:
    textColor: "#FFFFFF"
    rounded: "{rounded.card}"
    padding: "26px 28px"
  masthead-kpi-tile:
    textColor: "#FFFFFF"
    rounded: "12px"
    padding: "14px 20px"
  masthead-pill:
    textColor: "#FFFFFF"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  insight-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px 24px"
---

# Design System: BrochureDB

## 1. Overview

**Creative North Star: "The Shortlist"**

Every screen in BrochureDB exists to narrow many suppliers down to one choice. That is
the whole job. A user arrives with a chemical in mind and leaves knowing who to buy it
from and what it should cost. The interface is not a database browser that happens to
show prices — it is an instrument for reaching a verdict, and every visual decision is
judged by whether it makes that verdict arrive faster and with more confidence.

This produces a system that is calm on its surfaces and precise in its data. Chrome
recedes: neutral backgrounds, hairline borders, one restrained accent. The data does not
recede: monospaced tabular figures, aligned columns, unrounded numbers, status carried
in labeled chips rather than implied by color. The tension between those two registers
is the design. Where a lesser tool would decorate the frame and flatten the numbers,
this one flattens the frame so the numbers can carry weight.

The system explicitly rejects stock admin-template UI — the bootstrap dashboard, the
generic card grid, the SaaS hero-metric layout with a big gradient number. It rejects
consumer-analytics theatre: no confetti on a drained review queue, no trend arrows
implying a narrative the catalog does not support. And it rejects the expert-only
terminal. Density here is earned through information, never through withholding labels
or hiding function behind memorized shortcuts.

**Key Characteristics:**
- One superfamily (Geist + Geist Mono) across the entire UI; no display face anywhere
- Fixed rem/px type scale, never fluid — this is product UI, not a landing page
- Two first-class accents (Teal, Ember), both correct in light and dark
- Flat at rest; elevation is a response to state, not a permanent property
- Tabular figures on every number that appears in a column
- Status always labeled, never color-only

## 2. Colors

A cool blue-grey neutral field holding one saturated accent, where the accent marks
action, selection, and state — nothing decorative.

### Primary

- **Teal** (`#0F7A72` light / `#21B6A8` dark): The default accent. Primary buttons, the
  active nav rail, links, selection, and key data such as price chips. The light and
  dark values are deliberately not the same color: deep teal on a dark surface sinks
  into the background, so dark mode uses a brighter fill (`#21B6A8`) with near-black
  text (`#052623`) rather than white. Never reuse the light-mode fill in dark mode.
- **Ember** (`#BF5010` light fill / `#F5842F` dark fill): The alternate accent, equal in
  standing to Teal and user-selectable — **shipped**, not aspirational. Ember carries the
  warmth that keeps a dense, data-heavy tool from feeling punitive to an occasional user.
  Like Teal, its light and dark values differ deliberately: the light fill is deepened to
  `#BF5010` so white text clears 4.5:1 (the prototype's brighter `#C9560C` could not), and
  the dark fill brightens to `#F5842F` with near-black text (`#2A1002`). Full light slots:
  fill `#BF5010` / hover `#A8440A` / text `#9A3F08` / soft `#FDECE0` / soft-text `#8F3D08`.
  Full dark slots: fill `#F5842F` / hover `#FF9A4D` / text `#FFAB5E` / soft `#3A1E0A` /
  soft-text `#FFC487`. Every fill/text pairing was contrast-checked (light 4.8–6.8:1,
  dark 7.0–9.9:1). The Dashboard hero gradient may still run the brighter prototype ramp.

  **Mechanism.** The accent is an axis orthogonal to light/dark. `<html data-accent="ember">`
  overrides only the six `--brand-*` tokens (plus `--selection`); Teal is the default and
  needs no attribute. Because every component draws from those semantic tokens, switching
  accent is a token-layer change with zero component edits. The choice persists to
  `localStorage` and is mirrored by the pre-paint script in `index.html`, and is set from
  the Appearance popover in the sidebar footer / mobile top bar.

### Tertiary

A seven-hue categorical set — Teal, Indigo, Violet, Amber, Rose, Green, Sky — each with
a solid and a soft tint, and each with a separate dark-mode value. It exists for one
purpose: **distinguishing categories that have no inherent order** on the Dashboard's
insight panels and in the Activity log's action badges. It is not a decorative palette
and never colors chrome, headings, or borders.

- **Light solids:** Teal `#0F7A72` · Indigo `#4F5BD5` · Violet `#8B3FD4` · Amber
  `#A6720F` · Rose `#C14B74` · Green `#0E6D4A` · Sky `#1F7BB8`
- **Dark solids:** Teal `#46D0C2` · Indigo `#8B9BFB` · Violet `#C58CF5` · Amber
  `#E6B968` · Rose `#EF8FAE` · Green `#63D19E` · Sky `#63B6EA`
- **Softs** carry the matching icon tiles and badge backgrounds at the same index.

**Status is a reserved subset.** Green, Amber, and Rose are bound to Complete, Needs
review, and Missing price wherever listing status is shown. They are never reused as
"the next category" in a chart that also displays status.

### Neutral

- **App** (`#F6F7F9` light / `#0E1116` dark): The page field. The lowest layer; nothing
  sits behind it.
- **Surface** (`#FFFFFF` light / `#161A21` dark): Sidebar, header, cards, panels. The
  working layer where content lives.
- **Elevated** (`#FFFFFF` light / `#1C212A` dark): Modals, popovers, drawers. In light
  mode this is identical to Surface by design — light mode separates layers with borders
  and shadow, dark mode separates them with tone.
- **Muted** (`#ECEEF2` / `#232935`) and **Hover** (`#E7EAEF` / `#2A3140`): Progress
  tracks, secondary button fills, and hover states.
- **Ink** (`#171B24` fg / `#525C6E` fg-muted / `#697485` fg-subtle): The text ramp,
  cool and slightly blue — deliberately not Tailwind slate. Body text uses `fg`.
  `fg-muted` is for supporting prose. `fg-subtle` is for labels and never for sentences.
  Every tier clears 4.5:1 on `--surface` in both themes (6.6:1 and 4.7:1 in light;
  6.9:1 and 4.8:1 in dark). The earlier values — `#6B7688` and `#98A2B1` — put the
  subtle tier at **2.6:1**, below even the 3:1 large-text floor, while it carried every
  11px label, em-dash, and converted price in the app.
- **Line** (`#DDE1E8`) and **Line Strong** (`#C4CBD5`): Hairline dividers and the
  stronger stroke on inputs and interactive borders.

### Semantic

- **OK** (`#0E6D4A` on `#E9F7EF`): Complete listings, successful uploads.
- **Warn** (`#8F5E12` on `#FCF3E6`): Needs-review state, the review-count badge.
- **Danger** (`#C6413B` on `#FCECEC`): Missing price, destructive actions, errors.

### Named Rules

**The Two Accents Rule.** Teal and Ember are equal citizens. No component, screen, or
snippet may hardcode either one. Every accent reference goes through the semantic token
(`--brand`, `--brand-text`, `--brand-soft`, `--on-brand`). If a screen renders correctly
in only one accent, that screen is broken.

**The Accent Scarcity Rule.** The accent marks primary action, current selection, and
state. It is never a decoration, never a section divider, never a background for
emphasis. On a typical Search screen the accent should cover well under 10% of pixels.

**The Never Color Alone Rule.** Complete, Needs review, and Missing price must each carry
a label or icon alongside their hue. This binds the status donut, its legend, every
status chip, and every table cell. A user with deuteranopia reads the same catalog.

**The Entity-Not-Rank Rule.** A categorical hue belongs to the *thing*, never to its
position in a sorted list. If the top-suppliers panel paints first place Teal and second
place Indigo, then a supplier that moves up changes color and the reader sees a change
that did not happen. Either bind the hue to a stable identity, or — for a panel that
ranks a single measure — use one hue for every bar and let length carry the comparison.
Ranked magnitude is not categorical data.

**The Validated-Palette Rule.** Any set of hues that must be told apart is validated
with a colorblind-separation check before it ships, never judged by eye. The dark-mode
status trio measures ΔE 6.6 between Green and Amber under protanopia — inside the 6–8
floor band, which is legal **only** because every segment is separated by a 2px surface
gap and restated in a labeled legend. Remove either and the chart becomes unreadable
for a protan viewer. If a new hue lands in that band with no secondary encoding, re-step
it; do not ship it and hope.

**The Progress-Is-Not-Status Rule.** A progress indicator carries two independent
signals and must not conflate them. *Fill length* answers "how far along"; *fill color*
answers "in what state". A bar at 100% is not necessarily a success — a cancelled and a
failed job both fill completely, in `--line-strong` and `--danger` respectively. Color
is assigned from status alone: queued `--fg-subtle`, processing `--brand`, paused
`--warn-text`, done `--ok-text`, failed `--danger`, cancelled and duplicate
`--line-strong`. Never render a terminal state in the accent, and never let a green bar
mean "finished" when it only means "done successfully".

**The Two-Value Accent Rule.** Every accent defines separate light and dark values, and
`--on-brand` flips with them. A fill that passes contrast on white will not pass on
`#0E1116`, and the reverse. Test both before committing either.

## 3. Typography

**Display Font:** Geist (with ui-sans-serif, system-ui fallback)
**Body Font:** Geist — the same family, at different weights
**Label/Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** One superfamily across the entire interface. Geist is neutral enough to
disappear into dense tables and precise enough to hold a 26px page title without needing
a display face beside it. The only real typographic contrast in the system is
proportional versus monospaced — prose versus data — and that contrast is meaningful
rather than stylistic. Body text carries slightly open tracking (`-0.006em`) at weight
400; headings tighten to `-0.02em` at weight 500–600 and never grow loud.

### Hierarchy

- **Display** (600, 26px/32px, -0.02em): Page titles only. One per screen.
- **Headline** (600, 20px/26px, -0.02em): Panel and card titles, section headers.
- **Title** (500, 15px/20px, -0.01em): Row headings, supplier names, form group labels.
- **Body** (400, 14px/20px, -0.006em): The default. All prose, table cells, controls.
  Prose blocks cap at 65–75ch; table rows may run to 120ch+ and that is correct.
- **Label** (600, 11px/14px, +0.06em, uppercase): Sidebar section labels and stat-card
  captions. This is the *only* uppercase in the system.
- **Data** (400, 13px/18px, Geist Mono, `tnum` + `cv01`): Prices, CAS numbers, counts,
  timestamps, percentages. Every number that appears in a column.

### Named Rules

**The Tabular Rule.** Any number that can appear stacked above another number is
monospaced with tabular figures. Prices, CAS numbers, listing counts, dates. Columns of
digits must align on the decimal or the comparison the whole product exists for gets
harder.

**The One Uppercase Rule.** Uppercase appears in exactly two places: sidebar section
labels and stat-card captions, both at 11px/600/+0.06em. Uppercase is forbidden on
buttons, table headers, chips, nav items, and headings.

**The Fixed Scale Rule.** No `clamp()` on UI type. Users sit at consistent DPI and a
heading that shrinks inside a narrow panel looks broken, not responsive. Responsive
behavior in this system is structural, never typographic.

## 4. Elevation

Flat at rest. Surfaces sit on the page with a hairline border and no shadow; depth is
communicated by the tonal step between app, surface, and elevated rather than by
permanent drop shadows. Shadow enters only as a *response* — a card lifting under the
cursor, an overlay asserting that it is above the page, a focus ring confirming
keyboard position. This keeps a screen holding forty table rows from reading as forty
floating objects.

Dark mode leans harder on tone than on shadow, because shadow on a near-black field is
nearly invisible. This is why `elevated` diverges from `surface` in dark (`#1C212A` vs
`#161A21`) while the two are identical in light.

### Shadow Vocabulary

- **Card** (`0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)`):
  Barely-there seating for cards and solid buttons. Reads as a crisp edge, not a shadow.
- **Card Hover** (`0 4px 12px -2px rgb(16 24 40 / 0.10), 0 2px 6px -2px rgb(16 24 40 / 0.06)`):
  The lift on hover for interactive cards. The only shadow the user consciously sees.
- **Pop** (`0 12px 32px -8px rgb(16 24 40 / 0.20), 0 4px 12px -4px rgb(16 24 40 / 0.12)`):
  Modals, popovers, command palette, dropdowns. Reserved for true overlays.
- **Glass** (`backdrop-filter: saturate(180%) blur(20px)`): Overlays and the sidebar
  where it floats above content. Purposeful and rare — never decorative.

### Named Rules

**The Flat-At-Rest Rule.** A surface that has not been interacted with has a border, not
a shadow. If a static screenshot shows shadows under resting elements, the elevation is
wrong.

**The Overlay-Only Pop Rule.** `shadow-pop` belongs exclusively to things that float
above the page and can be dismissed. A card is not an overlay. A table row is not an
overlay.

## 5. Components

The component character is a two-state contract: **restrained at rest, tactile on
contact.** At rest components are quiet enough to vanish behind the data — hairline
borders, no shadow, muted text. On hover, focus, or press they respond immediately and
unambiguously with fill, border, and elevation change inside 150ms. Nothing bounces,
nothing overshoots, nothing animates on arrival.

### Buttons

- **Shape:** Softly rounded (10px, `rounded-btn`), 40px tall at default size (32px `sm`,
  44px `lg`).
- **Primary:** Accent fill (`--brand`) with `--on-brand` text, `shadow-sm`, 16px
  horizontal padding. One primary per view.
- **Hover / Focus:** Background shifts to `--brand-hover` over 150ms. Focus shows a 2px
  accent ring at 70% opacity with a 2px app-colored offset. Only background, border,
  color, and box-shadow transition — never layout properties.
- **Secondary:** Muted fill, foreground text, hover to `--hover`.
- **Outline:** Surface fill with a `--line` border that strengthens to `--line-strong` on
  hover.
- **Ghost:** No fill, `--fg-muted` text; gains `--hover` background and full `--fg` text.
- **Destructive:** Danger fill with `--on-danger` text.
- **Disabled:** 50% opacity, pointer events off. Never a separate gray.

### Chips

- **Style:** Fully rounded pills, 12px/500 text, 10px horizontal padding, tinted soft
  background with a matching inset ring at 20% opacity.
- **Variants:** Brand (selection, price), Success, Warning (needs review), Destructive,
  Secondary (neutral metadata).
- **MonoChip:** A distinct variant for precise data — CAS numbers, prices. Geist Mono
  with tabular figures. Precise data never renders in a proportional Badge.

### Cards / Containers

- **Corner Style:** 14px (`rounded-card`); large panels take 18px (`rounded-panel`).
- **Background:** `--surface` on the `--app` field.
- **Border:** 1px `--line`. Always present — this carries the separation that shadow
  does not.
- **Shadow Strategy:** None at rest. `shadow-card-hover` only if the card is itself
  interactive. See Elevation.
- **Internal Padding:** 20px standard; 24–28px for hero and feature panels.
- **Nesting:** Forbidden. A card inside a card is always a structural mistake.

### Stat cards

The dashboard's headline metrics. A stat card is a **caption, a number, and nothing
else** unless the metric is actionable.

- **Structure:** Uppercase 11px label (`--fg-subtle`) on the left, optional 32px icon
  chip (9px radius) on the right, then the value on its own line at 30px/600 with
  tabular figures and `-0.02em` tracking. Optional 12px hint beneath.
- **Padding:** 20px, on the standard 14px card. No shadow at rest.
- **Tone:** `default` (muted chip, `--fg` value) is the resting state and the majority.
  `brand` tints the chip only — the number stays `--fg`. `warning` is the sole tone that
  colors the value itself (`--warn-text`), and only while the metric is non-zero. A
  count of zero returns to `default`; a permanently orange card teaches nothing.
- **Grid:** One column, two at `sm`, four at `lg`. Cards never shrink below a full
  number — the value is the content, and a wrapped metric is a broken metric.

**The Actionable Stat Rule.** A stat card that links somewhere must be visibly
interactive: it takes the card's hover elevation (`shadow-card-hover`), a pointer
cursor, and its destination named in the hint line ("open the review queue"). A `title`
tooltip is not an affordance — it does not exist on touch. Three inert cards and one
silent link is a card the user never clicks.

### Section panels

The dashboard and admin surfaces compose a page as a stack of titled panels, each one
card wrapping a table.

- **Header:** 15px/500 title, optional 14px `--fg-muted` description beneath it. The
  description carries the panel's rule ("expand a row to see its listings, or undo it"),
  not a restatement of the title.
- **Heading level:** The panel title is an `h2` under the page's `h1`. Never skip to
  `h3` because the primitive defaults there — a page's heading outline is content, not
  styling.
- **Body:** Table flush to the panel's 24px padding; toolbar row above it, count and
  pagination below.
- **Rhythm:** 24px between panels, 24px from the stat grid. Panels do not nest and do
  not carry their own borders inside the card.

### Loading states

- **Skeletons, never spinners.** Every deferred region resolves into a pulsing `--muted`
  block (`rounded-md`) shaped like the content it replaces — the stat value as an 8×20
  bar, a table as its real column widths. Layout must not shift when data lands.
- **Announced, not just drawn.** A loading region carries `aria-busy`; its status text
  carries `role="status"`. A skeleton hidden behind `aria-hidden` with no live region
  makes the wait silent for screen-reader users, which is the same as no feedback.
- **Errors degrade, not replace.** A failed summary renders one `--danger-text` line
  above the still-working panels (`role="alert"`) and leaves them mounted. One dead
  query never blanks a page.

**The One Wait Rule.** A single screen shows one loading vocabulary. If the stat cards
skeleton and the table beneath them says "Loading…", one of the two is wrong — and it is
always the text.

### Inputs / Fields

- **Style:** 1px `--line` border on `--surface`, 10px radius, 40px tall, 12px horizontal
  padding, matching the button's shape language exactly.
- **Focus:** Border shifts to `--brand` and a 2px accent ring at 30% opacity appears,
  with no offset — the ring hugs the field.
- **Placeholder:** `--fg-subtle`, held to the same 4.5:1 contrast requirement as body
  text. A placeholder is not exempt because it is temporary.
- **Disabled:** Muted fill, 60% opacity, not-allowed cursor.
- **Error:** Danger border with the message rendered in `--danger-text` below the field.
  Never color-only.

### Result rows

- **The row is the target.** Where a row opens a detail view, the whole row is
  clickable and the hover tint is the affordance. The product name stays a real
  `<button>` for keyboard and screen readers but renders as plain `--fg` text —
  link styling on top of a clickable row implies the rest of the row is inert.
  Nested controls (checkbox, Edit) stop propagation.
- **Column order follows the decision.** Name → Supplier → CAS → Price → Purity.
  Supplier precedes CAS because the page exists to choose a supplier; CAS is an
  identifier you verify, not one you decide on.
- **No column of duplicates.** A field that repeats another on most rows gets no
  column of its own. `As printed` surfaces beneath the name only when it differs,
  and always in the detail panel.
- **Names clamp at two lines.** One line cut most chemical names mid-word; three
  lets a single row dominate the page. Full text lives in `title`.
- **Price never renders an empty chip.** With no printed price, the first
  conversion is promoted to the headline chip and marked `≈`; the remaining
  currency drops to a second line. A dash chip stacked over a real number reads
  as broken data when the value was there all along.
- **Omit, don't dash.** In the mobile card, fields the listing lacks are not
  rendered. A grid of em-dashes is chrome, not information.
- **Range filters are one control.** Min and max share a label and count once on
  the filter badge. A backwards range blocks submit with an inline reason rather
  than spending a request to return nothing.

### Upload queue

The system's one **long-running, unattended** surface. Everywhere else the user acts and
sees a result; here they hand over forty files and leave. The design consequence is that
every piece of state must be legible after an absence — nothing that matters may be
communicated by something that disappears.

- **One row per file, never a batch bar.** A single aggregate progress bar for a folder
  of forty brochures hides the only question worth asking: *which* file failed. Rows are
  8px vertical padding on a `--line` divider list, filename in Title over stage text in
  `--fg-muted` Body.
- **The bar is an estimate and the copy must not pretend otherwise.** Extraction is one
  opaque model call with no byte-level progress, so fill is derived from the job's stage
  string — queued sits at 6%, extraction crawls toward 88%, per-product saving tracks
  50–95%, terminal states fill. Because the number is inferred, the *stage text* is the
  honest signal and the bar is the ambient one. Never render a percentage as a numeral;
  a precise-looking `73%` is a lie the bar's shape doesn't tell.
- **Track and fill:** 6px, fully rounded, `--muted` track. Fill transitions width over
  200ms and takes its color from status per The Progress-Is-Not-Status Rule.
- **Indeterminate is a distinct visual, not a frozen bar.** A file still uploading from
  the browser has no server job and therefore no stage; it shows a partial pulsing fill
  in `--fg-subtle` with a spinner chip reading `Uploading…`. A motionless bar at a low
  percentage reads as a hang.
- **Status chips reuse the Chips vocabulary** at 8px horizontal padding: processing
  `--brand-soft`, done `--ok-soft`, failed `--danger-soft`, everything else `--muted`.
  Per The Never Color Alone Rule each chip carries its word — `Queued`, `Processing`,
  `Paused`, `Done`, `Failed`, `Cancelled`, `Duplicate`.
- **Controls are 28px icon buttons on a `--line` border**, gapped 4px, and each one
  **must carry `.touch-target`**. This is the pattern's most-missed requirement: a
  destructive 28px control sitting 4px from its neighbor is a mis-tap on any phone, and
  the utility fixes it without changing the desktop density the queue depends on. Only
  the actions the job's state permits are rendered — never a row of disabled buttons.
- **Cancel and Remove destroy work and must confirm.** Upload history already confirms
  its undo and bulk delete; a queue row is no less destructive because it is smaller.
- **Failures persist in the surface, not in a toast.** A file rejected for size, or one
  that failed to enqueue, stays listed with its reason. Toasts are for confirming what
  the user just did, never for the only record of what went wrong while they were away.
- **Errors replace the stage line** in `--fg-muted`, in place, on the row that owns them.
- **The batch summary appears only when every job is terminal**, as one sentence of
  counts — processed, duplicates skipped, cancelled, failed, listings saved. Partial
  counts that tick upward mid-run compete with the rows for the same information.

**The Survives-Reload Rule.** The queue lives on the server, so the UI must never imply
otherwise: no "don't close this tab" warnings, no beforeunload prompt, no client-held
state that a refresh would lose. Say so once, in the confirmation, and then behave like
it is true.

**The Announced-Progress Rule.** A progress bar that exists only as a styled `div` does
not exist for a screen-reader user, and this is the one surface where the user is most
likely to be doing something else. Every bar carries `role="progressbar"` with
`aria-valuenow` (omitted when indeterminate) and a label naming its file; the stage line
sits in a polite live region.

### Folder / file picker

- **Two peer actions, not a mode toggle.** `Select folder` and `Select PDF(s)` are both
  Outline buttons at equal weight. Neither becomes filled after use — the picker holds
  no persistent mode, and the OS dialog can be dismissed without a selection, so a
  filled "active" state would assert something untrue.
- **Icons come from the Lucide set** (`FolderOpen`, `FileText`) at 16px, inheriting
  `currentColor`. Emoji are forbidden as iconography anywhere in the app: they ignore
  the text color, render differently per platform, and are announced as their unicode
  names before the label.
- **Filtering is silent and total.** Non-PDF files in a chosen folder are dropped without
  ceremony; a selection that yields no PDFs says so once.

### Navigation

- **Sidebar:** Fixed 260px, `--surface`, right border `--line`. Nav groups carry colored
  uppercase section labels (11px/600/+0.06em). Items are 14px text at 9px/12px padding
  with an 18px icon.
- **Active:** `--brand-soft` background, `--brand-soft-text` text, weight 500, plus a
  3px × 20px accent rail pinned to the left edge. The rail is the primary signal; the
  tint alone is not enough.
- **Hover:** `--hover` background, text to full `--fg`.
- **Header:** Sticky, 60px, `--surface`, bottom border `--line`. Holds the search
  launcher (pill, `--app` fill, ⌘K hint) and the theme toggle.
- **Mobile:** The sidebar collapses to an off-canvas drawer behind a scrim; the header
  gains the trigger. The active-rail treatment survives the collapse unchanged.

### Dashboard (briefing surface)

The one screen in the product that is *read* rather than *worked*. PRODUCT.md sets the
governing principle — **"Expression is a property of the screen, not the app. The
Dashboard is a briefing and can afford presence."** Search earns none of this; the
Dashboard earns all of it, once, at the top.

**Masthead.** A full-width gradient banner in the active accent, `rounded-card`, 26px
28px padding, over a dotted radial texture (white at 16%, 1px dot on a 16px grid, 50%
opacity) and a soft accent-tinted glow (`0 18px 40px -18px` at 55%). It holds a
`Live catalog` status pill (black 22%, 11px/600 uppercase +0.08em, with a 6px dot), a
24px/29px Headline sentence, and a supporting line at 82% white. Two KPI tiles sit
right (black 20%, 12px radius, 28px Geist Mono tabular value over an 11px uppercase
caption), wrapping beneath the sentence on narrow widths.

**The Masthead-Not-Metric Rule.** This banner is a masthead: a sentence is the hero and
the numbers are supporting at 28px. The anti-reference PRODUCT.md names — *"the SaaS
hero-metric layout with a big gradient number"* — is the inversion, where a giant
number *is* the hero and the sentence is a caption. Blow the KPI value up, drop the
sentence, or move the gradient onto the type, and this becomes the exact thing the
product rejects. The gradient is a surface, never a text fill.

**The One Gradient Rule.** Exactly one gradient surface exists in the entire product,
on one screen, above the fold. There is no second one — not on Search, not on a card,
not on a button, not on an empty state.

**The masthead follows the accent, not the variant.** PRODUCT.md is explicit that
*"Teal and Ember are equal citizens"*, so the banner is a property of the Dashboard and
renders in whichever accent is active — Ember `#C9560C → #F5842F 46% → #FFAB5E`, Teal
`#0B615A → #0F7A72 46% → #21B6A8`, each with its own tinted glow. A Teal user seeing a
flat dashboard while an Ember user sees a banner would make the accent a skin, which the
theming principle forbids.

**Stat card row.** Four across, 16px gap, collapsing 4 → 2 → 1. Each is a `--surface`
card at 20px padding: a 12px uppercase `--fg-subtle` label opposite a 32px rounded-9px
soft-tinted icon tile, then the value at 30px/600 tabular, then a 12px `--fg-subtle`
sub-line. Icon tints run Brand / Indigo / Sky / Warn across the four.

- **Every stat carries a sub-line, and the sub-line is context, not decoration.**
  `across 312 suppliers`, `+7 this month`, `276 listings added`. A number with no
  denominator is trivia.
- **Needs review is a control, not a readout.** It renders as a real `<button>` or link,
  its border warm-tinted (`color-mix(in srgb, var(--warn-text) 30%, var(--line))`), its
  value in `--warn-text`, and its sub-line an explicit destination. A count of problems
  that isn't clickable makes the user go find the queue themselves.
- **Skeletons, never zeros.** A loading stat shows a skeleton sized to the value it will
  replace. Rendering `0` before data arrives states something false.

**Listing status donut.** 140px SVG on a `0 0 128 128` viewBox, rotated -90° so the
first segment starts at twelve o'clock. Ring `r=52`, `stroke-width` 18, `--muted` track,
circumference 326.7, segments placed by `stroke-dasharray` + negative `stroke-dashoffset`
in the fixed order Complete (Green) → Needs review (Amber) → Missing price (Rose).

- **A 2px surface gap separates adjacent segments.** This is not styling — it is the
  secondary encoding that makes the dark palette legal under The Validated-Palette Rule.
- **The legend is mandatory and carries the numbers.** 10px swatch, label, value in
  Geist Mono tabular, percentage right-aligned in a 44px column. The donut shows
  proportion; the legend answers *how many*. Never label the arcs themselves, and never
  put a total in the hole — a doughnut with a big number in the middle is the
  hero-metric template wearing a ring.
- **Three slices, and only ever three.** A fourth category means the categories are
  wrong, not that the donut needs another color.

**Top suppliers by listings.** A horizontal bar list, not a chart axis: supplier name
left, count right in Geist Mono tabular, over a 6px fully-rounded `--muted` track filled
to a percentage of the leader. Four rows.

- **One hue for every bar.** This ranks a single measure, so length already carries the
  comparison; per-rank colors would violate The Entity-Not-Rank Rule and imply a
  categorical difference that does not exist. Fill in `--brand`.
- **Percentages are relative to the leader, not to the total.** The leader is always
  100%. State that in the panel's sub-line so the scale isn't misread as market share.
- **Long supplier names truncate with ellipsis** and keep the full string in `title`.
  The count never wraps or shrinks.

**Insight row layout.** The two panels sit in a `1.1fr 1fr` grid at 16px gap — the donut
panel is wider because its legend needs the room. Below `lg` they stack full-width.
Panels are `--surface`, `rounded-card`, 20px 24px, and each is titled by a 28px
rounded-8px soft-tinted icon tile beside a 15px/500 heading.

**Recent uploads** closes the page as a standard `--surface` panel: title and sub-line
opposite an `Export CSV` outline button, then the shared upload-history table.

**The Briefing Order Rule.** The Dashboard reads top to bottom as *headline → totals →
distribution → activity*: masthead, stat row, insight row, recent uploads. Each band
answers a narrower question than the one above it. Nothing is added to this screen that
does not answer a question a user would actually arrive with, and no band is reordered
to give a new panel prominence it hasn't earned.

### Search toolbar + results (signature surface)

The product's centerpiece, and the one surface where responsive quality is
non-negotiable. Every other screen may degrade gracefully at small sizes; this one may
not.

**Scroll economy is the governing constraint.** Results are the page's reason to exist,
so chrome above them is rationed at every screen size — not just on phones. A sticky
toolbar carries the live search field, an `Ask AI` toggle, and a `Filters` toggle in one
40px row. Both refine surfaces (AI input, and the price/purity/sort panel with the A–Z
bar) start **collapsed at every width**; an always-open filter block pushed the first
result below the fold on desktop as surely as on mobile.

A collapsed panel must never become a hidden-state trap: the Filters toggle carries a
count badge covering applied filters *and* an active letter, and the result line above
the table restates the active query in words.

**Touch is a first-class pointer here.** Controls sized for a mouse in a dense table are
unusable with a thumb, so the `.touch-target` utility expands hit areas to 44px under
`@media (pointer: coarse)` without altering visual size or layout — row checkboxes,
pagination numbers, Edit buttons, and the review badge all use it. The A–Z bar is 44px
per letter on touch and tightens to 32px under `pointer: fine`; below `lg` it becomes a
snapped, edge-faded horizontal strip because 27 thumb-sized targets never fit a phone
row.

**The table/card switch is at `lg` (1024px), not `md`.** Seven columns measured cramped
on a 768px tablet with supplier names wrapping to three lines. The breakpoint is set by
where the content breaks, not by the device tier.

**Still pending:** the prototype's full-bleed three-region Inspector — header block,
results, and a live supplier-detail panel at `calc(100vh - 60px)` — has not been built.
Today's page is a sticky toolbar above a results card, and detail opens in the shared
`SidePanel` drawer.

## 6. Do's and Don'ts

### Do:

- **Do** route every accent through the semantic tokens (`--brand`, `--brand-text`,
  `--brand-soft`, `--on-brand`) so Teal and Ember both render correctly.
- **Do** give every accent a separate dark-mode value. Teal proves the pattern: `#0F7A72`
  with white text in light, `#21B6A8` with `#052623` text in dark.
- **Do** set monospace with tabular figures on every number that can stack in a column.
- **Do** pair every status color with a label or icon — Complete, Needs review, Missing
  price — in the donut, its legend, and every chip.
- **Do** keep transitions at 150ms and limited to background, border, color, and shadow.
- **Do** give every interactive component all seven states: default, hover, focus,
  active, disabled, loading, error.
- **Do** use skeleton states for loading, sized to the content they replace.
- **Do** pair every skeleton with `aria-busy` and every status line with `role="status"`.
  A wait that is drawn but not announced is not a loading state.
- **Do** make a linked stat card look linked — hover elevation, pointer cursor, and its
  destination named in the hint. Tooltips do not survive touch.
- **Do** step panel titles as `h2` under the page `h1`. If the heading outline reads
  h1 → h3, the primitive's default won and the page lost.
- **Do** write empty states that teach the interface rather than announcing emptiness.
- **Do** treat responsive behavior as structural — collapse the sidebar, reflow the
  table, move the panel to a sheet.
- **Do** hold the Search Inspector to a higher responsive standard than any other screen.
- **Do** apply `.touch-target` to every control under 40px, including the upload queue's
  28px icon buttons. The utility exists precisely so density and thumbs can coexist.
- **Do** give every progress bar `role="progressbar"`, a file-naming label, and a polite
  live region for its stage text.
- **Do** keep a failed or rejected file visible in the surface that owns it, with its
  reason, after the toast has gone.
- **Do** confirm Cancel and Remove on an in-flight upload, matching how Upload history
  already treats undo and bulk delete.
- **Do** run a colorblind-separation check on any hue set that must be told apart,
  before it ships. Compute it; never judge it by eye.
- **Do** separate adjacent donut segments with a 2px surface gap and restate every
  segment in a labeled legend. The dark palette is only legal with both.
- **Do** give every stat card a sub-line that supplies a denominator or a destination.
- **Do** render the Dashboard masthead in whichever accent is active. It belongs to the
  screen, not to the Ember variant.
- **Do** bind a categorical hue to a stable entity, or use a single hue when the panel
  ranks one measure.

### Don't:

- **Don't** ship **stock admin-template UI**: the bootstrap dashboard, the generic card
  grid, or the **SaaS hero-metric layout with a big gradient number**.
- **Don't** build **consumer-analytics theatre** — no confetti on a drained review queue,
  no trend arrows implying a narrative the catalog does not support.
- **Don't** build an **expert-only terminal**. Density is earned through information,
  never through withholding labels or hiding function behind memorized shortcuts.
- **Don't** visually privilege BosTech's own listings. The catalog is neutral; all
  suppliers render identically.
- **Don't** hardcode a hex accent anywhere in a component.
- **Don't** use `clamp()` or any fluid sizing on UI type.
- **Don't** nest a card inside a card.
- **Don't** mix loading vocabularies on one screen. Skeletons everywhere or nowhere;
  a centered "Loading…" beside a skeleton grid is the tell that a component was
  written in isolation.
- **Don't** leave a stat card's warning tone on at zero. A permanently orange metric is
  decoration, and the next real alert reads as more of the same.
- **Don't** apply a resting shadow to a non-interactive surface.
- **Don't** use `border-left` or `border-right` above 1px as a colored accent stripe on
  cards, rows, or callouts. The 3px nav rail is a separate pinned element, not a border.
- **Don't** use `background-clip: text` with a gradient. The Ember hero gradient is a
  background, never type.
- **Don't** use glassmorphism decoratively. It belongs to overlays and the floating
  sidebar and nowhere else.
- **Don't** uppercase buttons, table headers, chips, nav items, or headings.
- **Don't** let muted gray text carry body copy — if contrast is close, move toward `fg`.
- **Don't** reach for a modal first. Exhaust inline and progressive alternatives.
- **Don't** solve small screens by horizontally scrolling the results table.
- **Don't** style a link inside a row that is itself clickable.
- **Don't** give a field its own column when it duplicates another on most rows.
- **Don't** render an empty or dash-filled chip. Promote a real value or show `—`.
- **Don't** pad a mobile card with em-dashes for fields the listing doesn't have.
- **Don't** collapse a multi-file upload into one aggregate progress bar. The row is the
  unit, because the failure is per-file.
- **Don't** print a numeric percentage next to an estimated bar. The fill may imply
  precision the underlying signal doesn't have; a numeral asserts it.
- **Don't** color a progress fill by completion instead of by status — a cancelled job
  and a successful one both reach 100%.
- **Don't** leave a destructive control at its visual size as its hit size.
- **Don't** use emoji as iconography. Lucide, at `currentColor`, everywhere.
- **Don't** let a toast be the only record of a failure on an unattended surface.
- **Don't** warn the user against leaving or reloading the upload page. The queue is on
  the server; implying fragility contradicts the product's actual guarantee.
- **Don't** wrap a two-button toolbar in its own Card, or repeat the PageHeader's title
  as the CardTitle directly beneath it.
- **Don't** add a second gradient surface anywhere. The Dashboard masthead is the only
  one in the product.
- **Don't** enlarge the masthead's KPI values or drop its headline sentence. That
  inversion is precisely the **SaaS hero-metric layout with a big gradient number** the
  product rejects.
- **Don't** put a total in the donut's hole, or label its arcs directly. The legend
  carries the numbers.
- **Don't** color bars by rank. A supplier that moves up must not change color.
- **Don't** add a fourth slice to the status donut. Three categories, fixed order.
- **Don't** reuse Green, Amber, or Rose as a general category color on a panel that also
  shows listing status.
- **Don't** render `0` in a stat card while its data is loading. Use a skeleton.
- **Don't** show a count of problems that the user cannot click through to fix.
