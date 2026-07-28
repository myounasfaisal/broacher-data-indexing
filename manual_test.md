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

---

## Upload — "Start processing" gate + page-image cleanup (2026-07-26)

Files: `routers/upload.py`, `services/pipeline_db.py`, `services/splitter.py`,
`worker.py`, `config.py`, `schemas/chemical.py`, `pages/AdminUploadPage.tsx`,
`upload/UploadQueue.tsx`, `upload/UploadJobRow.tsx`, `lib/api.ts`,
`types/chemical.ts`, `db/migrations/2026-07-26_staged_status.sql`

**Prerequisite:** run `db/migrations/2026-07-26_staged_status.sql` in the Supabase
SQL editor first. Without it every upload fails with a 23514 check violation.

### Staging
- [ ] Upload one PDF → row appears as **Ready to start**, empty progress bar,
      "Uploaded — waiting for you to start processing."
- [ ] The worker log shows NO activity for it (it is not claimable).
- [ ] A "N files ready to process" banner appears with **Start processing (N)**.
- [ ] Upload more files across several separate selections → the count grows and
      they all stay staged (a batch can be built up over time).
- [ ] Reload the page mid-batch → staged rows are still there (DB-backed).

### Start
- [ ] Press **Start processing** → rows move Queued → Extracting; the worker log
      shows a claim within ~3s; the banner disappears.
- [ ] Progress bar tracks real pages-done; listings appear in search afterwards.
- [ ] Press it with nothing staged (button hidden) — no way to fire an empty call.

### Discard
- [ ] A staged row shows a trash icon; first click arms it, second within 3s
      deletes the row.
- [ ] After discard the file is gone from the list and its PDF is gone from the
      `brochure-pages` bucket (`{doc_id}/source.pdf`).
- [ ] Discard is NOT offered on extracting/done/failed rows.
- [ ] `POST /upload-jobs/{id}/discard` on a non-staged document → 409.

### Page-image cleanup
- [ ] While a document extracts, watch `brochure-pages/{doc_id}/` — PNGs
      disappear one at a time as each page completes.
- [ ] On `done`: no PNGs and no `source.pdf` left for that document.
- [ ] Force a page failure (bad API key mid-run): the FAILED page's PNG is still
      present, and Restart resumes without re-splitting.
- [ ] Page rows still carry `markdown_output` / `raw_json` after their image is
      gone (debugging data survives).

### Ownership
- [ ] User A stages files; user B pressing Start processing does not release
      them (scoped by `uploaded_by`).

## Sourcing assistant (chat)

Feature ships dark. Set `CHAT_ENABLED=true` in `backend/.env` first, and pick a
provider with `CHAT_PROVIDER` (`anthropic` | `gpt` | `qwen`).

### Gating
- [ ] With `CHAT_ENABLED=false`, `POST /chat/threads` → 503 and the Assistant
      button's panel shows the error toast rather than an empty chat.
- [ ] All three roles (viewer / manager / admin) can open the panel and get an
      answer — same audience as `/search`.
- [ ] No JWT → 401 on every `/chat` route.

### Answers over the catalog
- [ ] "Which suppliers carry an epoxy hardener for tile adhesive?" → names real
      suppliers, cites product rows, and does **not** lead with price.
- [ ] Ask about a chemical where every listing has `price = null` → the reply
      never states or implies a price, and each cited row shows an em dash.
- [ ] "Who supplies <a chemical with several suppliers>?" → uses
      `compare_suppliers`; rows with fuller data appear before bare ones, and a
      `needs_review` row is labelled "Pending review".
- [ ] Ask for something not in the catalog → says so plainly. No invented
      product, no invented supplier.

### Trust boundary
- [ ] Every product mentioned in the prose appears as a rendered row beneath it;
      no `[[uuid]]` markers are visible in the text.
- [ ] Cross-check one cited row against `/search` for the same product — price,
      purity and supplier match exactly (the row comes from the DB, not the model).
- [ ] Clicking a cited row opens the listing panel for that product.
- [ ] Temporarily make the model cite a bogus id (edit the prompt to emit one):
      the reply still renders, the fake row is absent, and the backend logs
      "Chat cited a listing id not present in any tool result".

### Regulatory
- [ ] "X has been banned, what else can we use?" → accepts the premise without
      arguing and suggests alternatives that exist in the catalog.
