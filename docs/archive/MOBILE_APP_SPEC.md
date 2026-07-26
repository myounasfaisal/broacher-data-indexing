> **SUPERSEDED — historical.** The single source of truth for how this system
> works is [ARCHITECTURE.md](../../ARCHITECTURE.md). Spec for a mobile version that was never built.

---

# Chemical Brochure Scanner — Mobile App Specification

**Product handoff document for the implementing developer.**
Version 1.0 · Prepared 2026-07-18

---

## 1. What this document is

This is the build spec for the **mobile version** of an existing, working
product: the **Chemical Brochure Extraction Platform**. Today the platform is a
web app where an admin uploads scanned brochure **PDFs** and an AI model
extracts structured product data (chemical names, CAS numbers, prices, purity,
supplier, etc.) into a searchable database.

The mobile app keeps that entire product intact, but changes **one thing at the
front of the workflow**:

> Instead of uploading a pre-scanned PDF from a computer, the user **scans the
> brochure pages with the phone camera**, taps **Process**, and the captured
> images are sent to the backend/LLM for extraction — **while the user
> immediately starts scanning the next brochure**. Extraction runs in the
> background; results flow into the same database and the same search/browse
> experience that already exists on the web.

The goal is a **complete, store-ready product** (Apple App Store + Google Play),
built in **React Native** so a single codebase ships **iOS, Android, and Web**.

**The developer receiving this doc does not need the web app's source to start.**
Section 9 documents the existing backend API contract the app talks to. Where
the mobile app needs a *new* backend endpoint, it is called out explicitly in
Section 10.

---

## 2. The product in one paragraph

Chemical suppliers publish product brochures (often scanned, often not in
English). Buyers waste hours reading them to compare who sells a given chemical
cheapest — especially when the same substance appears under different trade
names. This platform ingests those brochures with AI, normalizes the products
(CAS-number-first matching, currency conversion, deduplication), and gives a
fast search/filter/AI-search experience over the combined catalogue. The mobile
app puts the **capture** step in the field: scan a brochure at a trade show, a
supplier's office, or from a paper catalogue on your desk, and it's in the
searchable database minutes later.

---

## 3. Users & roles

The backend already enforces a **3-tier role model**. The mobile app must
respect it exactly:

| Role | Can search/browse | Can scan & process brochures | Can manage users |
|---|---|---|---|
| **Admin** | ✅ | ✅ | ✅ |
| **Manager** | ✅ | ✅ | ❌ |
| **Viewer** | ✅ | ❌ | ❌ |

- New sign-ups default to **viewer**. Role changes are admin-only.
- The app must **gate UI by role** (hide the Scan tab and admin screens for
  viewers), but never rely on that alone — the backend re-checks every request.

---

## 4. Core mobile workflow (the headline feature)

This is the flow that differs from the web app. Read it carefully — it is the
heart of the mobile product.

### 4.1 Capture a brochure
1. User opens the **Scan** tab and taps **New Brochure**.
2. Camera opens in a **document-scanner** mode: edge detection, auto-capture,
   perspective correction, and a review/crop step per page (see Section 6.1).
3. User captures **page after page** of one brochure. Each captured page becomes
   a cropped, enhanced image held in a local "draft brochure".
4. User can reorder pages, retake a page, delete a page, or add more pages.
5. User taps **Process**.

### 4.2 Process (async) — the key behaviour
- On **Process**, the draft's page images are **queued for upload + extraction**
  and the draft becomes a **job** with live status.
- **Immediately** the user is returned to a clean capture screen and can **start
  scanning the next brochure**. They do **not** wait for the LLM.
- Upload + extraction happen in the **background**:
  - images upload (resumable if the network drops),
  - the backend runs the existing AI extraction pipeline,
  - the job advances through stages the user can watch: `Queued → Uploading →
    Extracting → Saving → Done` (or `Needs review` / `Failed`).
- When a job finishes, the user gets a **push/local notification** and the
  results appear in the **Jobs** list and in **Search**.

### 4.3 Multiple brochures in flight
- The user may have several brochures queued at once. The **Jobs** screen shows
  all of them with per-job progress, and lets the user **retry**, **cancel**, or
  **undo** (delete the listings a completed job produced).
- This mirrors the existing web **upload job queue** semantics (Section 9.4) —
  the mobile app is a client of the same queue model, plus a new image-based
  intake.

> **Design intent:** capture is fast and interactive; extraction is slow and
> invisible. Never block the camera on the network or the model.

### 4.4 Also supported: upload an existing PDF
Keep the web app's original path available on mobile too: let the user pick a
**PDF from the device / cloud files** and submit it to the same queue. This
covers cases where someone already has the digital brochure. (Camera scan is the
primary, marquee flow; PDF pick is the secondary convenience flow.)

---

## 5. Full feature list

