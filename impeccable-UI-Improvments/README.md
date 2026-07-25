# Handoff: BrochureDB — Chemical Brochure Database (Admin App)

## Overview
BrochureDB is an internal admin tool for curating a chemical-supplier catalog extracted from
supplier brochures (PDFs). Admins/managers search listings, compare prices across suppliers and
trade names, review AI-matched entries, manage suppliers/users, and audit activity. The centerpiece
is the **Search / Inspector** view: a faceted filter toolbar + full-width results table + a live
supplier-detail panel.

## About the Design Files
The files in this bundle are **design references authored in HTML** (a component runtime called
"Design Components", `.dc.html`). They are prototypes showing the intended look and behavior — **not
production code to copy directly**. The task is to **recreate these designs in the target codebase's
existing environment** (React, Vue, Svelte, etc.) using its established components, routing, and data
layer. If no environment exists yet, pick the most appropriate framework and implement there.

Ignore the `.dc.html` mechanics (`<x-dc>`, `<sc-if>`, `<sc-for>`, `<dc-import>`, `renderVals`,
`{{ }}` holes, `support.js`). They are a preview runtime only. Read them to understand markup,
inline styles, data, and interactions, then rebuild idiomatically.

## Previewing the prototypes locally
The original bundle referenced a `support.js` runtime that was never shipped with it. Without that
file the prototypes still *load*, but nothing is interpreted: every `<sc-if>` branch renders at once
(so all overlays, drawers, and modals stack on top of the dashboard), `{{ }}` holes show as literal
text, and the theme variables are never applied.

`support.js` in this folder is a **local reimplementation** written to make the prototypes viewable
so themes can be evaluated. It is a preview aid only — it is **not** part of the product and should
not be ported into the app.

Serve the folder over HTTP and open a file:

```bash
python3 -m http.server 8000
# then open http://127.0.0.1:8000/BrochureDB%20Ember.dc.html
```

HTTP is required — `<dc-import>` uses `fetch()`, which is blocked on `file://` URLs. Any static
server works (VS Code Live Server, `npx serve`, etc.).

It implements only what these three files use: `{{ }}` interpolation in text and attributes,
`<sc-if>`, `<sc-for>`, `<dc-import>`, `<helmet>` hoisting, `onClick`/`onChange`, `style` (string or
object, including CSS custom properties), `style-hover`, and a `DCLogic` base class providing
`state` / `props` / `setState` / `renderVals` / `componentDidMount`. `setState` re-renders the whole
subtree and restores focus to the active input; that is adequate at prototype scale but is why
typing in a bound field can feel less smooth than in a real framework.

**Changing the accent while previewing.** The runtime seeds props from the `data-props` JSON on the
`<script type="text/x-dc">` tag, so the accent shown is that prop's `default`. To preview a different
one, edit that default — e.g. `&quot;default&quot;:&quot;Ember&quot;` → `&quot;Violet&quot;`. Valid
values are the keys of the `ACCENTS` table in the same script (`Teal`, `Ember`, `Violet`, `Blue`,
`Amber`); `theme` accepts `Dark`/`Light`, and the in-app sun/moon toggle overrides it at runtime.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and interactions are specified. Recreate the UI
pixel-accurately using the codebase's libraries. All styling is inline in the prototypes; a real
implementation should move it into the app's styling system (CSS/Tailwind/styled-components) and
drive it from the token table below.

## Two theme variants
- **BrochureDB.dc.html** — Teal accent (primary product theme).
- **BrochureDB Ember.dc.html** — Same app, Ember (orange) accent on a neutral near-black base, plus a
  gradient hero banner on the Dashboard. Demonstrates the theming system; build **one** app whose
  accent + base palette are swappable (see Design Tokens → Theming).
- **Inspector.dc.html** — The Search view, extracted as a reusable component and embedded by both
  apps via `<dc-import>`. In a real app this is a `<SearchInspector>` component.

