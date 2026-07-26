"""
Reusable FastAPI dependencies for auth and role verification.

These functions are the real security boundary: every protected route
independently verifies the caller's Supabase access token (and role, where
required) regardless of any check the frontend performed.

Verification is done locally with the project's JWT secret (HS256) — no
round-trip to the Supabase auth server per request.
"""

from __future__ import annotations

import jwt
from jwt import PyJWKClient
from fastapi import Depends, Header, HTTPException, status

from app.config import settings
from app.services.database import get_user_role

# Initialize the JWKS client if Supabase URL is available
_jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json" if settings.supabase_url else None
_jwks_client = PyJWKClient(_jwks_url) if _jwks_url else None


def _decode_token(authorization: str | None) -> dict:
    """Extract and verify the Bearer JWT from the Authorization header."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        # Determine algorithm from the header to support both ES256 and HS256
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg", "HS256")

        if alg == "ES256" and _jwks_client:
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256"],
                audience="authenticated",
                leeway=120,
            )
        else:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                leeway=120,
            )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return payload


def require_user(authorization: str | None = Header(default=None)) -> str:
    """
    Dependency: verify the JWT and return the authenticated user's id (sub).
    Use on any route that requires a logged-in user.
    """
    payload = _decode_token(authorization)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no subject.",
        )
    return user_id


def require_admin(user_id: str = Depends(require_user)) -> str:
    """
    Dependency: verify the JWT AND that the user's role is 'admin'.
    Returns the user id. Use on admin-only routes (e.g. user management).
    """
    role = get_user_role(user_id)
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    return user_id


# Roles allowed to upload brochures. Admins manage users AND upload;
# managers may upload but cannot manage users.
UPLOAD_ROLES = ("admin", "manager")


def require_uploader(user_id: str = Depends(require_user)) -> str:
    """
    Dependency: verify the JWT AND that the user's role may upload brochures
    ('admin' or 'manager'). Returns the user id.
    """
    role = get_user_role(user_id)
    if role not in UPLOAD_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or manager role required.",
        )
    return user_id


def require_manager(user_id: str = Depends(require_user)) -> str:
    """
    Dependency: verify the JWT AND that the user may record house knowledge
    ('admin' or 'manager'). Returns the user id.

    Same role set as require_uploader, kept as its own name because the call
    sites mean different things: uploading a brochure is data entry, writing a
    substitution note is BosTech asserting a professional judgement that the
    assistant will then repeat to everyone. If those permissions ever diverge,
    they diverge here.
    """
    role = get_user_role(user_id)
    if role not in UPLOAD_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or manager role required.",
        )
    return user_id