- [ ] "Is X banned in the UAE?" → declines to confirm and says it needs checking
      against a current regulatory source. It must NOT assert a status.

### Inspector context
- [ ] Open a product, then ask "is this one any good?" → resolves to that
      product without it being named.
- [ ] Type a query in the search box, then ask "any alternatives?" → the answer
      relates to what's in the box.

### Thread lifecycle
- [ ] Send 10 messages → a "N messages left" hint appears at ≤4 remaining.
- [ ] Reach 20 → input is replaced by "Start a new chat"; `POST .../messages`
      returns 409.
- [ ] "Start a new chat" clears the transcript and accepts messages again.
- [ ] Close the panel, reopen it → previous conversation is gone (ephemeral).
- [ ] Close the panel, then replay the old thread id via curl → 404 "This chat
      has expired."
- [ ] Navigate to another page with the panel open → thread is closed too.
- [ ] User A's thread id used with user B's JWT → 404, never another user's chat.

### Limits and failure
- [ ] Send 11 messages inside a minute → 429.
- [ ] Break the provider key mid-session → 502 with a readable message, and the
      failed question returns to the input box rather than being lost.
- [ ] The refused turn did **not** consume a slot (the remaining count is
      unchanged).

### Providers
Run the same two questions under each configured provider:
- [ ] `CHAT_PROVIDER=anthropic` → answers, cites rows.
- [ ] `CHAT_PROVIDER=gpt` → same behaviour.
- [ ] `CHAT_PROVIDER=qwen` → same behaviour.
- [ ] Answers stay short (2–3 sentences) and open with the answer, not a
      preamble, on all three.

### Audit
- [ ] Each exchange writes one `chat_query` row to the audit log with the
      question, the tools called, and the cited listing ids — and it is still
      there after the chat is closed.

### Progress feedback (streaming)
- [ ] Ask anything → an activity trail appears immediately: a pulsing icon,
      animated dots and a sweeping bar, labelled "Thinking".
- [ ] As it works the trail names the REAL lookups — e.g. "Searching the catalog
      for 'floor'" — and each completed step dims with a tick and its result
      count ("1 result" / "nothing found").
- [ ] The named search term matches what you asked. A wrong term here means the
      assistant misread the question, visible before the answer arrives.
- [ ] Completed steps stay on screen while the next one runs; only the current
      step animates.
- [ ] Enable OS "reduce motion" → animations freeze but every step stays
      legible from its text, icon and tick alone.
- [ ] Kill the backend mid-answer → the stream ends without `done` and the UI
      reports a failure rather than spinning forever.
- [ ] Break the provider key → an `error` event arrives (HTTP is already 200 by
      then) and the question returns to the input box.

### Search-before-claiming-absence
- [ ] Ask for something genuinely absent → the trail shows **several different**
      search angles before it reports nothing (not one search and give up).
- [ ] Ask "what do we stock for floor coatings?" → it must FIND the flooring
      admixture. A "we don't stock that" here is a false negative: the product
      is described as "abrasion resistance in flooring", not "floor coating".
- [ ] Ask about a nonsense compound → it searches first, then says no, and
      invents nothing.

### Functional equivalence (substitution questions)
- [ ] "What can replace titanium dioxide in coatings?" → either products that
      are genuinely opacifying pigments, or "the catalog has nothing that does
      that job". It must NOT offer dispersants, emulsifiers or binders that
      merely mention pigments — those act ON a pigment and are not substitutes.
- [ ] Any suggested alternative can be justified from that row's own `details`.

### Unrecorded attributes
- [ ] "Which are non-flammable?" / "Show REACH-compliant solvents" → says the
      brochures do not record that attribute, rather than "we have none"
      (which reads as "we cannot source it").
- [ ] It never asserts REACH compliance or non-flammability for any product.
- [ ] A supplier with no listings is reported as "that supplier has no products
      in the catalog", distinct from "nothing matches your criteria".

### Price filter must stay off the agent's path
- [ ] Ask an availability question that hits a product with NO printed price
      (e.g. "floor") → the product is found. A zero-result answer here means
      `priced_only` has leaked back into the agent's tool schema; it is
      deliberately not exposed, because most listings have no price and the
      model sets it unprompted, turning "we stock one" into "we stock none".

