"""OpenAI Realtime voice mode — operator conversation, not niche TTS.

Creates an ephemeral session the browser uses for WebRTC. The voice
agent is instructed to drive marketer through Jev (decisions) and Qwen
(generation) rather than inventing spend or publishes on its own.

Dark without MARKETER_OPENAI_API_KEY. Session minting is an operator
cost, not niche spend — same contract as voice previews.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..config import settings

PROVIDER = "openai"
REALTIME_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


class VoiceModeError(RuntimeError):
    """Raised when the Realtime session cannot be minted."""

VOICE_INSTRUCTIONS = """You are the voice operator for marketer.sh.
You help the human run an autonomous marketing suite (Studio video,
Press articles, Ads, Campaigns).

Rules:
- You do not move money, publish, or change ad budgets yourself.
- Decisions (route, score, gate, approve/deny) belong to Jev, the
  System One model. If the user asks you to decide, say you will queue
  that as a Jev question, not invent a verdict.
- Generation (scripts, articles, captions) belongs to Qwen via OpenRouter.
- Confirm before anything that spends or publishes.
- Be concise. Spoken-word natural. No filler.
"""


def enabled() -> bool:
    return bool(settings.openai_api_key)


async def create_session(
    *,
    model: str | None = None,
    voice: str | None = None,
) -> dict[str, Any]:
    """Mint an ephemeral Realtime session for the browser client."""
    if not enabled():
        raise VoiceModeError("MARKETER_OPENAI_API_KEY is not set")
    body = {
        "model": model or settings.voice_realtime_model,
        "voice": voice or settings.voice_realtime_voice,
        "instructions": VOICE_INSTRUCTIONS,
        "modalities": ["audio", "text"],
    }
    headers = {
        "authorization": f"Bearer {settings.openai_api_key}",
        "content-type": "application/json",
        "openai-beta": "realtime=v1",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(REALTIME_SESSIONS_URL, json=body, headers=headers)
        if resp.status_code >= 400:
            raise VoiceModeError(
                f"OpenAI Realtime session failed ({resp.status_code}): {resp.text}"
            )
        data = resp.json()
    if not isinstance(data, dict):
        raise VoiceModeError("OpenAI Realtime session returned a non-object")
    return data
