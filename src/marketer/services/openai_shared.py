"""One AsyncOpenAI client per process + API key.

Images, TTS, Whisper, and the article OpenAI fallback used to each
construct their own client. They share a key and a TLS pool.
"""
from __future__ import annotations

from openai import AsyncOpenAI

from ..config import settings

_shared: AsyncOpenAI | None = None
_shared_key: str | None = None


def shared_client() -> AsyncOpenAI:
    global _shared, _shared_key
    key = settings.openai_api_key
    if _shared is not None and _shared_key == key:
        return _shared
    _shared = AsyncOpenAI(api_key=key)
    _shared_key = key
    return _shared
