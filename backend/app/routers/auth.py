"""
Machine-to-machine authentication endpoints.

POST /auth/token     exchange email + password for access/refresh tokens
POST /auth/refresh   exchange a refresh token for a fresh access token

These exist so external integrations (Jarvis, scripts, bots) can authenticate
through the backend API without importing a Supabase client SDK. Human users
continue to sign in via the frontend's Supabase JS client — these endpoints
are not used by the UI.

Rate-limited aggressively: 5 attempts/minute per IP to make credential
stuffing impractical.
"""

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import settings
from app.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])

_SUPABASE_AUTH = f"{settings.supabase_url.rstrip('/')}/auth/v1"


class TokenRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


@router.post("/token", response_model=TokenResponse)
@limiter.limit("5/minute")
async def obtain_token(request: Request, body: TokenRequest) -> TokenResponse:
    """
    Password grant: exchange credentials for a token pair.

    Proxies to Supabase GoTrue so the caller never needs the anon key or
    Supabase URL — only the backend's own address.
    """
    resp = httpx.post(
        f"{_SUPABASE_AUTH}/token?grant_type=password",
        headers={
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json",
        },
        json={"email": body.email, "password": body.password},
        timeout=10,
    )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    data = resp.json()
    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data["expires_in"],
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("10/minute")
async def refresh_token(request: Request, body: RefreshRequest) -> TokenResponse:
    """
    Refresh grant: exchange a refresh token for a fresh access token without
    re-entering credentials. The old refresh token is rotated (single-use).
    """
    resp = httpx.post(
        f"{_SUPABASE_AUTH}/token?grant_type=refresh_token",
        headers={
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json",
        },
        json={"refresh_token": body.refresh_token},
        timeout=10,
    )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )

    data = resp.json()
    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data["expires_in"],
    )
