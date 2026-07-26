> **SUPERSEDED — historical.** The single source of truth for how this system
> works is [ARCHITECTURE.md](../../ARCHITECTURE.md). Client-facing project proposal (July 2026). Sales document, not a technical reference.

---

# Chemical Brochure Intelligence Platform
### Project Proposal

*Prepared for: [Client Name]*
*Prepared by: [Your Name / Company]*
*Date: 14 July 2026*

---

## 1. Executive summary

Chemical suppliers send you product brochures constantly — as PDFs, often
scanned, and written in whatever language the supplier speaks (Chinese, English,
German, and more). Turning that pile of brochures into something you can
actually *use* — a clean, searchable list of who sells what, at what price and
purity — is slow, manual, and error-prone.

This platform does it automatically. You drop in a folder of brochures; an AI
engine reads each one (in any language), extracts every product with its price,
purity, and CAS number, translates names to English, and files everything into a
single searchable database. Your team can then search for any chemical — even
when different suppliers call it by different trade names — and instantly see
**every supplier that offers it, ranked cheapest-first**.

In short: **it converts a drawer full of PDFs into a live sourcing database, and
helps you find the cheapest reliable supplier for any chemical in seconds.**

---

## 2. The problem today

| Pain point | What it costs you |
|---|---|
| Brochures arrive as scanned PDFs in many languages | Hours of manual reading and translation |
| The same chemical has different trade names per supplier | You miss cheaper options because you can't match them |
| Prices, purities, and CAS numbers live scattered across files | No way to compare suppliers side-by-side |
| Knowledge lives in one person's inbox / spreadsheet | The rest of the team can't self-serve |
| Re-reading the same brochure twice | Duplicated effort and messy data |

The net effect: **you overpay, you miss suppliers, and sourcing decisions depend
on whoever happens to remember the right brochure.**

---

## 3. The solution — what the platform does

```
   Supplier brochures (PDF, any language, scanned or digital)
                          │
                          ▼
            AI extraction + translation engine
                          │
      company · product name (original + English) · CAS ·
              price · currency · purity
                          │
                          ▼
              Clean, deduplicated database
                          │
                          ▼
      Search · filter · compare suppliers · find cheapest
```

You never do data entry. You upload; the platform reads, understands,
translates, de-duplicates, and files. Your team searches.

---

## 4. Key capabilities

### 4.1 Reads any brochure, in any language
- Handles **scanned/image PDFs** (built-in OCR) and digital PDFs.
- Works across languages and scripts — Chinese, English, German, Japanese, etc.
- Every product name is captured **both as printed and translated to English**,
  so search works regardless of the source language.

### 4.2 Extracts structured data automatically
For each product it pulls out: **English name, original name, CAS number, price,
currency, and purity** — and the **supplier's name** (also in original + English).

### 4.3 Understands that "same chemical, different name"
- Matches products by **CAS number first** (the globally unique chemical ID).
- When no CAS is present, it matches on the chemical name with a high-confidence
  fuzzy match, flagging uncertain matches for a human to confirm.
- Result: searching "ethanol" surfaces the supplier who listed it as "乙醇" or
  "Ethyl Alcohol" — you no longer miss cheaper offers hiding under a different
  name.

### 4.4 Compare suppliers and find the cheapest
- Search by chemical **name or CAS number**.
- Filter by **maximum price** and **minimum purity**.
- Sort by **price (low→high / high→low)** or **name (A→Z / Z→A)**.
- Browse alphabetically (A–Z tabs) with fast, paged results.
- The same chemical from **different suppliers is always kept separate**, so you
  see a true side-by-side comparison.

### 4.5 No duplicate work, no duplicate data
- If the **same brochure is uploaded again** (even renamed), the platform
  recognises it instantly and skips it — no wasted processing, no duplicate
  rows.
- Identical product offers from the same supplier are never duplicated.

### 4.6 Team-ready with roles
- **Admin** — full control: upload, search, and manage users.
- **Manager** — can upload brochures and search.
- **Viewer** — can search and compare (read-only).
- Admins manage everyone's access from an in-app **Users** page.

### 4.7 A smooth, transparent upload experience
- Upload a whole **folder** or individual PDFs at once.
- Each file shows its **own live progress** and status.
- Full **per-file control**: pause, resume, cancel, restart, or remove any file.
- The queue **survives a page reload** — close the tab, come back, it's still
  going.

### 4.8 Private and secure by design
- The **original PDF is never stored** — it's read in memory and discarded.
- Access is protected end-to-end (verified logins, role checks on every action,
  locked-down data access).
- Upload endpoint is rate-limited and validates that files are genuine PDFs.

---

## 5. Use cases — what your team can actually do

**"Find me the cheapest supplier for Acetone (CAS 67-64-1)."**
→ Search the CAS number, sort cheapest-first, done. Every supplier, one screen.

**"A supplier sent a Chinese price list — get it into the system."**
→ Drop the PDF in. It's read, translated, and searchable in under a minute.

**"Which suppliers can do ≥ 99.5% purity under $60?"**
→ Set the purity and price filters; get the qualifying suppliers instantly.

**"Onboard our new procurement assistant."**
→ Give them a Viewer login. They can search and compare, but can't change data.

**"We got 200 brochures at a trade show."**
→ Select the whole folder; the platform processes them one-by-one with live
progress while your team keeps working.

**"Is this the same chemical two suppliers are quoting?"**
→ Both listings link to the same canonical chemical, so you know they're
comparable — and you see both prices next to each other.

---

## 6. Benefits — how it helps you