## Global Layout / App Shell
- Root: `display:flex; min-height:100vh`. Left **sidebar** (fixed 260px) + **main column** (flex:1).
- **Sidebar** (`background: --surface`, right border `--line`):
  - Brand lockup (64px tall header row): 32px rounded-9px square in `--brand` with a flask icon +
    wordmark "Brochure**DB**" (DB in `--brand-text`).
  - Nav groups with colored uppercase section labels (11px, 600, letter-spacing .06em):
    **Overview** (`--c-teal`) → Dashboard; **Catalog** (`--c-indigo`) → Search, Suppliers;
    **Curation** (`--c-amber`) → Review (with count badge "37" in `--warn` pill), Upload;
    **Admin** (`--c-sky`) → Users, Activity.
  - Nav item: 9px 12px padding, 14px text, radius `--r-btn`; icon (18px, lucide-style) + label.
    Active = `background: --brand-soft; color: --brand-soft-text; font-weight:500` + a 3px×20px
    `--brand` rail pinned to the left edge. Hover = `background: --hover; color: --fg`.
  - Footer: 36px round avatar "A" (`--c-violet-soft`/`--c-violet`) + email + role pill "admin".
- **Header** (sticky, 60px, `background: --surface`, bottom border `--line`): a search-launcher
  button (pill/`--r-btn`, `--app` bg, "Search chemicals, suppliers, CAS…" + ⌘K kbd) and a
  theme-toggle icon button (sun/moon) on the right.
- **Main content**: max-width none (full-bleed). Padding varies by **density** tweak
  (Compact `16px 24px 32px` / Balanced `20px 32px 40px` / Spacious `32px 40px 48px`).
  **Exception:** the Search page is full-bleed with `padding:0` and `height: calc(100vh - 60px)`,
  a flex column so the Inspector fills the viewport.

## Screens / Views

### 1. Dashboard
- Breadcrumb ("Overview / Dashboard", first crumb `--brand-text`), H1 "Dashboard" (26/32, 600,
  -0.02em), subtitle (`--fg-muted`).
- **Ember only:** gradient hero banner below the title — `linear-gradient(105deg,#c9560c,#f5842f 46%,#ffab5e)`,
  radius `--r-card`, 26px 28px padding, dotted radial texture overlay (rgba white 16%, 16px grid),
  soft orange glow shadow. Left: "Live catalog" pill (black 22% bg) + H2 "Every supplier's brochure,
  priced and searchable." + sub. Right: two KPI tiles (black 20% bg) — 12,481 Listings / 312 Suppliers.
- **Stat cards** — 4-up grid, gap 16px. Each: `--surface`, border `--line`, radius `--r-card`, 20px
  pad. Top row = uppercase label (`--fg-subtle`) + 32px rounded icon tile. 30px/600 tabular number.
  Sub line (`--fg-subtle`). Colors: Total listings `--brand-soft/--brand-text`; Suppliers
  `--c-indigo-soft/--c-indigo`; Uploads·7d `--c-sky-soft/--c-sky`; Needs review = clickable button →
  Review, warn-tinted border, number in `--warn-text`.
- **Insight row** — 2 cards (grid 1.1fr / 1fr, gap 16):
  - *Listing status* donut: SVG, 140px, `viewBox 0 0 128 128`, rotate(-90deg). Ring circle r=52,
    stroke-width 18, `--muted` track. Segments via stroke-dasharray on circumference 326.7:
    Complete `--c-green` `202.6 326.7` offset 0; Needs review `--c-amber` `49 326.7` offset -202.6;
    Missing price `--c-rose` `75.1 326.7` offset -251.6. Legend rows: 10px swatch + label +
    value (mono, tabular) + pct. Values: Complete 7,742/62%, Needs review 1,872/15%, Missing 2,867/23%.
  - *Top suppliers by listings*: horizontal bar list — name + count (right, mono) over a 6px `--muted`
    track filled to width%. Qingdao Echemi 412/100% (`--brand`), Tianjin Bohai 268/65% (`--c-indigo`),
    Bostech 97/24% (`--c-sky`), Jiangsu Hai'an 64/16% (`--c-violet`).
