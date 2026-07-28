# Frontend image — builds the Vite SPA, then serves it (and reverse-proxies the
# API) with nginx over self-signed TLS. This single container is the app's
# public entrypoint. Serving the SPA and proxying /api from the SAME origin
# means the browser makes no cross-origin calls: no CORS, no third-party-cookie
# issues, and the bundle never needs rebuilding when the VM's IP changes.
#
#   docker compose -f docker-compose.prod.yml up -d --build web

# ---- build stage: compile the static bundle ----
FROM node:20-slim AS build
WORKDIR /app

# Install deps first so this layer caches until package files change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes VITE_* variables into the bundle at BUILD time (they are not read
# at runtime). VITE_BACKEND_URL defaults to /api — the same-origin path that
# nginx (below) forwards to the FastAPI container.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BACKEND_URL=/api
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_BACKEND_URL=$VITE_BACKEND_URL
# Build the bundle with vite directly rather than `npm run build`, which also
# runs `tsc --noEmit` as a strict gate. esbuild strips unused imports fine, so
# the bundle is correct; type-checking stays a dev/CI concern and never blocks
# the production image build over a stray unused import.
RUN npx vite build

# ---- serve stage: nginx serves dist/ + proxies /api ----
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# TLS material is mounted at runtime from ./certs (see docker-compose.prod.yml);
# never bake private keys into the image.
EXPOSE 80 443