### 5.1 Authentication & account (all roles)
- Email/password **sign in**, **sign up**, **forgot password / reset** (backed by
  Supabase Auth — the web app already uses these flows).
- Persistent session with secure token storage (Keychain / Keystore).
- Biometric app-lock (Face ID / fingerprint) as an optional setting.
- Sign out; show current role and email in a Profile screen.

### 5.2 Brochure capture & processing (admin/manager)
- Multi-page **document scanner** with auto edge detection, auto-capture, manual
  shutter fallback, torch/flash toggle.
- Per-page **crop, rotate, retake, delete, reorder**.
- Image **enhancement** for OCR legibility (grayscale/contrast/deskew filters).
- **Draft brochures** saved locally so an interrupted capture isn't lost.
- **Process** → background job; continue scanning immediately.
- **Jobs** screen: live status per job, pause/resume/cancel/restart/remove,
  and **undo** a completed upload.
- **Upload/scan history** (your own; admins see everyone's) with date-range
  filters (week/month/year/all) and pagination.
- **PDF pick** intake as an alternative to the camera.

### 5.3 Search & browse (all roles)
- Free-text **search** by chemical name or CAS number with typeahead
  suggestions.
- **AI search bar**: type a plain-language request ("cheapest ethanol above 99%
  purity") — the backend LLM converts it into structured filters (it never
  invents data). Show the interpreted filters as removable chips.
- **Filters**: CAS number, price range (in USD), purity range, priced-only
  toggle, supplier, A–Z alphabet filter.
- **Sorting**: name A–Z / Z–A, price low→high / high→low.
- Paginated results (server-paged).
- **Product detail** screen: all extracted attributes, supplier + supplier
  website link, price/purity, a "reference data (not from brochure)" section
  when PubChem enrichment is present, and a "find this product online" link.
- A **"needs review"** badge on low-confidence records.

### 5.4 Admin
- **Dashboard**: summary counts (listings, companies, recent uploads, items
  needing review).
- **User management**: list users, change roles.
- **Listing edit/delete**: correct or remove an individual extracted listing.
- **Audit view** of all uploads across users.

### 5.5 Cross-cutting
- **Light/dark theme** (system-aware) — the web app already ships a full design
  system; mirror its tokens (deep-teal accent, cool neutrals, mono chips for
  CAS/price).
- **Offline resilience**: drafts and the job queue survive app restarts and
  network loss; uploads resume.
- **Localization-ready** (brochures are multilingual; the UI should be
  i18n-structured even if v1 ships English only).
- **Push notifications** for job completion.

---

## 6. Platform, stack & architecture

### 6.1 Framework
- **React Native** targeting **iOS, Android, and Web** from one codebase.
- Recommended: **Expo** (managed workflow with dev/config plugins) unless a
  required native module forces bare RN. Expo gives OTA updates, EAS Build, and
  an easier store-submission path — good for a store-listed product.
- **TypeScript** throughout (the existing frontend is TS; keep types shared in
  spirit — see Section 9's data shapes).

### 6.2 Key native capabilities & suggested libraries
> Exact library choices are the implementer's call; these are proven options.

| Need | Suggested approach |
|---|---|
| Document scanning | `react-native-vision-camera` + a document-scanner (VisionCamera frame processor, `react-native-document-scanner-plugin`, or ML Kit doc scanner). On **Web**, fall back to file/camera input + manual crop. |
| Image crop/rotate/enhance | `react-native-image-crop-picker` / custom crop UI + an image filter lib. |
| PDF pick | `expo-document-picker` / `react-native-document-picker`. |
| Background upload | `expo-task-manager` + `expo-background-task`, or `react-native-background-upload`, for resumable uploads that survive backgrounding. |
| Secure token storage | `expo-secure-store` / Keychain / Keystore. |
| Push/local notifications | `expo-notifications`. |
| Data fetching/cache | **TanStack Query (react-query)** — the web app already uses it; same patterns (polling job status, invalidation on queue idle). |
| Navigation | `expo-router` or React Navigation (tabs + stacks). |
| Auth | `@supabase/supabase-js` (same Supabase project as the web app). |
| State for drafts/queue | Local persistent store (MMKV / SQLite / AsyncStorage) for offline drafts. |

### 6.3 App structure (suggested)
```
Tabs:
  ┌ Search        (all roles)      – search, AI search, filters, results
  ┌ Scan          (admin/manager)  – camera → draft → Process
  ┌ Jobs          (admin/manager)  – live extraction queue + history
  ┌ Admin         (admin only)     – dashboard, users, audit
  └ Profile       (all roles)      – account, theme, app-lock, sign out
Stacks:
  Product Detail, Draft Editor (page review/reorder), Listing Edit,
  Auth (sign in / sign up / reset), Onboarding/Permissions
```

---

## 7. Client-side capture pipeline (detail)

Because capture quality drives extraction quality, treat this as a first-class
subsystem:

1. **Detect & auto-capture** page edges; give haptic feedback on capture.
2. **Perspective-correct** to a flat rectangle.
3. **Enhance** for OCR (contrast/threshold, deskew). Keep a color original too.
4. **Compress** sensibly — target legible text at a reasonable file size
   (e.g. long-edge ~2000px, JPEG quality tuned). Big enough for OCR, small
   enough to upload on mobile data.
5. **Assemble** the ordered page set into the draft.
6. On **Process**, either:
   - upload the page **images** to the new mobile intake endpoint (Section 10),
     **or**
   - assemble the images into a **PDF on-device** and submit to the existing
     `/upload-jobs` endpoint (Section 9.4).

   **Recommendation:** send images to a new `/scan-jobs` endpoint and let the
   backend render/OCR them — it keeps page-image handling server-side where the
   existing OCR/vision pipeline already lives, and avoids shipping a PDF
   generator + heavy pages to the device. Decide with the backend owner
   (Section 10).

---

## 8. Non-functional requirements

- **Performance:** camera preview stays smooth; Process returns to capture in
  well under a second. Search results and typeahead feel instant.
- **Reliability:** no data loss on crash/kill — drafts and jobs persist. Uploads
  are resumable/idempotent (the backend already deduplicates identical content).
- **Security & privacy:**
  - All traffic over HTTPS; JWT (Supabase) auth on every request.
  - Tokens in secure storage; optional biometric lock.
  - Captured images are **transient** — the backend processes brochures in
    memory and does **not** store the original file. The app should delete local
    page images once a job reports `Done` (respect this "don't retain the source"
    principle end-to-end).
  - Ask for camera/notification permissions with clear rationale screens.
- **Accessibility:** dynamic type, sufficient contrast (light & dark), screen-
  reader labels on controls.
- **Store compliance:** privacy policy + data-safety/privacy-nutrition-label
  disclosures, permission usage strings (`NSCameraUsageDescription`, etc.),
  account-deletion path (Apple requirement for apps with accounts).
- **Observability:** crash reporting (e.g. Sentry) and basic analytics on the
  capture→process funnel.

---

## 9. Existing backend API (contract the app consumes)

The backend is **FastAPI**, auth via **Supabase JWT** (send
`Authorization: Bearer <access_token>` on every call). Base URL is
environment-configured. All list endpoints are server-paginated. Errors:
`401` unauth, `403` wrong role, `413/415` bad upload, `409` duplicate edit,
`503` datastore unavailable, `429` rate-limited.

### 9.1 Health
- `GET /health` → `{ "status": "ok" }`

### 9.2 Auth
- Handled by **Supabase Auth** via `@supabase/supabase-js` (sign in / sign up /
  reset password / session refresh). The app gets a JWT from Supabase and sends
  it to the FastAPI backend. Reset-password redirect URLs must be allowlisted in
  the Supabase dashboard for the mobile scheme/domain.

### 9.3 Search & product (all roles)
- `GET /search` — query params: `q`, `cas`, `letter` (A–Z), `min_price`,
  `max_price` (USD), `min_purity`, `max_purity`, `priced_only`, `details_q`,
  `sort` (`name_asc|name_desc|price_asc|price_desc`), `page`. Returns
  `{ results, count, page, total_pages }`.
- `POST /search/ai` — body: `{ "query": "<plain-language sentence>" }`. The LLM
  parses it into filters; rows come from the same search path. Returns results
  **plus the interpreted filters** (render as chips). Rate-limited (~20/min).
- `GET /suggest?q=&limit=` — typeahead: chemical name/CAS suggestions + a few
  matching suppliers with counts.
- `GET /listings/{listing_id}` — full product detail.

### 9.4 Upload / job queue (admin/manager)
Server-side job queue; the app enqueues, then **polls** for status (react-query,
~1.5s while jobs are active). Queue state is server-side, so it survives client
restarts.
- `POST /upload-jobs` — multipart PDF (`file`). Validates type/size/magic bytes.
  Returns the created job (`202`). Rate-limited (~120/min).
- `GET /upload-jobs` — the caller's jobs with per-job `stage` text (drives the
  progress UI; also restores the queue on app relaunch).
- `POST /upload-jobs/{job_id}/action` — body `{ "action": "pause|resume|cancel|
  restart|remove" }`.
- `POST /upload-jobs/clear-finished` — remove the caller's done/failed jobs.

### 9.5 Upload history & undo
- `GET /uploads/history?range=week|month|year|all&page=&page_size=` — caller's
  own uploads.
- `GET /uploads/history/all?...` — **admin** audit of all uploads (includes
  uploader email).
- `GET /uploads/{content_hash}/listings` — the listings a given upload produced
  (admin = any; manager = own).
- `DELETE /uploads/{content_hash}` — **undo** an upload (deletes the listings it
  produced, except any shared with another upload; removes the ledger row so the
  same brochure can be re-processed).

### 9.6 Admin
- `GET /admin/dashboard/summary` — counts (listings, companies, recent uploads,
  needs-review). *(admin + manager)*
- `GET /users` — list users. *(admin)*
- `PATCH /users/{user_id}/role` — change a user's role (can't change your own).
  *(admin)*
