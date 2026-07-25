---
target: search
total_score: 26
p0_count: 3
p1_count: 2
timestamp: 2026-07-20T02-47-06Z
slug: frontend-src-pages-searchpage-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence). No degradation.

# Critique — Search surface (frontend/src/pages/SearchPage.tsx + components/search/)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Refetch dims real prices to opacity-60; result count has no aria-live |
| 2 | Match System / Real World | 3 | Filter axis is "Price (USD)" while rows show native-currency printed prices |
| 3 | User Control and Freedom | 3 | Bulk delete has a pre-confirm but no undo |
| 4 | Consistency and Standards | 2 | Uppercase micro-labels leak past the One Uppercase Rule in 6 places |
| 5 | Error Prevention | 3 | Backwards range blocked inline; A–Z offers 27 letters with no availability data |
| 6 | Recognition Rather Than Recall | 2 | Sort is invisible when the filter panel is collapsed |
| 7 | Flexibility and Efficiency | 2 | Zero keyboard route on the signature surface |
| 8 | Aesthetic and Minimalist | 3 | Clean, minus a nested card + resting shadow on mobile |
| 9 | Error Recovery | 3 | Query failure is bare red text, no Retry |
| 10 | Help and Documentation | 3 | Strong provenance copy; nothing explains the ≈ price model |
| **Total** | | **26/40** | **Acceptable — real improvements needed** |

## Anti-Patterns Verdict

