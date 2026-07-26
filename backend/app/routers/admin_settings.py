"""
Admin settings API.

GET  /admin/settings              all settings (secrets masked)
PUT  /admin/settings              update one or more settings
POST /admin/settings/test-key     test an API key against its provider
GET  /admin/settings/status       system health snapshot
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings as env_settings
from app.dependencies import require_admin
from app.services import app_settings
from app.services.database import get_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


class SettingsResponse(BaseModel):
    settings: list[dict[str, Any]]
    categories: list[dict[str, str]]


class SettingsUpdate(BaseModel):
    changes: dict[str, str]


class TestKeyRequest(BaseModel):
    provider: str
    api_key: str
    api_base: str = ""


class TestKeyResponse(BaseModel):
    ok: bool
    message: str


class SystemStatus(BaseModel):
    workers_active: int
    documents_processing: int
    total_listings: int
    total_chemicals: int
    embeddings_indexed: int
    extraction_provider: str
    chat_enabled: bool
    embeddings_enabled: bool


@router.get("", response_model=SettingsResponse)
async def get_settings(_admin_id: str = Depends(require_admin)) -> SettingsResponse:
    return SettingsResponse(
        settings=app_settings.get_all_masked(),
        categories=app_settings.get_categories(),
    )


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    admin_id: str = Depends(require_admin),
) -> dict[str, str]:
    if not body.changes:
        raise HTTPException(status_code=400, detail="No changes provided.")
    app_settings.update_settings(body.changes, admin_id)
    return {"status": "ok"}


@router.post("/test-key", response_model=TestKeyResponse)
async def test_key(
    body: TestKeyRequest,
    _admin_id: str = Depends(require_admin),
) -> TestKeyResponse:
    """Lightweight connectivity test for an API key against its provider."""
    provider = body.provider.lower()
    key = body.api_key
    base = body.api_base

    if not key or "****" in key:
        return TestKeyResponse(ok=False, message="No key provided (or masked value sent).")

    try:
        if provider == "openai" or provider == "gpt":
            url = (base or "https://api.openai.com") + "/v1/models"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {key}"})
            if r.status_code == 200:
                return TestKeyResponse(ok=True, message="Connected to OpenAI successfully.")
            return TestKeyResponse(ok=False, message=f"OpenAI returned {r.status_code}.")

        elif provider == "anthropic" or provider == "claude":
            url = "https://api.anthropic.com/v1/messages"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(
                    url,
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-haiku-4-5-20251001",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            if r.status_code in (200, 201):
                return TestKeyResponse(ok=True, message="Connected to Anthropic successfully.")
            if r.status_code == 401:
                return TestKeyResponse(ok=False, message="Invalid Anthropic API key.")
            return TestKeyResponse(ok=False, message=f"Anthropic returned {r.status_code}.")

        elif provider == "qwen":
            url = (base or "https://dashscope.aliyuncs.com/compatible-mode/v1") + "/models"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {key}"})
            if r.status_code == 200:
                return TestKeyResponse(ok=True, message="Connected to Qwen/Dashscope successfully.")
            return TestKeyResponse(ok=False, message=f"Qwen returned {r.status_code}.")

        elif provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(url)
            if r.status_code == 200:
                return TestKeyResponse(ok=True, message="Connected to Gemini successfully.")
            return TestKeyResponse(ok=False, message=f"Gemini returned {r.status_code}.")

        elif provider == "openrouter":
            url = (base or "https://openrouter.ai/api/v1") + "/models"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {key}"})
            if r.status_code == 200:
                return TestKeyResponse(ok=True, message="Connected to OpenRouter successfully.")
            return TestKeyResponse(ok=False, message=f"OpenRouter returned {r.status_code}.")

        elif provider == "nuextract":
            url = (base or "https://nuextract.ai/api") + "/projects"
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {key}"})
            if r.status_code == 200:
                return TestKeyResponse(ok=True, message="Connected to NuExtract successfully.")
            return TestKeyResponse(ok=False, message=f"NuExtract returned {r.status_code}.")

        else:
            return TestKeyResponse(ok=False, message=f"Unknown provider: {provider}")

    except httpx.TimeoutException:
        return TestKeyResponse(ok=False, message=f"Connection to {provider} timed out.")
    except Exception as exc:
        logger.exception("test-key failed for %s", provider)
        return TestKeyResponse(ok=False, message=f"Connection error: {exc}")


@router.get("/status", response_model=SystemStatus)
async def system_status(_admin_id: str = Depends(require_admin)) -> SystemStatus:
    """Lightweight system health snapshot for the settings page header."""
    client = get_client()

    try:
        docs = client.table("documents").select("id", count="exact").eq("status", "extracting").execute()
        docs_processing = docs.count or 0
    except Exception:
        docs_processing = 0

    try:
        listings = client.table("listings").select("id", count="exact").execute()
        total_listings = listings.count or 0
    except Exception:
        total_listings = 0

    try:
        chems = client.table("chemicals").select("id", count="exact").execute()
        total_chemicals = chems.count or 0
    except Exception:
        total_chemicals = 0

    try:
        embeds = client.table("chemical_embeddings").select("chemical_id", count="exact").execute()
        embeddings_indexed = embeds.count or 0
    except Exception:
        embeddings_indexed = 0

    extraction_provider = app_settings.get_raw("extraction_provider") or env_settings.extraction_provider
    chat_enabled = (app_settings.get_raw("chat_enabled") or str(env_settings.chat_enabled)).lower() == "true"
    embeddings_enabled = (app_settings.get_raw("embeddings_enabled") or str(env_settings.embeddings_enabled)).lower() == "true"

    return SystemStatus(
        workers_active=0,
        documents_processing=docs_processing,
        total_listings=total_listings,
        total_chemicals=total_chemicals,
        embeddings_indexed=embeddings_indexed,
        extraction_provider=extraction_provider,
        chat_enabled=chat_enabled,
        embeddings_enabled=embeddings_enabled,
    )
