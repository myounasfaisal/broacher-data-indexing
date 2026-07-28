# Hosting Platform Plan — shared multi-app VM

**Status:** future work. The current deployment (`docker-compose.prod.yml`) is
**standalone demo mode**: this app alone on the VM, self-signed HTTPS on the
IP, no shared proxy. This doc captures the target architecture for when the VM
becomes a shared host, so the decision context isn't lost.

## Context

- **VM:** GCP, static external IP **34.18.9.118**. GCP firewall currently opens
  80/443 only.
- **This app (brochure-data-indexing):** FastAPI backend + 4 workers +
  reconciler + a static Vite SPA served by nginx. DB is **hosted Supabase**
  (no DB container). See `ARCHITECTURE.md` / `run.sh`.
- **Coming to the same VM:**
  - **n8n** — workflow automation. **Must receive external webhooks**
    (confirmed), so it needs a valid, stable, public HTTPS URL.
  - One or more **other apps** (TBD).

## The core problem

One VM, one public IP, and (for now) **no domain**. Multiple apps cannot all own
ports 80/443, and a reverse proxy that routes by hostname has nothing to route
on without domain names. Concretely:

- **n8n webhooks break on a self-signed IP cert.** Third-party callers (Stripe,
  GitHub, form providers, …) reject the TLS handshake against a self-signed
  cert, and n8n's `WEBHOOK_URL` wants a stable hostname. This makes a real
  domain + Let's Encrypt effectively **mandatory** once n8n goes live.
- **No-domain fallbacks are poor:** path-based routing (`IP/n8n/`) fights n8n's
  subpath handling and webhooks; port-based routing (a firewall port + separate
  cert per app) defeats the shared-proxy design and multiplies attack surface.

## Target architecture (when going multi-app)

```
GCP VM 34.18.9.118   (firewall: 80, 443; 81 restricted to admin IP for NPM UI)
│
└── proxy-net  (external Docker network — the shared bus)
    ├── nginx-proxy-manager   80 / 443 / 81   ← only thing on 80/443; terminates TLS, routes by hostname
    ├── brochure-web          :80 internal    ← this app (SPA + /api → backend); backend/workers/reconciler on a private net
    ├── n8n                   :5678 internal   ← + its own Postgres (or SQLite volume) + WEBHOOK_URL set to its subdomain
    └── <future app>          :xxxx internal
```

**Per-app contract:** join `proxy-net`, expose an internal port only, never
publish 80/443. NPM is the single front door.

### Recommended: get a domain + subdomains

- Register a cheap domain (~$10/yr; a GoDaddy account/connector is available).
- Point an **A record** for each subdomain at `34.18.9.118`:
  `brochure.<domain>`, `n8n.<domain>`, `app3.<domain>`, …
- In NPM, one **Proxy Host** per subdomain → the app's internal container:port,
  each with a **Let's Encrypt** cert (auto-renew). Real certs → no browser
  warnings, and n8n webhooks work.

## Migration steps (standalone demo → shared platform)

1. Register domain; add A records for the subdomains → 34.18.9.118.
2. `docker network create proxy-net`; stand up Nginx Proxy Manager on it
   (owns 80/443/81). Lock 81 to an admin IP in the GCP firewall.
3. **Revert this app to proxy mode** (the change was prototyped once already):
   - `frontend/nginx.conf`: listen 80 only, drop the TLS server block + redirect.
   - `frontend/Dockerfile`: `EXPOSE 80` only, drop the cert mount note.
   - `docker-compose.prod.yml`: remove `ports: 80/443` and the `certs` volume;
     add the `web` container to `proxy-net` + a private `internal` net (backend,
     worker, reconciler stay on `internal` only).
   - Drop the self-signed cert generation from the deploy runbook.
4. Add NPM Proxy Host `brochure.<domain>` → `brochure-web:80`, Let's Encrypt on.
   Enable WebSockets/streaming support (for SSE chat).
5. Deploy **n8n** on `proxy-net` with its own Postgres volume; set
   `N8N_HOST=n8n.<domain>`, `N8N_PROTOCOL=https`,
   `WEBHOOK_URL=https://n8n.<domain>/`. NPM Proxy Host `n8n.<domain>` →
   `n8n:5678`, Let's Encrypt on, WebSockets on.
6. Repeat the per-app contract for any further apps.

## Notes / decisions log

- 2026-07-28: Client demo prioritized → shipping **standalone demo mode** first
  (self-signed HTTPS on the IP). Domain + shared proxy deferred to the client's
  own VPS setup. n8n confirmed to need external webhooks → domain required at
  that stage.