Not AI slop. Reads as an opinionated tool; comments encode real decisions (why lg not md, why the name isn't a link). AI path is demoted to a filter interpreter with removable chips.

Pause point: mobile results card carries shadow-card at rest inside the page <Card> (ResultsTable.tsx:177) — Flat-At-Rest and card-nesting violated at once, on the surface DESIGN.md calls non-negotiable.

Deterministic scan: exit 2, 2 findings. design-system-font-size at SearchBox.tsx:154 (text-[10px], ramp bottoms at 11px) — true positive, independently caught by Assessment A. overused-font on Geist in index.html:15 — false positive; Geist is the declared system family. No border-stripe hits; 3px nav rail correctly not flagged.

Visual overlays: none. Dev server live on :5173, but no browser-automation tool exposed this session. Overlay injection, responsive screenshots, and live contrast measurement all skipped. No visual evidence claimed.

## Overall Impression

An honest product with one dishonest pixel. Provenance discipline is everywhere — PubChem data fenced behind "not from brochure", productSearchUrl refusing to fabricate a URL, AI interpretation auditable before trusting rows. Then the price — the number the product exists to deliver — is the one place honesty thins out: an exchange-rate estimate wears the same brand-filled chip as a printed figure, separated by one ≈ glyph.

Biggest opportunity: the page never renders a verdict. PRODUCT.md says Search "ranks a field of suppliers down to a choice." It sorts by price and stops.

## What's Working

1. The AI never produces data. LLM emits filters; the same GET /search returns rows; pagination and sort identical. Enforced on both sides of the wire, with removable chips.
2. Row-as-target carried all the way through. Row clickable, name a real <button> stripped of link styling, propagation stopped on nested controls, styled <Link> restored when no panel exists.
3. .touch-target is real dual-pointer design. 44px via ::after under pointer: coarse only, no layout change, paired with pointer: fine reductions in the A–Z bar.

## Priority Issues

[P0] Duplicate DOM id breaks the review badge for screen readers — ResultsTable.tsx:403-409. Every ReviewBadge uses aria-describedby="review-hint" against id="review-hint"; 15 flagged rows → 15 identical ids, all resolving to the first tooltip. needs_review is the most trust-critical flag on the page. Fix: useId() or review-hint-${listingId}. Command: /impeccable audit

[P0] Approximate and printed prices are visually identical — ResultsTable.tsx:296. A conversion is promoted into the same brand-accent MonoChip a printed price gets; only ≈ distinguishes them, and the explanatory title sits on the secondary line. Quoting an estimate as a supplier's printed price is a commercial error the UI invited. Fix: an approx tone (same geometry, neutral/outline instead of brand fill), a visible "est." label, tooltip moved onto the promoted chip. Command: /impeccable clarify

[P0] Printed prices render unformatted — ResultsTable.tsx:452-455. formatPrice emits raw `${price} ${currency}`, so a column reads 1050 USD / 9.5 USD / 12000 USD. Tabular Rule applied to the font but not the values, while conversions right below are localized. Fix: route printed prices through formatAmount/toLocaleString; fixed-width currency suffix so decimals align. Command: /impeccable polish

[P1] Results are silent to assistive tech — SearchPage.tsx:449-451. Count changes every debounce tick with no aria-live; loading conveyed purely by dimming; skeleton is aria-hidden with no role="status". Fix: aria-live="polite" on the count, aria-busy on the container, thin top progress bar instead of opacity-60. Command: /impeccable audit

[P1] Nested card + resting shadow on the mobile results list — ResultsTable.tsx:174-179 inside the page <Card>. Fix: drop shadow-card; below lg render the list without the outer <Card>. Command: /impeccable polish

[P2] Sort is invisible when the panel is collapsed — the filter badge excludes sort and nothing else surfaces it, so a non-default sort silently reorders a price comparison. Fix: append to the results sentence ("15 results matching "ethanol" · price high → low"). Command: /impeccable clarify

## Cognitive Load — 3 of 8 failed (moderate)

Failures: recall between steps (applied filters/sort only inside a collapsed panel); decision points ≤4 (27 equal-weight A–Z targets, no availability signal); state visible without action — worst: SearchPage.tsx:190-197 persists the dirty filter draft to sessionStorage, so returning restores an armed "Apply filters" button and an unexplained gap between shown and staged.

## Persona Red Flags

Alex (power user): no focus shortcut for the search field on this page; Enter with nothing highlighted is a no-op (300ms debounce owns the search); Filters and Ask AI are mouse-only; 15 rows hard-capped server-side with no page-size control; no column-header sorting.

Sam (accessibility): duplicate review-hint id; role="combobox" with no aria-activedescendant and unlabelled role="option" children (keyboard highlight purely visual); role="listbox" containing <li> wrappers and a <p> group header with no presentation/group roles; 27 aria-pressed buttons in a plain group (should be radiogroup with roving tabindex) = 27 tab stops before results; pagination lacks <nav aria-label> and aria-current="page".

Casey (mobile): the clear ✕'s invisible 44px halo extends left over the input, so tapping to place a cursor at the end of a long query wipes it; ReviewBadge's halo overlaps the two-line name button on a 360px card; reaching a price filter is six interactions; the A–Z strip's trailing mask permanently dims the last visible letter, reading as disabled; nothing constrains the expanded filter panel's height, so opening Filters on a phone can push results fully off-screen.

## Minor Observations

Currency detection is prefix string-matching in the view layer (CAD$, RMB fall through). table.tsx retains overflow-x-auto — safe only because the card switch is at lg. text-[10px] in SearchBox is off-scale and uppercase. Page clamping after delete fires during keepPreviousData transitions, so a transient total_pages: 1 can knock a user off page 5. ListingDetailBody renders Purity as "—" while the mobile card omits missing fields — "Omit, don't dash" applied inconsistently. SearchFilters uses a raw <input type="checkbox"> instead of the extracted Checkbox primitive.

## Questions to Consider

1. If the thesis is "ranks a field of suppliers down to a choice," why does the table have no concept of a winner? What would it take for the cheapest credible listing — priced, not needing review, adequate purity — to be visibly the answer rather than merely the first row?
2. The system spent enormous care on prices being monospaced and tabular, then ships them unformatted. Which was the real commitment — the typography, or the comparison?
3. Both panels collapse to protect scroll economy, but the page still opens with a sticky toolbar, a count line, a selection bar, and a card border above row one. On a 360px phone, count those pixels before concluding the collapse was the win.
