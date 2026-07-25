# Manual test log

Append one section per feature. Newest at the bottom.

---

## Search — responsive + scroll economy pass (2026-07-20)

Files: `pages/SearchPage.tsx`, `search/SearchFilters.tsx`, `search/ResultsTable.tsx`,
`search/AlphabetBar.tsx`, `search/Pagination.tsx`, `ui/checkbox.tsx`, `ui/table.tsx`,
`listing/ListingDetailBody.tsx`, `index.css`, `index.html`

### Desktop (≥1024px)

- [ ] `/search` on load: first result row visible **without scrolling**
- [ ] Table headers read `Name (EN)` — sentence case, not `NAME (EN)`
- [ ] Column order: Name · **Supplier** · CAS · Price · Purity
- [ ] No `As printed` column; printed name appears under the English name **only**
      when the two differ
- [ ] Hovering a row highlights the full row
- [ ] Clicking anywhere in a row opens the detail panel
- [ ] Clicking a row checkbox selects it and does **not** open the panel
- [ ] Clicking `Edit` opens the edit form and does **not** double-open the panel
- [ ] Product name is plain text — no blue/teal link colour, no underline on hover
- [ ] Long names wrap to at most 2 lines; short names stay 1 line

### Price cell

- [ ] No printed price + conversions → `≈ $155` chip with `Rs43,021` beneath
- [ ] Printed price + conversion → `2,480.00 USD` chip with `≈ Rs691,700` beneath
- [ ] No price data at all → single `—`
- [ ] No empty/stray chip floating above the converted value

### Filters

- [ ] Panel starts **collapsed** at every screen size
- [ ] `Filters` badge counts applied filters **and** an active A–Z letter
- [ ] Pick letter `K`, collapse panel → badge count includes it
- [ ] Price range: `Min` and `Max` both present and filter correctly
- [ ] Min > Max → inline error, `Apply filters` disabled, no request fired
- [ ] `Apply filters` label never changes to a status string
- [ ] `Clear` appears only when something is active

### Mobile (390px and 360px)

- [ ] Toolbar sticks under the top bar while results scroll
- [ ] Product name gets full card width; price sits **beneath** it, not beside
- [ ] Name does not wrap to 4 lines
- [ ] Rows with no CAS/purity omit those fields (no grid of em-dashes)
- [ ] Card order: name → price → Supplier → CAS → Purity
- [ ] Tapping a card opens the detail panel
- [ ] A–Z bar scrolls horizontally, snaps, fades at the right edge
- [ ] A–Z buttons are thumb-sized (44px)
- [ ] Row checkboxes and pagination numbers are tappable first time
- [ ] Tapping the orange `review` badge shows its tooltip (was hover-only)
- [ ] Notched phone: content clears the notch and home indicator

### Detail panel

- [ ] `As printed:` always shown, even when identical to the English name

### Both themes

- [ ] Light and dark both correct; no unreadable muted text
- [ ] `--fg-subtle` text (labels, dashes, converted price) is legible — it was
      2.6:1 before this pass

### Supplier filter (backend + frontend)

Backend: `routers/search.py`, `services/database.py` (new `supplier` param)

- [ ] Filters panel has a `Supplier` box above the price range
- [ ] Supplier text alone narrows results to that supplier
- [ ] Supplier + main search = that product, from that supplier only
- [ ] Nonsense supplier text → 0 results (not "all results")
- [ ] Active supplier shows as a removable chip in the toolbar with the
      panel **collapsed**
- [ ] Clicking the chip's ✕ clears it and re-runs the search
- [ ] Supplier counts toward the `Filters` badge
- [ ] Suppliers page → `View products` lands on `/search?supplier=…` with the
      **main search box empty** and the supplier chip showing
- [ ] Same from the supplier side panel's link
- [ ] `?supplier=` disappears from the URL after load (consumed once)

Backend check without the UI:

```
curl -H "Authorization: Bearer $JWT" \
  "$BACKEND/search?supplier=Qingdao&q=urea&page=1"
```

### Icons

- [ ] Search box has a magnifier icon on the left; text never runs under it
- [ ] Clear ✕ still reachable and doesn't overlap typed text
- [ ] Row `Edit` is a pencil icon with an accessible label, not the word "Edit"

### Known, not fixed here

- Some `name_en` / `name_raw` values arrive from the API already truncated with
  `…`. CSS cannot restore them — pipeline/extraction issue.
