# Backend image — FastAPI extraction/search/upload API.
#
# Slim Python base; all Python deps (pymupdf, rapidfuzz, pydantic-core, …) ship
# manylinux wheels, so no compiler/system libs are needed. Runs uvicorn WITHOUT
# --reload (production; also sidesteps the WatchFiles reload issue documented in
# CHANGES.md). Configuration comes entirely from environment variables — no .env
# file is baked into the image (see docker-compose.yml / --env-file at runtime).
FROM python:3.11-slim

# - PYTHONUNBUFFERED: logs stream out immediately (no stdout buffering).
# - PYTHONDONTWRITEBYTECODE: no .pyc clutter in the container layer.
# - PIP_NO_CACHE_DIR: smaller image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first so this layer is cached until requirements change.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the application code.
COPY app ./app

# Run as an unprivileged user (never root in the container).
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# Container-internal liveness probe hits the app's /health route.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

# 0.0.0.0 so the port is reachable from outside the container. No --reload.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
