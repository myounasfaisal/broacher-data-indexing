# DevOps, Explained Simply — Using This Project as the Example

A from-scratch walkthrough of how we put this app on the internet, written to
*teach* the concepts. Every idea is explained in plain words and then tied to
something we actually did with **brochure-indexing-bostech** on the Google VM
at **34.18.9.118**.

Read it top to bottom the first time. Later, use it as a reference.

---

## 0. The big picture first

Your app runs fine on your laptop. "Deployment" just means: **run that same app
on a computer that is always on and reachable from the internet, so other people
can use it.**

That's the whole game. Everything below is just the details of doing it safely
and repeatably.

Our specific situation:

- The app has a **backend** (Python API), **background workers** (do the heavy
  PDF work), a **frontend** (the website users see), and a **database**
  (hosted on Supabase, not on our server).
- We want it reachable at **https://34.18.9.118** for a small internal team.
- The deployment branch now enables the assistant and semantic-search features
  in the backend environment template so those parts are ready for production
  once the provider keys and migrations are present.

Here's the finished shape. Don't worry if it's not clear yet — we build up to it:

```
   Internet
      │  https://34.18.9.118
      ▼
┌─────────────────────────────────────────────┐
│  Google VM (a rented computer, always on)    │
│                                              │
│   ┌── web (nginx) ──┐  serves the website    │
│   │  + HTTPS        │  and forwards /api ───┐ │
│   └─────────────────┘                       │ │
│                                             ▼ │
│   ┌── backend (API) ──┐   ┌── workers ×4 ──┐  │
│   └───────────────────┘   └───────────────┘  │
│   ┌── reconciler ─────┐                       │
│   └───────────────────┘                       │
└─────────────────────────────────────────────┘
      │
      ▼
  Supabase (database, lives elsewhere on the internet)
```

---

## 1. The server: VPS / cloud VM