- Many listings have `price` null while `price_usd` / `price_pkr` are populated.
  Extraction issue, not UI.

---

## Supplier surface — a11y hardening, distill, overflow, shared formatters

### Drawer focus management (SupplierPanel + ListingPanel — shared `SidePanel`)

- [ ] Open a supplier from the Suppliers table by pressing Enter on its name.
      Focus lands on the drawer's ✕ button.
- [ ] Tab repeatedly. Focus cycles **within** the drawer only and never reaches
      the table behind the scrim. Shift+Tab wraps backwards the same way.
- [ ] Close with Escape. Focus returns to the supplier-name button you opened,
      not to the top of the page. Repeat for the ✕ button and a scrim click.
- [ ] With a screen reader on, confirm the table behind the drawer is not
      readable while it is open (the app root is `inert`).
- [ ] Open a supplier, click a product to swap to the product panel, close it.
      No focus is lost or trapped in a closed panel.

### Product preview error + loading states

- [ ] Block `/search` in DevTools → Network, then open a supplier. The Products
      section shows an error message and a **Try again** button; clicking it
      refetches. Previously this section was silently blank.
- [ ] While loading, a screen reader announces "Loading this supplier's
      products…" (skeleton bars stay `aria-hidden`).
- [ ] A supplier whose name matches nothing shows the "No products matched…"
      message rather than an empty box.

### Long-value overflow

- [ ] Find (or fake) a supplier with a 60+ character email and a long website.
      In the md+ table the Contact column truncates with `…` and the table does
      **not** widen or scroll horizontally; hovering shows the full value.
- [ ] Same supplier below `md`: the card truncates rather than overflowing.
- [ ] A supplier whose name is one unbroken 80-character token: the drawer
      heading wraps instead of forcing horizontal scroll.

### Visual (distill)

- [ ] Drawer content is two plain sections split by a rule — no bordered,
      shadowed cards nested inside the drawer.
- [ ] Drawer is opaque (`bg-elevated`), not blurred glass. Verify in both light
      and dark themes.

### Shared formatters (`src/lib/format.ts`)

- [ ] Suppliers "First seen" and Users table dates render as before (date only).
- [ ] Audit log and Upload history render date **and** time as before.
- [ ] A row with a null/empty timestamp shows "—" and does not crash.

---

## Search — critique fixes (price provenance, a11y, mobile surface)

### Price cell: one currency, provenance visible

- [ ] A listing with **no printed price but a `price_usd`** (the common case in
      this catalog): the headline chip is the USD figure, unfilled/outlined,
      prefixed with a small `est.`. Hovering it says "Estimated — converted
      from the printed price at current exchange rates".
- [ ] A listing with a **printed USD price**: the chip is the filled brand
      accent, no `est.` label, tooltip reads "As printed in the supplier's
      brochure". Confirm the two treatments are distinguishable **without**
      reading the label — fill vs no fill.
- [ ] A listing printed in a **non-USD currency** that also has `price_usd`:
      USD leads the chip; the second line reads e.g. `3,850 AED as printed`.
      The brochure's own number is still on screen.
- [ ] A listing printed in a non-USD currency with **no** conversion: the
      printed figure leads and is *not* marked `est.` (it is a real printed
      price, just not in USD).
- [ ] A listing with **no price of any kind**: a plain `—`, never an empty chip.
- [ ] Scan a full page of results: prices are grouped (`12,000` not `12000`),
      decimals normalized, and digits align down the column.
- [ ] Same formatting improvement appears in the **listing detail panel** and
      the **supplier panel** price columns (they share `formatPrice`).

### Accessibility

- [ ] Search a term returning **several rows flagged `review`**. Tab to the 2nd
      and 3rd review badges — a screen reader announces *that row's* hint, not
      the first row's. (Inspect: each tooltip has a unique `id`.)
- [ ] Type in the search box and let it settle: the result-count line is
      announced by the screen reader (it is `aria-live="polite"`).
- [ ] While a refetch is in flight, the prices stay at **full contrast** — no
      dimming. A thin accent bar appears above the results instead.
- [ ] Initial load: the skeleton announces "Loading results…" rather than
      passing silently.
- [ ] With OS **reduce-motion** on, the progress bar is a static full-width
      quiet track, not a frozen one-third sliver.

### Mobile results surface

- [ ] Below `lg` (e.g. 390px): result cards sit directly on the page field —
      no outer card border/shadow wrapping them, no card-inside-a-card.
