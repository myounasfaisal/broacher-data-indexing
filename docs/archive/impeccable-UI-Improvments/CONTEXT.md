# Context — `impeccable-UI-Improvments/`

Handoff notes for continuing work on the BrochureDB design prototypes in a fresh session.

## What this folder is

Three `.dc.html` "Design Components" prototypes plus a local preview runtime:

| File | What it is |
|---|---|
| `BrochureDB.dc.html` | Full admin app, **Teal** accent (primary theme). |
| `BrochureDB Ember.dc.html` | Same app, **Ember** (orange) accent on near-black base + gradient hero banner on the Dashboard. |
| `Inspector.dc.html` | The Search view, extracted as a reusable component; embedded by both apps via `<dc-import>`. |
| `support.js` | **Local preview runtime** — see below. |
| `README.md` | Original design handoff (tokens, screens, layout spec). |

Per `README.md`, the `.dc.html` files are **design references to rebuild in the real `frontend/`**, not
production code. The user is currently editing them to **explore themes**, so they need to render in a browser.

## The user's goal

Preview the prototypes locally to evaluate accent themes. Not (yet) porting to the app.

## `support.js` — the preview runtime

The original bundle referenced a `support.js` that was **never shipped**. Without it the prototypes load but
nothing is interpreted: every `<sc-if>` branch renders at once (all overlays/modals stack on the dashboard),
`{{ }}` holes show as literal text, and theme variables never apply — this is what the "broken" screenshot showed.

`support.js` here is a **local reimplementation written as a preview aid only. Do NOT port it into the app.**
It implements just what these three files use:

- `{{ }}` interpolation in text and attribute values
- `<sc-if value="{{ … }}">`, `<sc-for list="{{ … }}" as="x">`
- `<dc-import name="…" …>` (embeds another `.dc.html`; passes props like `on-view` → `onView`)
- `<helmet>` hoisting into `<head>`
- `onClick` / `onChange`; `style` (string or object, incl. CSS custom properties); `style-hover`
- a `DCLogic` base class: `state` / `props` / `setState` / `renderVals` / `componentDidMount`

`setState` re-renders the whole subtree (focus is restored to the active input). Fine at prototype scale; it's
why typing in a bound field feels slightly less smooth than a real framework.

## How to preview

```bash
cd impeccable-UI-Improvments
python3 -m http.server 8000
# open http://127.0.0.1:8000/BrochureDB%20Ember.dc.html
```

- **HTTP is required** — `<dc-import>` uses `fetch()`, which is blocked on `file://` URLs. Any static server
  works (VS Code Live Server, `npx serve`, …). Hard-refresh (Ctrl+Shift+R) after editing `support.js`.
- Default page is `search`, so the **Ember hero banner only appears after clicking Dashboard** in the sidebar.

## Switching accents while previewing

The runtime seeds props from the `data-props` JSON on the `<script type="text/x-dc">` tag; the accent shown is
that prop's `default`. To preview another, edit that default in the `.dc.html`, e.g.:

```
&quot;default&quot;:&quot;Ember&quot;   →   &quot;default&quot;:&quot;Violet&quot;
```

Valid accents = keys of the `ACCENTS` table in the same script: **Teal, Ember, Violet, Blue, Amber**.
`theme` accepts **Dark / Light**; the in-app sun/moon toggle overrides it at runtime.

## Verifying renders (no browser needed)

Chrome is unusable headless in this sandbox (it hangs). Verify with **jsdom in Node** instead: load the
`.dc.html`, inject `support.js` as a `<script>`, stub `window.fetch` to read imports off disk, then inspect the
DOM after a short timeout. Sanity checks that passed:

| Check | Teal | Ember |
|---|---|---|
| `--brand` | `#21b6a8` | `#f5842f` |
| `--app` | `#0e1116` | `#0d0d0e` |
| Nav buttons | 7 | 7 |
| Inspector embedded via `dc-import` | ✅ | ✅ |
| Overlays hidden by default | ✅ | ✅ |
| Leftover `{{ }}` / `sc-if` / `sc-for` | 0 | 0 |

## Bugs fixed (watch for regressions)

1. **Infinite loop / memory blowup / frozen tab** — `hoistHelmet` used `importNode` without removing the
   original child, so `while (h.firstChild)` never terminated and it appended `<head>` copies forever. Fixed by
   `h.removeChild(child)` before copying across documents. *This was the cause of the "page won't load / eats
   memory" symptom.*
2. **NUL bytes as string literals** in `isSingleHole` (worked by accident) — replaced with an explicit
   `ONLY_HOLE` regex.
3. **Cloudflare artifacts baked into `BrochureDB Ember.dc.html`** from a web save — an obfuscated
   `__cf_email__` email link (restored to `admin@aitexsolutions.com`) and an injected `/cdn-cgi/…`
   email-decode `<script>` (removed).

## Related docs

- `README.md` → section **"Previewing the prototypes locally"** covers the same preview/accent instructions.
- Persistent memory: `dc-prototype-preview` (same facts, loaded automatically in future sessions).