- **Recent uploads** panel: `--surface` card, header (title + sub + "Export CSV" button), table
  (File link, Supplier, Products chip, Uploaded by, When mono, Undo link).

### 2. Search (Inspector.dc.html — the priority view)
Full-height, three regions stacked/columned:
- **Header block** (`--surface`, bottom border): row 1 = AI search field (relative wrapper
  `flex:1; min-width:0; max-width:440px`; input has left sparkle icon `--brand-text`, `box-sizing:border-box`,
  `--app` bg, border `--line-strong`), "Ask AI" primary button, "Filters" toggle button (funnel +
  chevron that rotates), "Export" button (pushed right, `margin-left:auto`, calls CSV export).
- **Filter toolbar** (collapsible via Filters button; inset panel: border `--line`, radius `--r-card`,
  `--app` bg, 14px 16px pad, `flex-wrap; gap 14px 18px; align-items:flex-end`): Keyword input
  (min 200 / max 280, flex:1); Max price range (180px, label + "≤ $500"); Min purity range (180px,
  "≥ 90%"); Starts-with `<select>` (All + A–Z); a 1px×36px divider; Has price / Needs review
  checkboxes; "Reset" text button (`margin-left:auto`, circular-arrow icon).
- **Results grid**: `grid-template-columns: minmax(320px,1fr) 340px` (results | detail), `flex:1; min-height:0`.
  - *Results column* (`min-width:0; min-height:0`): sub-header (683 results · "sodium" + "N selected /
    clear"), then a scroll region (`flex:1; min-height:0; overflow:auto`) containing the table.
    Table (13px): **sticky** header (`position:sticky; top:0; background:--surface; bottom border
    --line-strong`; th 600/11px uppercase `--fg-muted`). Columns: checkbox (38px), Name, CAS, Price
    (right), Purity (150px). Rows: 13px 12px pad; **zebra** on odd rows (`--muted` 35%); **hover**
    `--hover`; **active/selected** row = `--brand-soft` + inset 2px `--brand` left rail. Name cell:
    500 English name + a 7px warn dot if "needs review" + optional raw (as-printed) name in `--fg-subtle`.
    CAS: mono tabular `--fg-muted`, "—" if none. Price: tinted chip (`--brand-soft/--brand-soft-text`,
    mono tabular), "—" if none. Purity: 5px bar (green ≥99 / `--brand` ≥95 / `--c-amber` below) +
    mono % ; "—" if none.
  - *Detail panel* (`border-left --line; --surface; 20px; overflow:auto; min-height:0`): "SUPPLIER
    DETAIL" eyebrow; product English + raw name; "needs review" pill if flagged; **Best price** card
    (`--brand-soft`, 22px mono value + converted line); a 2-col grid CAS / Purity / Form / MOQ;
    Supplier block (name, raw, country w/ pin icon); a warn note if review; footer buttons
    "Edit listing" (primary, fires onEdit) + "View" (fires onView).

### 3. Suppliers
Header (title + sub + "Export CSV"). Card with count line + table: Supplier (link + raw name),
Contact (email/phone mono/website links, or "—"), First seen (mono), Products chip, "View products"
link → Search. Explanatory footnote in `--fg-subtle`.

### 4. Review queue
Header. Selection banner (`--brand-soft` border/bg): "3 listings selected" + "selections keep across
pages" + Mark verified / Delete selected (`--danger`) / Clear. Then grouped cards per source file:
group header (file icon + name + "N flagged on this page" + "Delete file" danger-outline button),
each item row = checkbox + name(+raw) + CAS chip + supplier + "Mark verified" / "Open" buttons.

### 5. Upload
Header. Dashed drop-zone card (upload icon tile, "Drop brochures here…", `.pdf` note, "Select folder"
primary + "Select PDF(s)"). Progress card: per-job rows — filename + stage line + status pill
(Processing `--brand-soft` / Queued `--muted` / Done `--ok` / Failed `--danger`) + control icon
buttons (pause/resume/restart/cancel/remove, shown per state) + a 6px progress bar colored by status.
Footer counts line.

### 6. Users
Header. Card: "Roles" explainer (Admin/Manager/Viewer). Table: Email (+ "you" pill on self), Role
`<select>` (disabled for self, 55% opacity), Joined, Last sign-in.

### 7. Activity
Header. Card + table: When (mono), Who, Action badge (colored by type — Uploaded `--c-sky`,
Edited `--c-indigo`, Undid upload `--c-amber`, Deleted/Bulk deleted `--c-rose`), What.

## Overlays
- **Product panel** (right drawer, max 640px, slides over a `rgba(3,5,8,.55)` scrim; Esc or scrim
  closes): header "Product" + close X; product summary card (name + review pill + as-printed + 2-col
  fields CAS/Price/Purity/Supplier); optional **Edit listing** card (inputs + "Needs review" checkbox
  + Cancel/Save) shown when opened via Edit; "Technical details" card; footer "Done".
- **Delete modal** (centered, max 460px): "Delete selected listings?" + warning copy + Cancel /
  "Delete listings" (`--danger`). Esc/scrim closes.

## Interactions & Behavior
- **Nav**: clicking a sidebar item switches `page` state and scrolls main to top.
- **Theme toggle**: flips dark/light; header icon + all tokens swap live.
- **Filters button**: toggles the filter toolbar (chevron rotates 180°).
- **Row click** (Search): sets active row → detail panel updates. Checkbox click uses
  `stopPropagation` so selecting doesn't activate. "Select all" header checkbox selects every row;
  selection count + banner appear; "clear" empties selection.
- **CSV export**: builds CSV from data, triggers a Blob download (`brochuredb-export.csv`).
- **Detail Edit/View buttons** call callbacks (`onEdit`/`onView`) → host opens the product drawer
  (edit variant shows the edit card).
- Transitions: nav bg/color 120ms; row bg 120ms; chevron transform 160ms.

## State Management
- `page` (which view), `theme` (dark|light, defaults from `theme` prop), overlay (`panel`|`delete`|null),
  `overlayEdit` (bool).
- Inspector: `selected` (map of row→bool), `activeId` (detail row), `letter` (starts-with filter),
  `filtersOpen` (bool). Props: `palette`, `embedded`, `fill`, `onView`, `onEdit`.
- Data is static mock arrays (listings, suppliers, users, uploads, audit, upload jobs, review groups)
  — replace with real fetches. Purity % is parsed from the purity string for the bar.

## Design Tokens

### Typography
- Family: **Geist** (sans) + **Geist Mono** (numbers/CAS/prices). Antialiased.
- H1 26/32 600 -0.02em · H2 24 600 · card H3 15–16 500 · body 13–14 400 · labels 11–12 500/600
  uppercase letter-spacing .05–.06em. Numbers use `font-variant-numeric: tabular-nums`.

### Radii
`--r-chip 7px · --r-btn 10px · --r-card 14px · --r-panel 18px`.

### Theming model
Every color is a CSS var. A **base palette** (neutrals + brand) is chosen by theme (dark/light) and an
**accent override** map is merged on top (changes `--brand*` and some hue vars). Implement as two
switches: `theme` (Dark/Light) and `accent` (Teal/Violet/Blue/Amber/Ember), plus `density`.

**Teal — Dark (base):** app `#0e1116` surface `#161a21` elevated `#1c212a` muted `#232935`
hover `#2a3140` fg `#e7eaf0` fg-muted `#99a3b2` fg-subtle `#6b7686` line `#262d39`
line-strong `#384152` brand `#21b6a8` brand-hover `#33c6b8` on-brand `#052623` brand-text `#46d0c2`
brand-soft `#123734` brand-soft-text `#5fddcf` danger `#e0655f` on-danger `#2a0a08`
danger-soft `#3a1613` danger-text `#f0a6a1` warn-soft `#33270f` warn-text `#e6b968`
ok-soft `#103026` ok-text `#63d19e`.
Hues (dark): c-teal `#46d0c2`/soft `#123734` · c-indigo `#8b9bfb`/`#1c2350` · c-violet `#c58cf5`/`#2c1f47`
· c-amber `#e6b968`/`#33270f` · c-rose `#ef8fae`/`#3a1826` · c-green `#63d19e`/`#103026`
· c-sky `#63b6ea`/`#0f2a3d`.

**Teal — Light:** app `#f6f7f9` surface `#ffffff` muted `#eceef2` hover `#e7eaef` fg `#171b24`
fg-muted `#6b7688` fg-subtle `#98a2b1` line `#dde1e8` line-strong `#c4cbd5` brand `#0f7a72`
brand-hover `#0b615a` on-brand `#fff` brand-text `#0b615a` brand-soft `#e8f6f4` danger `#c6413b`
danger-soft `#fcecec` danger-text `#a5322d` warn-soft `#fcf3e6` warn-text `#8f5e12` ok-soft `#e9f7ef`
ok-text `#0e6d4a`. Hues (light): c-teal `#0f7a72`/`#e2f4f2` · c-indigo `#4f5bd5`/`#eaecfb`
· c-violet `#8b3fd4`/`#f3e9fc` · c-amber `#a6720f`/`#fbf1dd` · c-rose `#c14b74`/`#fceaf1`
· c-green `#0e6d4a`/`#e4f5ec` · c-sky `#1f7bb8`/`#e3f1fb`.

**Accent overrides** (merged over base brand vars):
- Violet dark brand `#8b8cf9` text `#aeaffb` soft `#231f4a` soft-text `#c8c9fd` / light brand `#5a5bd6`.
- Blue dark brand `#4a92f5` text `#7ab2fa` soft `#122942` / light brand `#2f6bf0`.
- Amber dark brand `#e0a34a` text `#ecbc6e` soft `#352712` / light brand `#b5781a`.
- **Ember (orange, primary in the Ember variant)** — also overrides the neutral base to near-black:
  - Dark: app `#0d0d0e` surface `#191919` elevated `#222223` muted `#292a2b` hover `#323234`
    fg `#f3f3f4` fg-muted `#a8a8ac` fg-subtle `#76767b` line `#292a2c` line-strong `#3d3d41`
    brand `#f5842f` brand-hover `#ff9846` on-brand `#241001` brand-text `#ff9d57` brand-soft `#3a2110`
    brand-soft-text `#ffb877` warn-soft `#37280d` warn-text `#f0c069`.
  - Light: app `#f5f5f6` surface `#fff` muted `#eeeeef` hover `#e7e7e9` fg `#1a1a1b` fg-muted `#67676c`
    fg-subtle `#96969c` line `#e5e5e7` line-strong `#d2d2d6` brand `#d1600f` brand-hover `#b34f0a`
    on-brand `#fff` brand-text `#b34f0a` brand-soft `#fbeada` warn-soft `#fbf1dd` warn-text `#8a5a10`.

### Shadows
Cards flat (1px border). Drawer `-12px 0 40px -8px rgba(0,0,0,.4)`. Modal `0 24px 60px -12px rgba(0,0,0,.5)`.
Ember hero glow `0 18px 40px -18px rgba(245,132,47,.55)`.

## Assets
- Fonts: Geist + Geist Mono via Google Fonts.
- Icons: inline SVG, **lucide** icon set (search, flask/beaker, building, file-warning, upload, users,
  list, sun, moon, download, mail, phone, external-link, map-pin, chevrons, x, trash, play/pause,
  rotate, sparkle for AI). Use the codebase's icon library equivalents.
- No raster images. The donut and progress/purity bars are pure CSS/SVG.
- `input,select,textarea { box-sizing: border-box }` is required (padded inputs overflow otherwise).

## Files
- `BrochureDB.dc.html` — full app, Teal theme (reference for shell + all 7 pages + overlays).
- `BrochureDB Ember.dc.html` — same app, Ember accent + neutral-black base + Dashboard gradient hero.
- `Inspector.dc.html` — the Search view as a reusable component (header + filter toolbar + results +
  detail); embedded by both apps. Build this as `<SearchInspector palette theme onView onEdit />`.