- [ ] The cards themselves have a border and **no resting shadow**; pressing
      one tints it and opens the listing.
- [ ] At `lg` and above the wrapper card returns (border, surface, padding) and
      the 7-column table renders inside it as before.

## Suppliers — filter bar

Server-side filter on `GET /suppliers?q=` matching company name (either
script) or email. Server-side because the directory is paginated — filtering
client-side would only search the 10 rows currently on screen.

- [ ] Type a partial supplier name. The list narrows after ~250ms, not on
      every keystroke (watch the Network tab: one request, not one per letter).
- [ ] Type a partial **email** (e.g. `@titanos`). Matches by email too.
- [ ] Type a name in the original script (Chinese). Matches `company_name`.
- [ ] Go to page 3, then type a filter. You land back on page 1, not an empty
      page 3 of the new result set.
- [ ] Clear via the ✕ button and via selecting-all + Delete. Both restore the
      full list and the ✕ disappears when the box is empty.
- [ ] While typing, the previous rows stay on screen (dimmed count) rather
      than flashing back to skeleton bars.
- [ ] A filter matching nothing shows "No supplier matches …" with a working
      **Clear filter** button — not an empty table.
- [ ] With zero suppliers in the DB and no filter, the "No suppliers yet"
      message shows (not a blank card).
- [ ] Tab to the input: focus ring is visible; the magnifier icon does not
      intercept clicks; typed text never runs under either icon.
- [ ] Screen reader announces the updated result count when the filter changes.

Injection / sanitizer check — none of these should error or return the whole
table (`,` `(` `)` `%` `_` are stripped server-side):

```
curl -H "Authorization: Bearer $JWT" "$BACKEND/suppliers?q=%25"
curl -H "Authorization: Bearer $JWT" "$BACKEND/suppliers?q=a,b"
curl -H "Authorization: Bearer $JWT" "$BACKEND/suppliers?q=CO.,LTD"
```

- [ ] `q` longer than 100 chars returns 422, not a 500.

## Suppliers — sort by name

Server-side sort via `GET /suppliers?direction=asc|desc`, ordering by English
name then original name. Suppliers with no English name stay pinned LAST in
both directions (`nullsfirst=False`) — a sort toggle changes order, not which
rows lead.

- [ ] md+ table: the "Supplier" header is a button with an arrow. Click it —
      the order reverses (A–Z ↔ Z–A) and the arrow flips.
- [ ] The header cell exposes `aria-sort` (ascending/descending); a screen
      reader announces the sort state.
- [ ] Below md (cards): a "Name A–Z / Z–A" toggle sits by the count and does
      the same thing (the card layout has no header).
- [ ] Toggling sort while on page 3 sends you back to page 1.
- [ ] Toggling sort keeps the current filter applied (sort + `q` combine).
- [ ] Suppliers with a blank English name appear at the END in BOTH
      directions, not floated to the top on Z–A.
- [ ] Default page load sends no `direction` param (asc is implicit); only
      `desc` adds it to the URL.
- [ ] `?direction=sideways` (invalid) returns 422, not a 500.

## Search — audit fixes (combobox a11y, caption label, X icon)

### Combobox (SearchBox) screen-reader support
- [ ] With a screen reader on, type in the search box and press ↓. Each
      highlighted suggestion is announced (name + count), not silence. This is
      the `aria-activedescendant` → option `id` link.
- [ ] The input reports `aria-haspopup="listbox"`.
- [ ] When nothing is highlighted (highlight = -1), no `aria-activedescendant`
      is set. Pressing Enter with no highlight still submits the typed query.
- [ ] Mouse hover still moves the highlight; Enter commits the highlighted one.

### Caption label consistency
- [ ] "Understood as" (AI chips), "Supplier" (active supplier chip), "Browse
      by letter", and "Suppliers" (suggestion group header) all render at the
      SAME size/weight/tracking — 11px, semibold, uppercase. Previously the AI
      one was lighter/looser and the group header slightly different.
- [ ] Both light and dark themes: the caption uses `--fg-subtle` and stays
      ≥3:1 against the surface.

### Clear button icon
- [ ] The search box clear control is the lucide X icon (matching the chips'
      remove icons), not a text "✕" glyph. It sits clear of typed text and has
      a visible focus ring.

### AI sort chip
- [ ] Run an AI search that yields a non-default sort plus one data filter
      (e.g. "most expensive sodium hydroxide"). Remove the data chip: the sort
      chip REMAINS and results re-run sorted, rather than the whole AI search
      clearing. "Clear AI search" still clears everything.