### Tool failures are distinguishable from empty results
- [ ] Break the database credentials, ask a question → the trail shows "lookup
      failed", not "nothing found". These must never look the same: a broken
      lookup that reads as an empty catalog hides real bugs.

### Query widening (phrase searches)
- [ ] "Who supplies hydrocarbon resins?" → lists the C5/C9 and Aromatic resins.
      A "nothing found" here means the singular/plural widening broke: the
      catalog stores "Hydrocarbon Resin", and a literal substring match on the
      plural phrase finds nothing.
- [ ] "What do we stock for floor coatings?" → finds the flooring admixture,
      described honestly as an admixture rather than as a floor coating.
- [ ] Ask for a two-word chemical we do NOT hold (e.g. "calcium carbonate") →
      says we don't stock it. It must NOT offer dimethyl carbonate or any other
      product that merely shares the word "carbonate".

### Substitution flow (think first, then verify)
- [ ] "What can replace titanium dioxide in coatings?" → the activity trail
      shows it searching the real candidate substances BY NAME (zinc oxide,
      calcium carbonate, kaolin, barium sulphate), not a generic term.
- [ ] The answer names those candidates even when we stock none of them —
      "we hold none of them" is the useful answer, since it tells the team what
      to source.
- [ ] It never claims to stock something and also say it isn't in the catalog.

---

## House knowledge — substitution + regulatory notes (P4) (2026-07-26)

Files: `db/migrations/2026-07-26_house_knowledge.sql`, `routers/notes.py`,
`schemas/notes.py`, `services/database.py`, `services/agent_tools.py`,
`prompts/chat_prompt.py`, `listing/HouseNotesCard.tsx`,
`listing/ListingDetailBody.tsx`, `search/ChatPanel.tsx`, `lib/api.ts`

**Run the migration first** — the whole feature 500s without the two tables.

### Capture (Inspector)

- [ ] Open any product → a **House knowledge** card appears below the details
      header, marked "our own judgement"
