# Offline Desktop App — Migration Plan

## Goal

Package BrochureDB as a single double-click executable (.exe / .app / AppImage)
that runs fully offline — no Supabase, no cloud DB, no internet required
(except for AI API calls during extraction).

Target: 1-3 non-technical users on Windows, Mac, or Linux.

---

## Current Supabase dependencies (what needs replacing)

### 1. Database — `database.py` (1826 lines, ~65 functions)
- Every query uses `get_client().table("...").select/insert/update/delete`
- PostgREST-style query builder (`.eq()`, `.ilike()`, `.order()`, `.range()`)
- Tables: `chemicals`, `listings`, `companies`, `documents`, `pages`,
  `profiles`, `audit_log`, `app_settings`, `settings_audit`,
  `chemical_embeddings`, `substitution_notes`, `regulatory_notes`

### 2. Auth — frontend `useAuth.tsx` + backend `dependencies.py`
- Frontend: `supabase.auth.signInWithPassword`, `signUp`, `signOut`,
  `resetPasswordForEmail`, `onAuthStateChange`
- Backend: JWT verification (HS256/ES256), `require_user`, `require_admin`,
  `require_uploader` dependencies
- User management: `list_users_with_roles`, `set_user_role`

### 3. File Storage — `pipeline_db.py`
- Bucket: `brochure-pages`
- Operations: `upload`, `download`, `remove`, `list`, `create_signed_url`
- Stores: source PDFs + page PNG images

### 4. Other files touching Supabase
- `app_settings.py` — reads/writes `app_settings` table
- `embeddings.py` — `chemical_embeddings` table
- `pipeline_db.py` — documents/pages tables + storage
- `splitter.py` — uses pipeline_db storage
- `extraction.py` — uses pipeline_db storage
- `agent_tools.py` — queries chemicals/listings
- `rates.py` — queries for rate conversion data

---

## Architecture: what replaces what

| Supabase | Offline replacement | Notes |
|---|---|---|
| Postgres (via PostgREST) | **SQLite** via SQLAlchemy | Single file `data/brochuredb.sqlite` next to the exe |
| Supabase Auth | **Local auth** — bcrypt passwords in SQLite `users` table, session tokens issued by FastAPI | No email verification, no password reset email (admin resets directly) |
| Supabase Storage | **Local filesystem** — `data/storage/` directory | Same path structure: `{doc_id}/source.pdf`, `{doc_id}/page-001.png` |
| Supabase JS client (frontend) | **Backend auth endpoints** — `/auth/login`, `/auth/logout`, `/auth/me` | Frontend stores JWT in localStorage, same `Authorization: Bearer` pattern |

---

## Implementation phases

### Phase 1: SQLite database layer
**Files: new `backend/app/services/local_db.py`, new `backend/app/models.py`**

1. Define SQLAlchemy models for all tables:
   - `users` (id, email, password_hash, role, created_at)
   - `chemicals` (id, name_en, cas_number, created_at)
   - `companies` (id, name, aliases, country, website, ...)
   - `listings` (id, chemical_id, company_id, product_name, price, ...)
   - `documents` (id, content_hash, filename, status, ...)
   - `pages` (id, document_id, page_number, status, ...)
   - `audit_log` (id, actor, action, details, created_at)
   - `app_settings` (key PK, value, is_secret, category, ...)
   - `settings_audit` (id, setting_key, old_value, new_value, ...)
   - `chemical_embeddings` (chemical_id, embedding, source_text)
   - `substitution_notes`, `regulatory_notes`

2. Create a `LocalDatabase` class that mirrors every function in
   `database.py` but uses SQLAlchemy sessions instead of PostgREST.
   The function signatures stay identical so routers don't change.

3. Database file: `data/brochuredb.sqlite` — auto-created on first run
   with all tables + a default admin user.

**Estimated scope:** ~800 lines (models + query rewrites).
This is the biggest piece — 65 functions to port.

### Phase 2: Local file storage
**Files: new `backend/app/services/local_storage.py`**

Replace Supabase Storage with filesystem operations:

```
data/storage/
  {document_id}/
    source.pdf
    page-001.png
    page-002.png
    ...
```

Functions to implement (same signatures as pipeline_db storage calls):
- `upload_file(bucket, path, data, content_type)` → write to disk
- `download_file(bucket, path)` → read from disk
- `remove_files(bucket, paths)` → delete from disk
- `list_files(bucket, prefix)` → `os.listdir`
- `create_signed_url(bucket, path, expires)` → return a local `/files/{path}` URL

Add a `/files/{path:path}` endpoint in FastAPI to serve stored files
(replaces Supabase signed URLs).

**Estimated scope:** ~100 lines.

### Phase 3: Local auth
**Files: new `backend/app/routers/auth.py`, modify `backend/app/dependencies.py`,
modify `frontend/src/hooks/useAuth.tsx`, modify `frontend/src/lib/supabaseClient.ts`**

Backend:
- `POST /auth/login` — email + password → bcrypt verify → issue JWT
- `POST /auth/logout` — (client-side only, just drop the token)
- `GET /auth/me` — return current user from JWT
- `POST /auth/setup` — first-run: create admin account (shown only when
  no users exist)
- JWT issued with same `sub` claim, verified with a local secret