## Dashboard briefing (masthead + insight row)

Synthesis of the prototype's briefing presence with the shipped app's real
data/loading discipline. New backend fields on `GET /admin/dashboard/summary`:
`status_distribution` (complete / needs_review / missing_price) and
`top_suppliers` (top 4 by listing count).

### Backend aggregation
- [ ] `GET /admin/dashboard/summary` returns `status_distribution` whose three
      values sum to `total_listings`, and `top_suppliers` with ≤4 entries
      sorted by `count` descending. `needs_review` in the distribution equals
      the top-level `needs_review`.
- [ ] A listing that is BOTH flagged for review AND has no price is counted
      once, under `needs_review` (not double-counted in `missing_price`).
- [ ] `top_suppliers` names prefer the English company name, falling back to the
      raw name; a supplier with no name shows "Unknown supplier", never blank.

### Masthead
- [ ] The gradient banner renders in the brand (teal) hue and reads correctly
      in BOTH light and dark mode (white text stays legible on the gradient in
      both). The headline SENTENCE is the visual hero; the two KPI tiles
      (Listings, Suppliers) are secondary at 28px — not the other way round.
- [ ] While loading, the two KPI values show skeletons, not `0` or `—` flashing
      to the real number.
- [ ] There is exactly ONE gradient surface on the page — no second gradient
      anywhere below the masthead.
- [ ] No number in the masthead is repeated by a stat card below it (Listings
      and Suppliers appear only in the masthead; Uploads·7d and Needs review
      only in the stat row).

### Stat row
- [ ] Two cards: "Uploads · 7 days" (sky icon tile) and "Needs review". The
      Needs-review card is the whole clickable target into the review queue and
      shows a focus ring on keyboard focus.

### Listing status donut
- [ ] Three slices in fixed order Complete (green) → Needs review (amber) →
      Missing price (rose), with a visible GAP between adjacent slices. The
      legend lists all three with count (mono) + percentage; the ring's hole is
      empty (no total inside it), and arcs are not labelled directly.
- [ ] Percentages in the legend sum to ~100% and match the slice sizes.
- [ ] Empty catalog (no listings): the ring shows only the muted track, the
      legend shows zeros and "—" for percentages — no divide-by-zero, no NaN.
- [ ] Dark mode: the green and amber slices remain distinguishable — the gap +
      legend carry it even though the two hues are close under colourblind
      simulation.

### Top suppliers bars
- [ ] Every bar is the SAME brand colour (not one colour per rank). The longest
      bar (the leader) is full width; others are a proportion of it. The
      sub-line states the share is of the leader, not the whole catalog.
- [ ] A long supplier name truncates with an ellipsis and shows the full name on
      hover (title); the count never wraps.
- [ ] No suppliers: shows "No supplier listings yet.", not an empty panel.

### Responsive
- [ ] Below `lg`, the donut and supplier panels stack full-width; the masthead
      KPI tiles wrap below the sentence. No horizontal scroll at 375px.

## Upload hardening (a11y + destructive confirm + persistent errors)

### Screen-reader / progress semantics
- [ ] Each queue row's bar is announced as a progress bar with its filename and
      current state (e.g. "acme.pdf upload progress, Processing"). Stage-line
      changes are announced as they update (polite live region), not silently.
- [ ] A file still uploading from the browser announces as an indeterminate
      progress bar ("…uploading") with NO percentage claimed.

### Destructive confirm
- [ ] Clicking Cancel or Remove once does NOT act — the button turns solid-red
      with a check and its tooltip reads "Click again to cancel/remove". A
      second click within 3s commits; waiting >3s (or clicking away) resets it
      to the normal icon. Pause / Resume / Restart still act on the first click.
- [ ] Keyboard: the confirm button is reachable by Tab and shows a focus ring;
      two Enter presses commit.

### Touch targets
- [ ] On a coarse pointer (phone / emulated touch), the 28px control icons each
      have a ≥44px hit area (a near-miss tap still lands) while the visual size
      and desktop density are unchanged.

### Persistent rejected files
- [ ] Select a >20MB PDF (or a file the server rejects): it appears in a
      persistent "N files weren't queued" panel WITH its reason, and stays after
      the toast disappears. Per-file "×" dismisses one; "Dismiss all" clears the
      panel. Starting a NEW selection clears the previous batch's rejections.
