"""
FastAPI application entry point.

Creates the app instance, configures CORS locked to the exact frontend origin,
and mounts the routers. Run locally with:

    uvicorn app.main:app --reload
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.rate_limit import limiter
from app.routers import (
    admin_settings,
    chat,
    dashboard,
    listings,
    notes,
    search,
    suppliers,
    upload,
    users,
)
from app.services.database import DatabaseError, DuplicateListingError

logger = logging.getLogger(__name__)

app = FastAPI(title="Brochure Extraction Platform API")

# Wire up the shared rate limiter (used by the upload endpoint).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(DuplicateListingError)
async def _duplicate_listing_handler(
    _request: Request, exc: DuplicateListingError
) -> JSONResponse:
    """
    Admin listing edits that collide with an existing identical listing get a
    409 with the real message. Registered for the subclass so it wins over the
    generic DatabaseError → 503 handler below (starlette picks the most
    specific handler by MRO).
    """
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(DatabaseError)
async def _database_error_handler(_request: Request, exc: DatabaseError) -> JSONResponse:
    """
    Any data-access failure surfaces as a clean 503 (already logged with a
    stack trace in database._db_op), instead of a raw 500. The detail is
    deliberately generic so internal DB errors aren't echoed to clients.
    """
    return JSONResponse(
        status_code=503,
        content={"detail": "The database is temporarily unavailable. Please try again."},
    )

# CORS: allow only the configured frontend origin — no wildcard in production.
# In local dev, "localhost" and "127.0.0.1" are the same server but different
# CORS origins to the browser — allow whichever one ALLOWED_ORIGIN didn't spell
# out, so it doesn't matter which one a dev happens to open. Doesn't affect a
# real deployed origin (e.g. https://34.18.9.118), which contains neither.
_origins = [settings.allowed_origin]
if "localhost" in settings.allowed_origin:
    _origins.append(settings.allowed_origin.replace("localhost", "127.0.0.1"))
elif "127.0.0.1" in settings.allowed_origin:
    _origins.append(settings.allowed_origin.replace("127.0.0.1", "localhost"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Feature routers.
app.include_router(search.router)
app.include_router(listings.router)
app.include_router(suppliers.router)
app.include_router(upload.router)
app.include_router(users.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(notes.router)
app.include_router(admin_settings.router)


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple liveness probe for the hosting platform."""
    return {"status": "ok"}
