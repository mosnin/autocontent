"""OpenAI Realtime voice-mode session minting."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from marketer.config import settings
from marketer.services import openai_realtime

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class VoiceStatus(BaseModel):
    ready: bool
    model: str
    voice: str


class VoiceSession(BaseModel):
    model: str
    voice: str
    client_secret: str
    expires_at: int | None = None
    raw: dict[str, Any]


@router.get("/status", response_model=VoiceStatus)
async def voice_status(ctx: AuthCtx = CurrentUser) -> VoiceStatus:
    return VoiceStatus(
        ready=openai_realtime.enabled(),
        model=settings.voice_realtime_model,
        voice=settings.voice_realtime_voice,
    )


@router.post("/session", response_model=VoiceSession)
async def voice_session(ctx: AuthCtx = CurrentUser) -> VoiceSession:
    if not openai_realtime.enabled():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="OpenAI voice mode is not configured",
        )
    try:
        data = await openai_realtime.create_session()
    except Exception as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=str(exc)
        ) from exc
    secret = ""
    expires_at = None
    client_secret = data.get("client_secret")
    if isinstance(client_secret, dict):
        secret = str(client_secret.get("value") or "")
        raw_exp = client_secret.get("expires_at")
        if isinstance(raw_exp, (int, float)):
            expires_at = int(raw_exp)
    elif isinstance(client_secret, str):
        secret = client_secret
    if not secret:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI Realtime session missing client_secret",
        )
    return VoiceSession(
        model=str(data.get("model") or settings.voice_realtime_model),
        voice=str(data.get("voice") or settings.voice_realtime_voice),
        client_secret=secret,
        expires_at=expires_at,
        raw={"id": data.get("id"), "object": data.get("object")},
    )