| Benefit | Impact |
|---|---|
| **Buy cheaper** | You see *every* supplier for a chemical, ranked by price — including ones hiding under different names or languages. |
| **Save hours** | Zero manual data entry or translation; a brochure becomes searchable data automatically. |
| **Never lose a supplier** | Every brochure becomes permanent, searchable institutional knowledge — not a forgotten email attachment. |
| **Decide with confidence** | Clean, deduplicated, side-by-side data instead of scattered PDFs. |
| **Scale the team** | Anyone with a Viewer login can self-serve; sourcing no longer bottlenecks on one person. |
| **Stay tidy** | Duplicate brochures and duplicate rows are prevented automatically. |

---

## 7. How it works (in plain terms)

1. **Upload** — an Admin or Manager selects a folder of brochures.
2. **Read & translate** — each PDF is sent to the AI engine (with OCR for scans),
   which extracts the company and every product, translating names to English.
3. **Match & de-duplicate** — each product is matched to a canonical chemical
   (by CAS, then by name), and identical re-uploads are skipped.
4. **Store** — everything lands in a clean database; the original PDF is
   discarded.
5. **Search & compare** — anyone on the team searches and finds the best
   supplier.

---

## 8. Security & data handling

- **Original brochures are never kept.** They are processed in memory and thrown
  away — only the extracted data is stored.
- **Role-based access** is enforced on the server for every action, not just
  hidden in the interface.
- **Data access is locked down** at the database level (row-level security), and
  the interface can only talk to your own backend (no open access).
- **Uploads are validated** (real-PDF check, size cap) and **rate-limited** to
  protect against abuse and runaway AI costs.

---

## 9. Current status

The platform is **built and working end-to-end**:

- ✅ AI extraction with multi-language OCR (Qwen configured; Gemini and Claude
  also supported — switchable).
- ✅ Search, filter, sort, alphabetical browsing, and pagination.
- ✅ CAS-first chemical de-duplication with human review flags.
- ✅ Duplicate-brochure prevention and bilingual company names.
- ✅ Roles + in-app user management.
- ✅ Reload-safe upload queue with per-file progress and controls.
- ✅ Security pass (auth, role checks, data-access rules, rate limiting).

It is ready for real-world piloting with your brochures.

---

## 10. What can be improved — roadmap

These are natural next steps, roughly in order of business value. None are
required for day-to-day use today; they extend the platform's reach.

### High value, near-term
- **Currency normalisation** — convert every price to one currency (e.g. USD)
  using live rates, so "cheapest" is a true apples-to-apples comparison across
  suppliers quoting in CNY, EUR, etc.
- **Unit / packaging normalisation** — capture and compare price *per kg / per
  tonne*, so a "$55" and a "$55/25kg drum" don't look the same.
- **Export to Excel / CSV** — one-click export of any search result for offline
  sharing, quoting, or reporting.
- **Review queue UI** — a dedicated screen to confirm or reject the AI's
  "needs review" fuzzy matches, keeping the database pristine over time.

### Medium-term
- **Price history & trends** — track how each supplier's price for a chemical
  moves over time; spot the best moment to buy.
- **Supplier / contact management** — the platform already has fields for
  supplier phone and email; a light CRM view would let you contact the best
  supplier directly from a search result.
- **Email-in ingestion** — forward a brochure to a dedicated inbox and have it
  processed automatically, no manual upload.
- **Favourites, tags & notes** — let buyers bookmark suppliers and annotate
  listings.
- **Alerts** — notify a buyer when a new, cheaper listing appears for a chemical
  they watch.

### Longer-term
- **Analytics dashboard** — spend insights, supplier coverage, cheapest-source
  summaries.
- **ERP / procurement integration** — an API so listings flow into your existing
  purchasing systems.
- **Bulk actions & re-processing** — re-run older brochures through improved
  extraction as the engine gets smarter.
- **Mobile-friendly / app** — search suppliers from your phone at trade shows.

### Quality & accuracy (ongoing)
- Tune the AI extraction prompts against *your* real brochures to maximise
  accuracy on your suppliers' formats.
- Periodically review the fuzzy-match settings as the chemical catalogue grows.

---

## 11. Why this approach

- **Language-agnostic by design** — every name is normalised to English, so the
  system never has to "guess" the source language and search always works.
- **CAS-first accuracy** — chemical identity is anchored to the globally unique
  CAS number, the same standard the industry already trusts.
- **Provider-flexible AI** — not locked to one AI vendor; the extraction engine
  can switch between providers for cost, accuracy, or availability.
- **Built for a team, not a spreadsheet** — roles, security, and a shared
  database from day one.

---

## 12. Appendix — technology (for your technical reviewers)

- **Frontend:** React + TypeScript (fast, modern web app).
- **Backend:** FastAPI (Python) — handles extraction, de-duplication, search,
  and security.
- **Database & auth:** Supabase (PostgreSQL) with row-level security.
- **AI extraction:** pluggable — Qwen (vision + OCR), Google Gemini, or
  Anthropic Claude.
- **Data model:** canonical `chemicals`, `companies` (bilingual), and supplier
  `listings`, with a document ledger for duplicate detection.

*Detailed engineering notes live in `README.md` and `CHANGES.md`.*

---

### Next steps

1. **Pilot** — run a batch of your real brochures through the platform and
   review the extracted data together.
2. **Tune** — adjust extraction for your suppliers' formats and confirm the
   priorities from the roadmap in Section 10.
3. **Roll out** — set up your team's logins and go live.

*We'd be glad to walk through a live demo with your own brochures whenever
you're ready.*