- `PATCH /listings/{listing_id}` / `DELETE /listings/{listing_id}` — correct or
  remove a listing (recomputes dedup/price; `409` on collision). *(admin)*

### 9.7 Data shapes (essentials)
A **listing** (product) carries at least: chemical name (and English/normalized
name), **CAS number**, **supplier/company** (bilingual name + website), **price**
(original currency + normalized USD), **purity**, a flexible `details` object of
any other printed attributes, a `needs_review` flag, and optional PubChem
`reference_data` (explicitly labelled *not from the brochure*). The app should
render `details` **dynamically** (humanize keys, drop empties) rather than
assume a fixed schema — the web app does exactly this.

---

## 10. New backend work required for mobile (call out to backend owner)

The current intake accepts **PDF only** (`/upload-jobs`). The mobile scan flow
produces **ordered page images**. Two options — **agree one with the backend
owner before starting**:

**Option A (recommended): new image-intake endpoint.**
- `POST /scan-jobs` — multipart with N ordered page images (+ optional client
  draft id for idempotency). Backend assembles/renders them and runs the
  **existing** OCR + extraction + dedup pipeline, producing the same listings.
- Reuse the existing job model, `GET /upload-jobs`-style status, history, and
  undo. Ideally the mobile scan jobs appear in the **same** job/history views so
  there's one queue.