Frontend:
- Replace `supabaseClient.ts` with a simple API auth client
- `useAuth.tsx` — call backend `/auth/login` instead of `supabase.auth`
- `LoginPage.tsx` — minor: point form at backend auth
- Remove `@supabase/supabase-js` dependency entirely
- Remove `ResetPasswordPage.tsx` (admin resets passwords directly via
  the Users page)

**Estimated scope:** ~200 lines backend, ~100 lines frontend.

### Phase 4: Wire it together
**Files: modify `backend/app/config.py`, `backend/app/main.py`**

- Add a `STORAGE_MODE` config: `"local"` (default for desktop) or
  `"supabase"` (for cloud deploy)
- At startup, auto-detect: if no `SUPABASE_URL` is set, use local mode
- Create `data/` directory structure on first run
- Seed default admin user on first run (prompt shown in browser)
- Serve the built frontend static files from FastAPI (`/` serves
  `frontend/dist/index.html`)

### Phase 5: PyInstaller packaging
**Files: new `brochuredb.spec` (PyInstaller config), new `scripts/build.py`**

1. **Startup script** (`backend/app/desktop.py`):
   - Creates `data/` directory if missing
   - Initializes SQLite DB + default tables
   - Starts uvicorn (API) in a thread
   - Starts 1 worker in a thread
   - Starts reconciler in a thread
   - Opens default browser to `http://localhost:8000`
   - Tray icon (optional, via `pystray`) to show status / quit

2. **Build the frontend**: `cd frontend && npm run build`
   - Output goes to `frontend/dist/`
   - Included in the PyInstaller bundle as data files

3. **PyInstaller spec**:
   - Entry point: `backend/app/desktop.py`
   - Include: `frontend/dist/` as data
   - Include: SQLite (bundled with Python)
   - One-file mode (`--onefile`) for simplest distribution
   - Icon: app logo

4. **Build on each platform** (or via GitHub Actions CI):
   - Windows: produces `BrochureDB.exe`
   - macOS: produces `BrochureDB.app`
   - Linux: produces `BrochureDB` (AppImage or plain binary)

### Phase 6: First-run experience
When the exe launches and no `data/brochuredb.sqlite` exists:

1. Browser opens to `http://localhost:8000`
2. App detects no users → shows a **Setup** page
3. Admin enters their email + password → first admin account created
4. Redirected to the dashboard, ready to use

---

## What stays the same

- All routers (`upload.py`, `listings.py`, `search.py`, etc.) — they
  call `database.xyz()` functions which keep the same signatures
- All extraction logic (`page_extract.py`, `ocr.py`, `extraction.py`)
- All AI provider integrations (Qwen, GPT, Claude, Gemini)
- The entire React frontend (components, pages, styling)
- The admin settings UI we just built
- The worker + reconciler logic

## What gets removed

- `supabase` Python package dependency
- `@supabase/supabase-js` npm dependency
- `supabaseClient.ts`
- `ResetPasswordPage.tsx` (replaced by admin password reset)
- All `SUPABASE_*` env vars (for desktop mode)

---

## File change summary

| Action | Files | Lines (est.) |
|---|---|---|
| **New** | `models.py`, `local_db.py` | ~800 |
| **New** | `local_storage.py` | ~100 |
| **New** | `routers/auth.py` | ~120 |
| **New** | `desktop.py` (startup/packaging entry) | ~80 |
| **New** | `brochuredb.spec` (PyInstaller) | ~40 |
| **Modify** | `dependencies.py` (local JWT verify) | ~30 |
| **Modify** | `config.py` (local mode detection) | ~20 |
| **Modify** | `main.py` (static files, auth router) | ~30 |
| **Modify** | `pipeline_db.py` (swap storage calls) | ~50 |
| **Modify** | `useAuth.tsx` (backend auth) | ~60 |
| **Modify** | `supabaseClient.ts` → delete | -15 |
| **Modify** | `LoginPage.tsx` (minor) | ~10 |
| **Total** | ~15 files | ~1300 new/changed lines |

---

## Order of work

```
Phase 1  ██████████████████  SQLite + SQLAlchemy models/queries  (biggest)
Phase 2  ████                Local file storage
Phase 3  ██████              Local auth (backend + frontend)
Phase 4  ███                 Wire together + static file serving
Phase 5  █████               PyInstaller packaging + desktop.py
Phase 6  ██                  First-run setup page
```

Phases 1-4 can be tested with `python -m app.desktop` before PyInstaller.
Phase 5 produces the actual exe. Phase 6 is polish.

---

## Risk / open questions

1. **SQLite concurrency** — SQLite handles one writer at a time. With 1
   worker + 1 API + 1 reconciler this is fine (WAL mode handles it), but
   won't scale past ~5 concurrent writers. Fine for 1-3 users.

2. **pgvector → SQLite** — the `chemical_embeddings` table uses
   `vector(1024)` and `<=>` cosine distance. SQLite doesn't have this.
   Options:
   - **sqlite-vec** extension (lightweight, works with PyInstaller)
   - Compute cosine similarity in Python (slower but zero dependencies)
   - Skip embeddings in desktop mode (degrade to name matching)

3. **PDF size** — source PDFs + page images stored locally can grow.
   A `data/` folder with 100 brochures ≈ 2-5 GB. Fine for a desktop.

4. **Auto-updates** — the exe won't self-update. Client downloads a new
   version manually, or we add a simple version-check on startup that
   pings a URL (optional, needs internet).

5. **Backups** — `data/brochuredb.sqlite` + `data/storage/` is
   everything. Client can copy this folder to back up.