- [ ] A mixed batch (some valid, some oversize) queues the valid files AND lists
      the rejected ones — the good files aren't blocked by the bad.

### No regressions
- [ ] A long single-word filename truncates with an ellipsis and shows in full
      on hover (title); the row never pushes the controls off-screen.
- [ ] The progress interval stops once a bar reaches its stage target (no
      runaway timers): a queue of many idle/queued rows stays responsive.

## Premium theme refinement (token layer — both themes)

Identity unchanged: the teal brand hex is untouched. What changed is the
neutral ground, elevation, and borders — refined to feel considered, not
generic. No component/layout changes.

### What to look for
- [ ] Light: surfaces are no longer dead cool-grey — the body bg and panels
      carry a faint teal warmth that ties to the brand. Should read as
      "intentional", not tinted-obvious.
- [ ] Dark: the ground is a deeper teal-charcoal, not blue-grey; feels richer.
- [ ] Cards/panels have layered, soft shadows (tight contact + wide ambient),
      not a flat single drop shadow. Most visible on the search results card,
      side panels, and dropdowns (shadow-pop).
- [ ] Borders are hairline and teal-tinted, consistent with the surfaces.

### Contrast (verified numerically, confirm visually)
- [ ] Body text, muted text, and 11px subtle labels all remain clearly legible
      in BOTH themes. (fg-subtle measured 5.2:1 on surface / 4.7:1 on app;
      fg-muted 6.8:1; all ≥ WCAG AA.)
- [ ] Price chips, CAS chips, brand links, and the review badge keep their
      contrast and don't wash out against the retinted surfaces.
- [ ] Selection highlight, focus rings, and the scrim behind modals/drawers
      still read correctly.

## Search — polish pass (under the new premium theme)

Outcome: the search surface was already high-craft; the retint flows through
it cleanly (no hardcoded colors, all primitives tokenized). One real systemic
drift fixed.