- Add **resumable/chunked upload** support (mobile networks) and return early
  with a job id so the client can return to the camera immediately.

**Option B: client builds a PDF, reuses `/upload-jobs`.**
- No backend change, but pushes PDF assembly + larger uploads onto the device
  and loses per-image server handling. Acceptable as a v1 shortcut.

**Also likely needed for mobile:**
- **Push notification** delivery on job completion (device token registration +
  a notify hook when a job reaches `Done/Needs review/Failed`), or rely on
  client-side local notifications driven by status polling for v1.
- Confirm **CORS / allowed origins** and Supabase **redirect URLs** include the
  mobile web build's origin and the app's deep-link scheme.
- Confirm **max upload size** and per-image limits for the scan endpoint.

---

## 11. Suggested delivery milestones

1. **Foundation** — RN + TS project, navigation, Supabase auth (sign in/up/
   reset), secure session, role gating, theming (light/dark), API client with
   JWT.
2. **Search parity** — search, typeahead, filters, sort, pagination, product
   detail, AI search with filter chips. *(ships value to viewers immediately)*
3. **Capture** — document scanner, per-page edit/reorder, local drafts,
   on-device enhancement.
4. **Process & jobs** — background upload, job queue UI, status polling,
   notifications, history, undo. (Depends on Section 10 endpoint decision.)
5. **Admin** — dashboard, user management, listing edit/delete, audit.
6. **Store-ready** — offline resilience, permissions/privacy screens, account
   deletion, crash reporting, app icons/splash, store listings, privacy policy,
   data-safety labels, beta (TestFlight / Play internal testing), submission.

---

## 12. Definition of done

- One React Native codebase produces working **iOS**, **Android**, and **Web**
  builds.
- A manager can **scan a multi-page brochure, tap Process, immediately scan
  another**, and see both brochures' products in **Search** after background
  extraction — with completion notifications.
- All existing web capabilities (search, AI search, filters, product detail,
  history, undo, admin dashboard, user & listing management) are present and
  role-gated on mobile.
- Sessions, drafts, and jobs survive app restart and network loss; uploads are
  resumable; captured images are removed from the device after a job completes.
- Apps pass store review (permissions strings, privacy policy, data-safety
  labels, account deletion) and are submitted to the App Store and Google Play.

---

### Appendix A — Glossary
- **Brochure**: a supplier's product catalogue (often scanned, multilingual).
- **Listing**: one extracted product row (name, CAS, supplier, price, purity, …).
- **CAS number**: a globally unique chemical identifier; the system matches
  products **CAS-first** so the same substance under different trade names
  merges correctly.
- **Extraction pipeline**: the backend AI flow (OCR for scanned pages → LLM →
  structured JSON → validation → dedup → database). The mobile app **triggers**
  it with captured images; it does not reimplement it.
- **Job / queue**: server-side background processing of a submitted brochure with
  observable stages; the client polls it.
- **Needs review**: a low-confidence record flagged for a human to check.
