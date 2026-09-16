"""Persona HTTP spend-cap mapping — distinct from the unbilled 402 gate.

Unbilled usage is refused before the persona is loaded. A live daily-cap
breach happens later, inside generate_turn / lock_reference, and must
still become HTTP 402 with no persist. That mapping lives in
``_spend_error`` and is the hole a unit test of ``personas.chat`` cannot
see: a cap exception that becomes 502 would look like an outage and
invite a retry that burns the rest of the day.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.personas.schemas import Persona
from marketer.repos import brand_kit as brand_kit_repo
from marketer.repos import personas as repo
from marketer.repos.spend import SpendCapExceeded
from marketer.services.spend_context import SpendContext
from tests.conftest import FakeRecorder

USER = "user_persona_cap"
AUTH = {"Authorization": "Bearer mkt_x"}


def _stub_spend(monkeypatch) -> None:
    """``_spend_for`` imports default_context locally; patch the module."""

    async def _spend(*, user_id: str, niche_id, job_id, cap_usd):
        return SpendContext(
            user_id=user_id,
            niche_id=niche_id or uuid4(),
            job_id=job_id,
            record=FakeRecorder(),
            cap_usd=cap_usd,
        )

    import marketer.services.spend_context as spend_mod

    monkeypatch.setattr(spend_mod, "default_context", _spend)


def _reset_limiter() -> None:
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _persona(**over: object) -> Persona:
    base: dict[str, object] = dict(
        id=uuid4(),
        user_id=USER,
        name="Sol",
        tagline="ops nerd",
        persona="Dry, concrete.",
        greeting="Hey.",
        voice_rules="No hype.",
        created_at=datetime.now(UTC),
    )
    base.update(over)
    return Persona(**base)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    _reset_limiter()
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "allow_unbilled_usage", True)

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id=USER, email="u@t.com"
    )
    return TestClient(app, raise_server_exceptions=False)


def test_post_message_spend_cap_is_402_without_persist(client, monkeypatch) -> None:
    """A niche/global cap must 402 and leave the thread exactly as it was."""
    _stub_spend(monkeypatch)
    persona = _persona()
    persisted: list[str] = []

    async def _load(persona_id, *, user_id):
        return persona

    async def _kit(_user_id):
        return None

    async def _history(persona_id, *, user_id, limit):
        return []

    async def _generate(**_kwargs):
        raise SpendCapExceeded(
            "niche hit daily cap: $10.00 >= $10.00", scope="niche"
        )

    async def _append(**kwargs):
        persisted.append(kwargs.get("user_content", ""))
        raise AssertionError("append_turn must not run after a spend-cap 402")

    from marketer.personas import chat as persona_chat

    monkeypatch.setattr(repo, "get", _load)
    monkeypatch.setattr(brand_kit_repo, "get", _kit)
    monkeypatch.setattr(repo, "list_messages", _history)
    monkeypatch.setattr(persona_chat, "generate_turn", _generate)
    monkeypatch.setattr(repo, "append_turn", _append)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/messages",
        json={"content": "write a launch line"},
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert "daily cap" in resp.json()["detail"]
    assert persisted == []


def test_visual_spend_cap_is_402_without_lock(client, monkeypatch) -> None:
    """A visual lock is a metered image call. Cap refusal must not write
    visual_locked_at, or the next attempt 409s on an image that never landed."""
    _stub_spend(monkeypatch)
    persona = _persona()
    locked: list[str] = []

    async def _load(persona_id, *, user_id):
        return persona

    async def _kit(_user_id):
        return None

    async def _lock(*_a, **_k):
        raise SpendCapExceeded(
            "user hit global daily cap: $25.00 >= $25.00", scope="global"
        )

    async def _lock_row(persona_id, *, user_id, path):
        locked.append(path)
        raise AssertionError("lock_visual must not run after a spend-cap 402")

    from marketer.personas import visual as persona_visual

    monkeypatch.setattr(repo, "get", _load)
    monkeypatch.setattr(brand_kit_repo, "get", _kit)
    monkeypatch.setattr(persona_visual, "lock_reference", _lock)
    monkeypatch.setattr(repo, "lock_visual", _lock_row)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/visual",
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert "daily cap" in resp.json()["detail"]
    assert locked == []


def test_persona_provider_failure_is_502_not_402(client, monkeypatch) -> None:
    """A provider outage must not be billed as a payment problem — retries
    would look like the right fix for a cap that was never hit."""
    _stub_spend(monkeypatch)
    persona = _persona()

    async def _load(persona_id, *, user_id):
        return persona

    async def _kit(_user_id):
        return None

    async def _history(persona_id, *, user_id, limit):
        return []

    async def _generate(**_kwargs):
        raise RuntimeError("openai 503")

    async def _append(**_kwargs):
        raise AssertionError("append_turn must not run on a 502")

    from marketer.personas import chat as persona_chat

    monkeypatch.setattr(repo, "get", _load)
    monkeypatch.setattr(brand_kit_repo, "get", _kit)
    monkeypatch.setattr(repo, "list_messages", _history)
    monkeypatch.setattr(persona_chat, "generate_turn", _generate)
    monkeypatch.setattr(repo, "append_turn", _append)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/messages",
        json={"content": "hello"},
        headers=AUTH,
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "persona generation failed"
