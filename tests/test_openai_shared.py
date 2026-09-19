"""Shared OpenAI client is one instance per API key."""
from __future__ import annotations


def test_shared_client_cached_per_api_key(monkeypatch):
    from marketer.config import settings
    from marketer.services import openai_shared

    monkeypatch.setattr(settings, "openai_api_key", "sk-a")
    openai_shared._shared = None
    openai_shared._shared_key = None
    try:
        first = openai_shared.shared_client()
        second = openai_shared.shared_client()
        assert first is second
        monkeypatch.setattr(settings, "openai_api_key", "sk-b")
        rotated = openai_shared.shared_client()
        assert rotated is not first
    finally:
        openai_shared._shared = None
        openai_shared._shared_key = None