**Concept.** A **server** is just a computer. A **VPS** (Virtual Private
Server) or **cloud VM** (Virtual Machine) is a computer you *rent* from a
provider (Google, AWS, etc.) that lives in their data center and never turns
off. "Virtual" means it's a slice of a bigger physical machine, but it behaves
like its own computer with its own operating system (we're on Linux).

**Why rent instead of use your laptop?** Your laptop sleeps, moves networks, and
has no fixed address. A cloud VM is always on, always at the same address.

**In our project.** We're on a **Google Cloud (GCP)** VM named
`aitexsolutions-bostech`. It runs Linux. We connect to it and treat it like a
remote Linux computer.

---

## 2. The address: static IP

**Concept.** Every computer on the internet has an **IP address** — like a phone
number (e.g. `34.18.9.118`). By default, cloud providers give your VM a
*temporary* ("ephemeral") IP that can **change** if the machine reboots. A
**static IP** is one you reserve so it **never changes**.

**Why it matters.** If the address changed, every bookmark, DNS record, and
config pointing at the old number would break.

**In our project.** We reserved **34.18.9.118** as a static IP. That's the
permanent front door number for the app.

> **Domain vs IP.** A **domain** (like `app.aitex.com`) is a friendly *name* that
> points to an IP. We don't have one yet, so we use the raw IP. A domain becomes
> important later (see `HOSTING_PLATFORM_PLAN.md`), especially for real HTTPS
> certificates and for n8n webhooks.

---

## 3. Getting in: SSH

**Concept.** **SSH** (Secure Shell) is how you log into a remote computer's
command line securely over the internet. You type commands on your laptop, they
run on the server.

**In our project.** We SSH into the VM and run everything (Docker, git, etc.)
there. The command prompt `younasf69@aitexsolutions-bostech:...$` you keep
seeing means "you are logged into the server."

---

## 4. Two firewalls (this trips everyone up)

**Concept.** A **firewall** decides which network connections are allowed in.
There are **two layers** you must both open:

1. **The cloud firewall** (GCP's own layer, outside the VM). Even if your app
   listens on a port, GCP blocks the internet from reaching it unless you add a
   rule.
2. **The OS firewall** (inside Linux). Usually permissive by default, but it
   exists too.

**Ports.** A **port** is a numbered door on a computer. Web traffic uses:
- **80** = HTTP (insecure web)
- **443** = HTTPS (secure web)

**In our project.** We opened **only 80 and 443** on the GCP firewall. We did
**not** open 8000 (the backend) to the internet on purpose — see §11, the
backend should only be reachable *internally*, never directly from outside.

---

## 5. Docker: the core idea

This is the most important concept, so slow down here.

**The problem Docker solves.** "It works on my machine" — an app needs a
specific Python version, specific libraries, specific system packages. Setting
all that up by hand on the server is fragile and error-prone.

**The Docker idea.** Package the app *and everything it needs* into a single,
sealed box called a **container**. That box runs the same way on any machine
that has Docker. No "it works on my machine" — the machine comes *with* the app.

Three words you must not confuse:

| Word | Plain meaning | Kitchen analogy |
|------|---------------|-----------------|
| **Dockerfile** | A recipe: step-by-step instructions to build the box | The recipe card |
| **Image** | The built box, frozen and reusable | The frozen ready-meal |
| **Container** | A running copy of an image | The meal, heated and on your plate |

You **build** an image *from* a Dockerfile, then **run** a container *from* an
image. One image → many identical containers.

**In our project.** We have:
- `backend/Dockerfile` → builds the `brochure-backend` image (Python API).
- `frontend/Dockerfile` → builds the `brochure-web` image (website + nginx).

---

## 6. Reading a Dockerfile (the backend one)

A Dockerfile is read top to bottom. Each line is a step. Here's the idea behind
ours (`backend/Dockerfile`), plain-language:

```dockerfile
FROM python:3.11-slim        # Start from a small Linux that already has Python 3.11
WORKDIR /app                 # Work inside a folder called /app
COPY requirements.txt ./     # Copy the list of Python libraries in
RUN pip install -r requirements.txt   # Install those libraries
COPY app ./app               # Copy our actual code in
USER appuser                 # Run as a non-root user (safer)
EXPOSE 8000                  # This app listens on port 8000
CMD ["uvicorn", "app.main:app", ...]  # The command to start it
```

**Why copy `requirements.txt` before the code?** Docker **caches** each step. If
your code changes but your library list didn't, Docker reuses the cached
"install libraries" step instead of redoing it — much faster rebuilds. Order
matters for speed.

---

## 7. Multi-stage builds (the frontend one)

**Concept.** Sometimes you need heavy tools to *build* something but not to
*run* it. A **multi-stage build** uses one stage to build, then copies only the
finished result into a small final image, throwing away the heavy tools.

**In our project** (`frontend/Dockerfile`):

- **Stage 1 ("build"):** start from Node.js, install the frontend's packages,
  and run the build. This turns our React/TypeScript source into plain static
  files (HTML, JS, CSS) in a `dist/` folder. Node and all its packages are big.
- **Stage 2 ("serve"):** start from a tiny **nginx** image, copy in just the
  `dist/` folder, and throw the Node stuff away.

The result is a small image that only knows how to *serve* the finished website.

> **Where the frontend build bit us:** the build normally runs
> `tsc --noEmit && vite build`. `tsc` is the TypeScript type-checker; it refused
> to build because of an *unused import* (a harmless warning treated as an
> error). We changed the image to run `vite build` directly so a stray unused
> import can't block a deployment. Type-checking still happens during normal
> development — just not as a gate on the production image.

---

## 8. Build-time vs run-time variables (this caused our blank page)

**Concept.** Configuration ("environment variables") reaches an app at one of
two moments, and they behave very differently:

- **Run-time variables** are read *when the container starts*. Change them,
  restart the container, done. → Our **backend** reads its secrets this way.
- **Build-time variables** are baked *into* the files when you build. If they
  were blank at build time, they're blank forever — until you **rebuild**. →
  Our **frontend** works this way.

**Why the frontend is build-time.** The frontend is just static files sent to
the user's browser. There's no server-side moment to "read config" — the values
have to be *compiled into* the JavaScript when we build it. This is a rule of
**Vite** (our frontend build tool): variables starting with `VITE_` get baked in
at build time.

**In our project.** The frontend needs:
- `VITE_SUPABASE_URL` — where the database/auth lives
- `VITE_SUPABASE_ANON_KEY` — the public key to talk to it
- `VITE_BACKEND_URL=/api` — where to send API calls (we hardcode this in compose)

> **The blank-page bug:** the first build ran *before* we filled in those
> Supabase values, so they baked in **blank**. The Supabase client then throws
> an error on startup ("supabaseUrl is required"), which crashes the page to
> white. The console message about "CSP / eval" was a red herring — the real
> problem was blank baked-in config. **Fix:** put the real values in the root
> `.env`, then **rebuild the web image** (`--no-cache`) so they get baked in.

---

## 9. Docker Compose: running many containers together

**Concept.** Real apps aren't one container — ours is several (API, workers,
reconciler, website). Starting and wiring them by hand is tedious. **Docker
Compose** lets you describe the *whole system* in one file
(`docker-compose.prod.yml`) and start it all with one command.

Each entry under `services:` is one part of the app. One command —
`docker compose -f docker-compose.prod.yml up -d --build` — builds the images
and starts every container.

- `up` = create and start everything
- `-d` = "detached", run in the background
- `--build` = build the images first

**In our project**, the services are:

| Service | What it does | How many |
|---------|--------------|----------|
| `backend` | The API (answers requests) | 1 |
| `worker` | Does the slow PDF extraction | **4 copies** |
| `reconciler` | Keeps the pipeline consistent | 1 |
| `web` | Serves the website + HTTPS | 1 |

> **Why 4 workers matters (a real bug the generic guide would have caused):**
> this app is **four kinds of process**, not one. If you run only the API,
> uploads are *accepted but never processed* — they sit there forever. The
> workers are the muscle. Our compose runs all four kinds. The `replicas: 4`
> line is what makes four worker copies.

---

## 10. How Compose builds a shared image (a bug we hit)

**Concept.** `backend`, `worker`, and `reconciler` all run the *same* Python
code — just with a different start command. So they share one image
(`brochure-backend`). But if you tell Compose "use image `brochure-backend`"
without also telling it *how to build it*, Compose assumes the image lives in an
online registry and tries to **download** it — which fails ("pull access
denied") because it only exists locally.

**Fix.** Give each of those services the same `build:` instruction. Compose then
builds the image once and reuses it for all three. That's the
`pull access denied` error we fixed.

---

## 11. Ports: "expose" vs "publish" (internal vs public)

**Concept.** There's a big difference between:

- **Publish** (`ports: "80:80"`) — punch a hole from the *outside world* to a
  container. Use this only for the public front door.
- **Expose** (`expose: "8000"`) — make a port reachable *only to other
  containers on the same private network*, never from the internet.

**In our project.**
- `web` **publishes** 80 and 443 — it's the public entrance.
- `backend` only **exposes** 8000 — reachable by `web` internally, invisible to
  the internet. This is why we didn't open 8000 on the GCP firewall. The backend
  should never be directly reachable; users go through the website.

**Docker networks.** Compose puts your containers on a private **network** where
they can find each other **by name**. That's why nginx can say
"send `/api` to `backend`" — `backend` is a hostname on that private network.

---

## 12. The reverse proxy (nginx) and "same origin"

**Concept.** A **reverse proxy** is a traffic cop that sits in front of your
apps. The browser only ever talks to the proxy; the proxy decides which internal
service should answer and forwards the request. **nginx** is the proxy we use.

**In our project**, the `web` container's nginx does two jobs:
1. Serve the website's static files (the HTML/JS/CSS from the build).
2. Forward any request starting with `/api/` to the `backend` container.

**Same origin — why we bother.** Because the website *and* the API are served
from the **same address** (`https://34.18.9.118`, website at `/`, API at
`/api`), the browser sees them as one place ("same origin"). This avoids a whole
class of headaches:
- **CORS**: browsers block a website from calling a *different* origin unless
  that origin explicitly allows it. Same origin → no CORS to configure.
- Cookies and auth "just work" because nothing is cross-site.

Also, because the frontend calls the *relative* path `/api` (not the absolute
`http://34.18.9.118:8000`), **nothing breaks if the IP changes** — the browser
just calls "wherever I came from, plus /api".

> **SSE (a detail we handled):** the chat feature *streams* its answer token by
> token using Server-Sent Events. nginx by default *buffers* responses (holds
> them until complete), which would freeze the stream. We turned buffering off
> for `/api/` so streaming works.

---

## 13. HTTPS, TLS, and certificates

**Concept.** **HTTP** sends data in plain text — anyone on the network path can
read passwords and tokens. **HTTPS** encrypts it. The encryption uses a
**TLS certificate**: a file that (a) enables encryption and (b) proves the
server's identity.

Two ways to get a certificate:

- **Let's Encrypt** — a free authority that issues *trusted* certificates, but
  it must verify you **own a domain**. No domain → can't use it.
- **Self-signed** — you generate the certificate yourself. It encrypts perfectly
  well, but no authority vouches for it, so browsers show a one-time
  **"Your connection is not private"** warning. You click *Advanced → Proceed*
  once and it's fine.

**In our project.** No domain yet, so we made a **self-signed** certificate for
the IP (the `openssl ...` command that created the `certs/` folder). Our nginx
uses it to serve HTTPS. The 2 internal users click "proceed" once. When we get a
domain later, we switch to Let's Encrypt and the warning disappears.

**Why HTTPS at all for an internal tool?** Because the VM has a *public* IP, and
login passwords + auth tokens travel over the internet. Plain HTTP would send
them readable. Encryption is not optional even for a small team.

---

## 14. Secrets and the `.env` files

**Concept.** Passwords and API keys must **never** be committed to git (anyone
with the repo would have your keys). Instead they live in **`.env` files** on
the server only, and git is told to ignore them (`.gitignore`).

**In our project** there are two `.env` files, for two different consumers:

| File | Read by | Contains |
|------|---------|----------|
| `backend/.env` | the backend at **run-time** | Supabase service key, JWT secret, AI provider keys, `ALLOWED_ORIGIN` |
| `.env` (root) | Compose at **build-time**, to bake into the frontend | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Because these are gitignored, they are **not** in the copy you clone onto the
server — you must **create them by hand on the VM**. (That's also why a stray
character on line 1 of `backend/.env` broke the build once — Compose reads that
file literally.)

> **Public vs secret keys:** the frontend uses the Supabase **anon** key — safe
> to ship to browsers. The backend uses the **service** key — full database
> power, must stay server-side only. Never swap them.

---

## 15. Health checks and restart policies

**Concept.**
- A **health check** is a little test Docker runs repeatedly to ask "is this
  container actually working?"
- A **restart policy** (`restart: unless-stopped`) tells Docker "if this
  container crashes or the machine reboots, start it back up automatically."

**In our project.** The image's health check pings the API's `/health` page.
That's meaningful for the `backend` (it serves HTTP) but *not* for the
`worker`/`reconciler` (they're background processes with no web page). So the
workers show **`(unhealthy)`** even though they're running perfectly — the check
just has nothing to ping. It's a cosmetic false alarm, not a real problem.

The restart policy is why, after a VM reboot, the whole app comes back on its
own without you logging in.

---

## 16. Git, remotes, and how code reaches the server

**Concept.** **Git** tracks your code history. A **remote** is a copy of the
repo hosted somewhere (like GitHub). You **push** your commits to a remote; the
server **pulls** them down. That's how code travels laptop → GitHub → server.

**A remote is just a named URL.** A repo can have several. `git push aitex`
pushes to the remote *named* `aitex`.

**In our project** — a real gotcha we hit. Your laptop had **two** remotes:
- `origin` → `myounasfaisal/broacher-data-indexing`
- `aitex` → `aitexsolutionsorg/brochure-indexing-bostech`

The VM was cloned from **`aitex`**, but we first pushed to **`origin`**. So the
VM's `git pull` found nothing new — we'd sent the code to the *wrong copy*. Once
we pushed to `aitex`, the pull worked. **Lesson:** the server can only pull what
you pushed to *the remote the server is tracking*.

**The deploy loop** you now know by heart:
```
edit on laptop → commit → push (to the right remote)
   → on server: git pull → docker compose up -d --build
```
The `update.sh` script just bundles the server half into one command.

---

## 17. The full deployment, start to finish (our actual runbook)

Putting every concept together, this is what a clean deploy looks like:

```bash
# ---- one-time server setup ----
# (cloud firewall: open 80 + 443 in the GCP console)
curl -fsSL https://get.docker.com | sh      # install Docker (§5)
sudo usermod -aG docker $USER && newgrp docker

# ---- get the code (§16) ----
git clone git@github.com:aitexsolutionsorg/brochure-indexing-bostech.git /opt/brochure-indexing-bostech
cd /opt/brochure-indexing-bostech
git checkout deployment

# ---- HTTPS certificate (§13) ----
mkdir -p certs
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=34.18.9.118"

# ---- secrets (§14) ----
cp backend/.env.example backend/.env
nano backend/.env      # fill Supabase keys, provider keys, ALLOWED_ORIGIN=https://34.18.9.118

nano .env              # VITE_SUPABASE_URL=... and VITE_SUPABASE_ANON_KEY=...
                       # (build-time! must exist BEFORE building — §8)

# ---- build & run everything (§9) ----
docker compose -f docker-compose.prod.yml up -d --build

# ---- check it (§15) ----
docker compose -f docker-compose.prod.yml ps    # all Up (workers "unhealthy" is fine)
curl -k https://34.18.9.118/api/health          # expect 200
# open https://34.18.9.118 → click through the self-signed warning → log in
```

---

## 18. The four bugs we hit, and the lesson in each

| Symptom | Root cause | Concept it teaches |
|---------|-----------|--------------------|
| `git pull` found nothing new | Pushed to the wrong remote | Remotes are separate copies (§16) |
| `pull access denied for brochure-backend` | Shared image had no `build:` on worker/reconciler | Compose builds vs pulls (§10) |
| Frontend build failed on `tsc` | Unused import treated as a hard error | Don't gate deploys on strict type-checks (§7) |
| Blank white page | Supabase `VITE_` vars were blank *at build time* | Build-time vs run-time config (§8) |

Every one of these is a normal part of DevOps. The skill isn't avoiding all
bugs — it's **reading the error, knowing which concept it belongs to, and fixing
that layer.**

---

## 18b. CI/CD — making "push = deploy" automatic

**Concept.** So far, deploying is manual: you SSH in and run `git pull` +
`docker compose up`. **CI/CD** (Continuous Integration / Continuous Deployment)
automates that: a robot does it for you the moment you push.

**How ours works (GitHub Actions + SSH).** GitHub can run jobs for you on its own
throwaway computers, described in a file under `.github/workflows/`. Ours
(`deploy.yml`) says: *"whenever someone pushes to the `deployment` branch, start
a runner, SSH into the VM, and redeploy."*

```
you: git push (deployment)
        │
        ▼
GitHub Actions runner starts
        │  logs into the VM over SSH
        ▼
VM: git reset --hard origin/deployment
    docker compose ... up -d --build     ← same commands you ran by hand
```

**The pieces it needs (one-time setup):**

1. **A dedicated SSH key** so GitHub can log into the VM. This is a *different*
   key from the one the VM uses to talk to GitHub. Generate a pair; the VM keeps
   the **public** half, GitHub keeps the **private** half.
2. **Repo secrets** on GitHub (Settings → Secrets and variables → Actions):
   - `SSH_HOST` = `34.18.9.118`
   - `SSH_USER` = `younasf69`
   - `SSH_KEY` = the **private** key text
3. **Firewall**: port 22 (SSH) reachable so the runner can connect.

**Why `git reset --hard` instead of `git pull`?** In automation you want the VM
to become an *exact copy* of the branch, with no chance of a merge conflict
stopping the deploy. `reset --hard` throws away any local drift — and because
`.env` and `certs/` are gitignored, your secrets and certificate survive
untouched.

**Safety notes.**
- Every push now changes production. That's why we trigger on the `deployment`
  branch only — you control prod by choosing *when* to push there. Do normal
  work on other branches, then push to `deployment` to release.
- A rebuild causes a few seconds of downtime and *could* ship a broken build.
  Fine for a demo; for real production you'd add a test/health gate first.
- Opening port 22 to the internet is the tradeoff for push-button deploys. Keep
  it **key-only** (no password logins), which GCP does by default.

## 18c. CI/CD for the database — Supabase migrations (2026-07-30)

**Concept.** §18b automates the *code* deploy. The *database* was still manual:
every schema change (a new column, a new table) got applied by hand against the
live Supabase project — easy to forget, easy to apply inconsistently between
your machine and production, and invisible in git history as a "deploy" the way
a code push is.

**How it works.** `supabase/migrations/` holds the same SQL files as
`db/migrations/` (the CLI requires its own timestamped filename format, so they're
duplicated there, not moved — `db/migrations/` stays the human-readable source,
`supabase/migrations/` is what the CLI/CI actually reads). `.github/workflows/
supabase-migrate.yml` says: *"whenever someone pushes a new file under
supabase/migrations/ to the `deployment` branch, link to the project and push
it."* Same shape as §18b, one layer down:

```
you: git push (deployment, with a new file in supabase/migrations/)
        │
        ▼
GitHub Actions runner starts
        │  supabase link --project-ref ...
        │  supabase db push
        ▼
Live Supabase Postgres gets the new migration
```

**The pieces it needs (one-time setup):**

1. **Repo secret** `SUPABASE_ACCESS_TOKEN` — a personal access token from
   [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens),
   *not* the service-role key (that's for the app to talk to its own database;
   this is for the CLI to manage the project itself).
2. **Repo variable** `SUPABASE_PROJECT_REF` = `qpqdbyhfquqfrkrocnnu` (the id in
   `SUPABASE_URL`). A variable, not a secret — it's not sensitive, it's just the
   project name.

Both go under the repo's Settings → Secrets and variables → Actions (variable
goes on the **Variables** tab next to Secrets).

**Making a schema change from now on:**
```
1. Write the SQL in db/migrations/YYYY-MM-DD_description.sql (as before)
2. Copy it to supabase/migrations/YYYYMMDDHHMMSS_description.sql
   (timestamp must sort after the last one — `supabase migration list` shows the order)
3. Commit both, push to deployment
4. The workflow applies it automatically — check the Actions tab if unsure
```

**Why keep both folders instead of just one?** `db/migrations/` files are named
by date and read top-to-bottom as project history (that's how §17 of
`ARCHITECTURE.md` cites them). The Supabase CLI needs a stricter
`YYYYMMDDHHMMSS_name.sql` format to guarantee ordering when multiple migrations
land the same day. Renaming the originals would break every existing doc
reference to them, so the CLI gets its own copy instead.

**Catching up a database that already has the change.** The seven migration
files that existed before this workflow were already applied by hand to
production earlier in the project. Pushing them again would be harmless (they
all use `if not exists` guards) but `supabase migration repair --status applied
<version>` marked them as done in Supabase's own tracking table without
re-running them, so `supabase db push` only ever pushes genuinely new files
going forward.

## 19. What's next (for later, not now)

This setup is **standalone demo mode** — this app alone, self-signed HTTPS on an
IP. When the VM grows to host **n8n and other apps**, the model changes to a
**shared reverse proxy + a real domain + Let's Encrypt certificates**, with each
app on a shared private network. That plan (and *why*) is written up separately
in `docs/HOSTING_PLATFORM_PLAN.md`.

---

## Quick glossary

- **VPS / VM** — a rented always-on computer.
- **IP address** — a computer's number on the internet. **Static** = never
  changes.
- **Domain** — a friendly name pointing to an IP.
- **SSH** — secure remote command line.
- **Firewall** — decides what network traffic is allowed (cloud layer + OS
  layer).
- **Port** — a numbered door (80 = HTTP, 443 = HTTPS, 8000 = our backend).
- **Docker** — packages an app + its needs into a portable box.
- **Dockerfile / Image / Container** — recipe / frozen meal / meal on a plate.
- **Multi-stage build** — build with heavy tools, ship only the light result.
- **Docker Compose** — run many containers together from one file.
- **Publish vs expose** — open a port to the internet vs only to other
  containers.
- **Reverse proxy (nginx)** — front-desk traffic cop that routes requests.
- **Same origin** — website + API on one address → no CORS, simpler auth.
- **HTTP vs HTTPS** — plain vs encrypted.
- **TLS certificate** — the file enabling HTTPS. **Let's Encrypt** (trusted,
  needs a domain) vs **self-signed** (works, shows a one-time warning).
- **Build-time vs run-time variable** — baked in when building vs read when
  starting.
- **`.env` file** — where secrets live on the server; never committed to git.
- **Health check** — Docker repeatedly testing "are you OK?".
- **Restart policy** — auto-restart on crash/reboot.
- **Git remote** — a named copy of the repo you push to / pull from.