- [ ] Buttons, the search input, and the filter Select now cast the same
      teal-black micro-shadow as the cards/panels — no button carries a
      cooler pure-black `shadow-sm` against the retinted surface. (Fixed at the
      `sm` shadow token, so it's consistent app-wide, not just on search.)
- [ ] Toolbar row (search box + Ask AI + Filters) stays vertically aligned —
      all three are h-10.
- [ ] Suggestion dropdown and side panels read as premium depth (layered
      shadow-pop) over the tinted surfaces.
- [ ] Refetch progress sliver, skeletons, price/CAS/est. chips, and the review
      badge all keep contrast and intent in both themes after the retint.

Deliberately NOT changed (noted, not done): a scroll-reactive shadow under the
sticky toolbar would complete the depth story, but it needs scroll state — an
enhancement beyond a polish pass, offered separately.

## Upload — staged review + drag-drop + bulk stop

Outcome: fixes the "pointed the folder picker at Downloads and everything
started uploading" trap. Selection no longer uploads — it stages files for
review behind an explicit Upload click; drag-and-drop and a real bulk-stop
endpoint were added; the two folder/PDF buttons became one drop-or-browse zone.

Staging (nothing uploads until confirmed):
- [ ] Choosing PDFs (or a folder) fills a "N files ready to upload" review
      panel — the queue does NOT start. Files list with name + size + total.
- [ ] Removing a file (× on its row) drops it from the list; "Clear" empties
      the whole list. Neither uploads anything.
- [ ] "Upload N files" is the only thing that starts the queue. After it runs,
      the review panel is empty and the Progress card shows the jobs.
- [ ] Selecting > 25 files shows the amber "that's a lot of files" warning.

Drag and drop:
- [ ] Dropping a FOLDER onto the zone recurses it and stages every .pdf inside
      (non-PDFs ignored).
- [ ] Dropping multiple PDFs, or a single PDF, stages them.
- [ ] Dragging over the zone highlights it (brand border + fill); leaving
      clears the highlight.
- [ ] Keyboard/AT: the zone itself is NOT a focus stop (no nested-interactive
      trap); Tab lands on the real "Choose PDFs" / "Choose folder" buttons, each
      with a visible focus ring and Enter/Space opening its picker. Mouse users
      can still click anywhere in the zone to browse.

Unified picker:
- [ ] One drop zone with "Choose PDFs" and "Choose folder" buttons (shared
      Button primitive, outline variant) — no more two loud top-level buttons,
      no emoji icons.
- [ ] While a batch is sending, the "Upload N files" button shows a spinner +
      "Uploading…" and the picker is disabled.

Bulk stop:
- [ ] While anything is queued/processing, "Cancel all" appears in the Progress
      header (neutral outline). First click arms it — it turns solid red (shared
      Button `destructive` variant) reading "Click again to cancel all"; a
      second within 3s cancels every active job (backend /upload-jobs/cancel-all).
      Waiting 3s disarms it.
- [ ] A processing file shows "Cancelling…" then "Cancelled" (its in-flight AI
      call can't be interrupted but its result is dropped); queued/paused files
      flip straight to Cancelled.
- [ ] "Cancel all" disappears once the queue is idle; "Clear finished" returns.

No regressions:
- [ ] Oversize (>20MB) and enqueue-failure files still land in the persistent
      "weren't queued" panel with their reason.
- [ ] Reloading mid-processing still restores the server queue.

## Appearance — Ember accent (two-accent theming)

Files: `index.css` (accent axis), `hooks/useTheme.tsx`, `index.html` (pre-paint),
`components/ui/appearance-menu.tsx`, `components/layout/AppShell.tsx`

### Accent switching
- [ ] Sidebar footer has an "Appearance" row; clicking opens a popover with
      Theme (Light/Dark) and Accent (Teal/Ember swatches).
- [ ] Mobile top bar has the same control as a palette icon button.
- [ ] Picking Ember re-themes the WHOLE app — primary buttons, active nav rail,
      links, price chips, focus rings, badges — not just one component.
- [ ] Picking Teal restores the original.
- [ ] The active accent swatch is ringed with a check; the other is plain.
- [ ] Popover closes on Escape, on outside click, and returns focus to the trigger.
- [ ] Popover opens ABOVE the footer trigger and is not clipped by the sidebar.

### The 4 combinations (Teal/Ember × Light/Dark)
- [ ] All four are legible: button fill vs its text, nav rail, chips, focus ring.
- [ ] Ember light: white button text is readable (deepened fill #BF5010).
- [ ] Ember dark: near-black button text on bright fill #F5842F is readable.
- [ ] Ember never looks brown/muddy in light, never neon-washed in dark.

### Persistence / no flash
- [ ] Choose Ember + Dark, hard-reload. No flash of Teal or Light before the
      app renders (pre-paint script in index.html).
- [ ] Choice survives a full browser restart (localStorage `accent` key).
- [ ] Clearing localStorage falls back to Teal + system theme.

### Regressions
- [ ] Light/dark toggle still works from inside the popover.
- [ ] Login page (pre-auth) still themes light/dark; accent defaults to Teal.

---

## Search bar — live neon accent + toolbar state colour

### Neon ring (SearchBox)
- [ ] Focusing the empty search field fades in a rotating brand ring; one half
      bright, the opposite half dim, sweeping continuously around the box.
- [ ] Typing / committing a query keeps the ring on even after the field loses
      focus (query present = still "live"); clearing the query removes it.
- [ ] Search magnifier icon turns brand while the field is live, back to subtle
      when it rests.
- [ ] Ring follows the accent: switch Teal → Ember (Appearance popover) and it
      recolours; correct in both light and dark.
- [ ] Suggestion dropdown still opens above the ring and is not clipped by it.
- [ ] `prefers-reduced-motion`: ring still appears on live fields but holds a
      fixed angle (no spin), bloom quieted.

### Toolbar state colour
- [ ] Opening "Ask AI" tints the button brand-soft (not flat grey); closing
      returns it to the neutral outline.
- [ ] Opening "Filters" tints the same way; the count badge stays brand.

---

## Search filters panel — layout rhythm + tablet grid

- [ ] Desktop (≥1024px): Supplier full-width; Price / Min purity / Sort sit in
      three equal columns as before.
- [ ] Tablet (640–1024px): fields fall to TWO columns — Price + Min purity in a
      row, Sort spanning full below — so the Min–Max pair keeps comfortable
      width (no ~100px squeeze).
- [ ] Phone (<640px): everything stacks one per row.
- [ ] The checkbox + Clear/Apply action row now sits with clear separation
      (24px) below the input grid, reading as a commit step, not another field.
- [ ] Range error ("Minimum is above the maximum") still appears under Price
      without shoving the Purity/Sort columns down (items-start holds).
- [ ] Apply/Clear still right-aligned on desktop, full-width stacked on phone.
