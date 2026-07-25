# Handoff — session context

Paste-ready context for continuing work in a new chat. For the strategic "why"
read [PRODUCT.md](PRODUCT.md); for the visual system read [DESIGN.md](DESIGN.md);
for what to verify in-browser read [manual_test.md](manual_test.md). This file is
the operational summary that ties them together.

## What this is

**BrochureDB** — an internal chemical supplier-catalog admin tool. Client: **BosTech
Polymer** (Dubai chemical supplier). The job: search a chemical, get the best supplier
and price, from data extracted out of supplier brochure PDFs. It is a decision tool, not
a database browser — "The Shortlist" is the design north star.

- **Register:** product · **Platform:** web
- **Repo root:** `/home/nasir/myComputer/AITEXSOLUTIONS/broucher-data-indexing`
- **Frontend:** React 18 + Vite + Tailwind v4 + TanStack Query + Supabase, in `frontend/`
- **Backend:** FastAPI, in `backend/`

## How to run

```bash
cd frontend && npm run dev          # Vite dev server
# backend runs locally on :8000 (start with --reload so param changes reload):
cd backend && ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Typecheck: `cd frontend && npx tsc --noEmit`. Build: `npm run build`.

**The app is auth-gated (Supabase).** An agent without credentials cannot screenshot the
live pages. Verified work in this project is checked by rendering the *compiled* CSS
against representative markup in headless Chrome (`google-chrome --headless=new
--screenshot`), which catches real layout/contrast bugs; live React interaction
(focus, click-outside, reload behaviour) is typecheck-and-build verified, not click-tested.
Flag that distinction honestly in any summary.

## Design system (DESIGN.md is source of truth)

- **North star:** "The Shortlist" — every screen narrows many suppliers to one choice.
- One **Geist** superfamily (Geist + Geist Mono for data). No display face. **Fixed** type
  scale — never `clamp()` on UI type.
- **Flat at rest** — elevation is a response to state (hover/overlay/focus), not permanent.
- **Tabular figures** on every number that can stack in a column.
- **Never color alone** — status (Complete / Needs review / Missing price) always carries
  a label or icon beside its hue.
- **Everything routes through semantic CSS tokens** (`--brand-*`, `--fg-*`, `--line`, …) in
  `frontend/src/index.css`. They flip on **two independent axes**:
  - light/dark → `.dark` class on `<html>`
  - accent → `data-accent="ember"` on `<html>` (Teal is default, no attribute)
- **Two accents, shipped and equal:** Teal (default) + Ember, both contrast-verified in
  light and dark. Switched from the **Appearance popover** (theme + accent swatches) in the
  sidebar footer and mobile top bar. Persisted to `localStorage`, mirrored by the pre-paint
  script in `index.html` so nothing flashes on reload.

## Done this session

Search, Suppliers, and theming — all typecheck + build clean:

- **Search responsive / scroll-economy pass** — filter chrome collapses so results sit
  above the fold at every width; 44px touch targets on coarse pointers (`.touch-target`);
  table→card switch at `lg`; A–Z bar becomes a horizontal snap strip on small screens.
- **Contrast fix** — `--fg-subtle` was 2.6:1 (failed AA and the 3:1 large-text floor); now
  ≥4.5:1 in both themes. Touched every screen.
- **Result rows** — whole row is the click target; product name is plain text (not a link);
  column order Name → Supplier → CAS → Price → Purity; `As printed` column removed (shows
  under the name only when it differs, always in the detail panel); names clamp at 2 lines.
- **Price cell** — never renders an empty chip; when there's no printed price the first
  conversion is promoted to the headline and marked `≈`.
- **Supplier-only search filter** — NEW backend `supplier` param (`routers/search.py`,
  `services/database.py`; resolves name→company ids→`company_id IN (...)`, avoids new
  PostgREST `!inner` syntax). Tested against live DB: `supplier=bostech` → 69,
  `bostech + q=acid` → 2, nonsense → 0. Suppliers "View products" now lands on
  `/search?supplier=…` with the main box empty and a removable supplier chip.
- **Icons** — search magnifier in the box; row `Edit` is now a pencil icon.
- **Ember two-accent system** — the accent axis described above. Ember values were computed,
  not eyeballed: light fill `#BF5010` (white text 4.8:1), dark fill `#F5842F` (near-black
  text 7.0:1); all 9 fill/text pairings contrast-checked. Zero component edits — pure token
  layer. New file: `frontend/src/components/ui/appearance-menu.tsx`.

## Open / next

**`/impeccable audit dashboard`** — the Dashboard is the one surface with no attention this
session. Its listing-status **donut still encodes Complete / Needs review / Missing price by
HUE ALONE**, violating the never-color-alone rule and the WCAG 2.1 AA commitment. This is a
correctness bug, not polish.

**Two data/pipeline issues (NOT UI — do not try to fix in the frontend):**
- Some `name_en` / `name_raw` values arrive from the API already truncated with `…`. CSS
  cannot restore characters that were never sent.
- Most listings have `price` null while `price_usd` / `price_pkr` are populated — the printed
  price isn't being extracted.

**Nothing has been human-tested in-browser yet.** `manual_test.md` holds unrun checklists for
every feature above; walking them is the outstanding QA.