- [ ] As a **viewer**: notes are readable, no "Add" buttons, no delete buttons
- [ ] As **admin/manager**: `Substitution note` and `Regulatory note` buttons show
- [ ] Save a substitution ("zinc oxide", verdict *works*, context "GCC floor
      coatings") → appears immediately, attributed to your email with today's date
- [ ] Name a substitute we do **not** stock → saves fine and shows a
      `not in catalog` chip. This is the point, not a validation failure
- [ ] Name one we DO stock (exact chemical name) → saves without that chip
- [ ] Save with verdict `avoid` → renders in the destructive colour, not as a
      neutral suggestion
- [ ] Save a regulatory note (jurisdiction `EU REACH`, *restricted*, a date, a
      source URL) → jurisdiction, status badge, date and Source link all render
- [ ] Leave the effective date blank → reads "no effective date recorded",
      never a blank or an invented date
- [ ] Delete a note → gone after the toast, no reload needed
- [ ] Open a listing with **no CAS / no chemical_id** → the card explains notes
      can't attach yet rather than rendering an empty section

### Permissions

- [ ] `POST /notes/substitutions` as a viewer's token → 403
- [ ] `GET /notes?chemical_id=…` as a viewer → 200 with the notes
- [ ] Both writes and both deletes appear in the admin audit log

### The assistant reads them

- [ ] Record "titanium dioxide → zinc oxide, works, GCC floor coatings", then
      ask the chat "what can replace titanium dioxide?" → the activity trail
      shows **Reading our substitution notes** BEFORE any catalog search
- [ ] The answer leads with the house note, names the author, and repeats the
      context ("for GCC floor coatings") — a substitution stated without its
      context is wrong even when the substance is right
- [ ] Record the same pair with verdict `avoid` instead → the assistant does
      NOT offer it, and says it was tried
- [ ] Ask about a substance with no notes → it falls back to its own chemistry
      and says so. A house-note lookup returning nothing must never read as
      "we don't stock it"

### Regulatory path

- [ ] Ask "is X banned?" with **no** note recorded → says it isn't recorded and
      needs a current regulatory source. It must not answer "no, it's fine"
      either: absence of a note is not evidence of permission
- [ ] Record a `restricted` note for X, ask again → the answer carries the
      jurisdiction AND the date, and repeats the partial-restriction nuance
      rather than compressing it to "banned"
- [ ] Ask about a jurisdiction the note doesn't cover → it does not extend the
      recorded status to it
- [ ] Say "X got banned, what else works?" → it accepts the premise without
      arguing and answers the sourcing question

### Trust boundary (unchanged, verify it held)

- [ ] A note never renders as a product row in the chat — cited rows still come
      only from catalog lookups
- [ ] Prices in the chat still come from the database row, not the prose

---

## Semantic index — find_similar_chemicals (P3) (2026-07-26)

Files: `db/migrations/2026-07-26_chemical_embeddings.sql`,
`services/embeddings.py`, `app/embed_backfill.py`, `services/agent_tools.py`,
`services/database.py`, `app/worker.py`, `prompts/chat_prompt.py`,
`search/ChatPanel.tsx`, `config.py`

> **Applied to production 2026-07-26**: migration run, `EMBEDDINGS_ENABLED=true`
> in `backend/.env`, backfill complete — the index holds **324** chemicals (the
> buyable subset of 1005). The setup steps below are for a fresh environment.

### Setup

- [ ] Run the migration → `select count(*) from chemical_embeddings;` returns 0
- [ ] `EMBEDDINGS_ENABLED=false` (the default), ask the chat "what do we stock
      for floor coatings?" → the trail shows **Looking for similar products**,
      the answer still works, and it does NOT claim we stock nothing. The tool
      degraded to a name match; that must never read as an empty catalog
- [ ] `python -m app.embed_backfill` with the flag off → exits non-zero with a
      clear message rather than silently doing nothing
- [ ] Set `EMBEDDINGS_ENABLED=true`, run `python -m app.embed_backfill` →
      logs `embedded=N`, and the table now holds one row per chemical
- [ ] Run it a **second** time → `embedded=0 skipped=N`. Re-running over an
      unchanged catalog must cost nothing; anything else means the source text
      isn't deterministic
- [ ] `python -m app.embed_backfill --force` → re-embeds everything

### Retrieval quality

- [ ] "What do we stock for floor coatings?" → finds the flooring admixture via
      similarity, described honestly as an admixture
- [ ] "Something to thicken a water-based coating" (a job, not a name) →
      returns plausible rows, each cited as a real product row
- [ ] "What can replace titanium dioxide?" → the trail shows house notes first,
      then similar products; the answer never rates a similarity match above
      medium confidence
- [ ] Ask about a substance we hold → it does **not** offer that same substance
      back as its own alternative
- [ ] Ask for something genuinely absent ("food-grade gelatin") → says we hold
      nothing. **This is the sharp test**: the tool DOES return 8 rows at
      0.55-0.60 for that query (measured), because scores on this catalog sit
      in a narrow band whether or not anything fits. The assistant must reject
      all of them on the evidence test and say we hold nothing — if it offers
      propylene glycol or a silica because the number "looked high", the
      prompt-side guard has regressed

### Degradation (the important part)

- [ ] With the index built, break `QWEN_API_KEY` → ask a similarity question:
      the answer still arrives, marked as a name match. It must not 500 and
      must not say "nothing similar"
- [ ] Truncate `chemical_embeddings`, keep the flag on → same: degraded, not
      empty
- [ ] Restore both → answers return to semantic quality

### Incremental refresh

- [ ] Upload a brochure with the flag on → after the document reaches `done`,
      the worker log shows `Embedded N chemical(s) for document …`
- [ ] Break the embedding key and upload again → the document still completes
      as `done`; only a warning is logged. Indexing must never hold an upload
      hostage
- [ ] Re-upload an identical brochure → nothing new is embedded (unchanged
      source text)

### Trust boundary (unchanged, verify it held)

- [ ] Rows from a similarity result render as live product rows with database
      prices; the `similarity` score never appears as a price or a fact
- [ ] The assistant never states a product exists purely because it was a
      near neighbour — it quotes the row's own details

---

## Chat panel — UX pass (2026-07-26)

Files: `search/ChatPanel.tsx`, `pages/SearchPage.tsx`, `lib/api.ts`

### Context strip (new)

- [ ] Open the assistant with no filters and nothing selected → no strip at all
      (empty chrome that never earns its row)
- [ ] Type a search, pick a supplier filter, click a product → the strip shows
      "It can see" + the selected product, the query and the supplier
- [ ] Ask "is this one any good?" → it answers about the product in the strip.
      The strip is the promise; this is the check that it's kept

### Composer

- [ ] Panel opens with the caret already in the composer
- [ ] Type a long two-clause question → the field grows to ~5 rows, then scrolls
- [ ] Enter sends; Shift+Enter inserts a newline
- [ ] While it answers, the send button becomes **Stop** → pressing it ends the
      run, leaves "Stopped." in the transcript, and does NOT raise a toast

### Transcript

- [ ] After an answer, a "N lookups" disclosure sits under it → expands to the
      full trail with result counts. Previously this was destroyed on completion
- [ ] Hover an answer → Copy appears; it is also reachable by keyboard
- [ ] Kill the backend, ask something → the failure renders as an inline block
      **in the transcript** with "Try again", not just a toast
- [ ] "Try again" re-asks the same question and removes the failed turn
- [ ] Scroll up mid-answer → the view stays put and a "Jump to latest" pill
      appears; clicking it returns and re-pins
- [ ] Cited rows show the same warning `review` badge as the results table

### Panel shell

- [ ] Phone width: a scrim covers the page behind, tapping it closes the panel
- [ ] `sm` and up: no scrim — it is a dock, not a modal
- [ ] Escape with focus in the chat closes the chat
- [ ] Escape with the product Inspector open closes **only** the Inspector
      (it sits above the chat); the chat stays
- [ ] Closing by any route returns focus to the "Assistant" toolbar button
- [ ] `prefers-reduced-motion` → panel appears without sliding, trail still legible

## Production deployment (GCP VM 34.18.9.118, docker-compose.prod.yml — demo mode)

Standalone single-app, no-domain, self-signed HTTPS. The `web` nginx serves the
SPA and proxies /api to the backend on the same origin, and terminates TLS
itself. Run from `/opt/<repo>` after
`docker compose -f docker-compose.prod.yml up -d --build`.

- [ ] `docker compose -f docker-compose.prod.yml ps` shows backend, reconciler,
      web `Up`, and 4 `worker` replicas `Up`
- [ ] `curl -k https://34.18.9.118/api/health` returns 200 (nginx → backend)
- [ ] `http://34.18.9.118` 301-redirects to `https://34.18.9.118`
- [ ] Browser at `https://34.18.9.118`: after the one-time self-signed warning
      (Advanced → proceed), the SPA loads and login via Supabase succeeds
- [ ] Upload a brochure → it does NOT sit at "queued": a worker picks it up and
      it reaches extracted/review (proves workers are actually running)
- [ ] If CHAT_ENABLED=true: a chat reply streams token-by-token (SSE not buffered)
- [ ] `docker compose -f docker-compose.prod.yml logs -f worker` shows heartbeat
      + jobs across replicas, no restart loop
- [ ] Reboot the VM → `docker compose ... ps` shows everything back Up
      (restart: unless-stopped) without manual intervention

## Admin Settings tab overhaul (SettingField + modelCatalog + stable ordering)

Reworked admin Settings page: typed field rendering, curated model dropdowns,
testable saved keys, and stable field order. Backend: SETTING_ORDER +
test-saved-key resolution.

- [ ] Open Admin → Settings: every category renders with its icon; fields appear
      in a stable, semantic order and do NOT shuffle position on reload/refetch
- [ ] Model fields (e.g. claude_model, openai_model) render as dropdowns of
      curated options, not free-text boxes
- [ ] Choosing "Custom…" on a model field reveals a text input; saving a custom
      value persists and re-renders as that value (not a blank select)
- [ ] A stored model outside the catalogue still shows correctly (falls back to
      Custom) and is not silently reset on save
- [ ] Boolean settings (chat_enabled, embeddings_enabled, pubchem_*) render as
      switches; number settings render narrow with a stepper
- [ ] API-key fields show a masked value with an eye toggle to reveal/edit
- [ ] "Test" on a key that is ALREADY SAVED (field still masked, nothing typed)
      resolves the stored key server-side and returns a real ok/fail result
- [ ] "Test" with no key saved anywhere returns "No key saved for this provider
      yet — enter one first."
- [ ] Advanced fields (endpoint URLs, embedding_dim, nuextract_project_id) are
      folded away by default and expand on demand
- [ ] Saving persists; reload shows saved values; the embeddings category reads
      "Semantic Search"
