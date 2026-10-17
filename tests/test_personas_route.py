"""Route-level tests for /api/v1/personas paid and ownership edges.

Persona chat unit tests stub the provider; these pin the HTTP gates:
unbilled generate is 402 with no turn / no persist, a foreign persona is
404, and a write-once visual lock is 409 without a second image call.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.personas.schemas import Persona, PersonaMessage, PersonaTurn
from marketer.repos import brand_kit as brand_kit_repo
from marketer.repos import niches as niches_repo
from marketer.repos import personas as repo

USER = "user_personas"
AUTH = {"Authorization": "Bearer mkt_x"}
NICHE = UUID("33333333-3333-3333-3333-333333333333")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _persona(**over) -> Persona:
    base = dict(
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


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id=USER, email="u@t.com"
    )
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    _reset_limiter()
    return _client(monkeypatch)


def test_post_message_unbilled_is_402_without_turn(client, monkeypatch):
    """A 402 must leave the thread untouched — generate_turn and append_turn
    both happen after refuse_unbilled_generate."""
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    turns: list[str] = []
    persisted: list[str] = []
    persona = _persona()

    async def _load(persona_id, *, user_id):
        turns.append("loaded")
        return persona

    async def _generate(**kwargs):
        turns.append("generated")
        return "should not run"

    async def _append(**kwargs):
        persisted.append(kwargs.get("user_content", ""))
        raise AssertionError("append_turn must not run on unbilled 402")

    monkeypatch.setattr(repo, "get", _load)
    from marketer.personas import chat as persona_chat

    monkeypatch.setattr(persona_chat, "generate_turn", _generate)
    monkeypatch.setattr(repo, "append_turn", _append)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/messages",
        json={"content": "write a launch line"},
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert "unbilled" in resp.json()["detail"]
    assert turns == []
    assert persisted == []


def test_post_message_foreign_persona_is_404(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unbilled_usage", True)
    generated: list[str] = []

    async def _missing(persona_id, *, user_id):
        return None

    async def _generate(**kwargs):
        generated.append("ran")
        return "nope"

    monkeypatch.setattr(repo, "get", _missing)
    from marketer.personas import chat as persona_chat

    monkeypatch.setattr(persona_chat, "generate_turn", _generate)

    resp = client.post(
        f"/api/v1/personas/{uuid4()}/messages",
        json={"content": "hello"},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert generated == []


def test_post_message_persists_only_after_reply(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unbilled_usage", True)
    persona = _persona()
    user_msg = PersonaMessage(
        id=uuid4(), persona_id=persona.id, user_id=USER, role="user", content="hi"
    )
    asst_msg = PersonaMessage(
        id=uuid4(),
        persona_id=persona.id,
        user_id=USER,
        role="assistant",
        content="two options",
    )

    async def _load(persona_id, *, user_id):
        return persona

    async def _kit(user_id):
        return None

    async def _history(persona_id, *, user_id, limit):
        return []

    async def _generate(**kwargs):
        return "two options"

    async def _append(persona_id, *, user_id, user_content, assistant_content):
        assert user_content == "hi"
        assert assistant_content == "two options"
        return PersonaTurn(user_message=user_msg, assistant_message=asst_msg)

    from marketer.personas import chat as persona_chat

    monkeypatch.setattr(repo, "get", _load)
    monkeypatch.setattr(brand_kit_repo, "get", _kit)
    monkeypatch.setattr(repo, "list_messages", _history)
    monkeypatch.setattr(persona_chat, "generate_turn", _generate)
    monkeypatch.setattr(repo, "append_turn", _append)

    from marketer.services.spend_context import SpendContext
    from tests.conftest import FakeRecorder

    async def _spend(*, user_id, niche_id, job_id, cap_usd):
        return SpendContext(
            user_id=user_id,
            niche_id=niche_id or uuid4(),
            job_id=job_id,
            record=FakeRecorder(),
            cap_usd=cap_usd,
        )

    monkeypatch.setattr(
        "backend.routes.personas.default_context", _spend, raising=False
    )
    # _spend_for imports default_context locally — patch the service module.
    import marketer.services.spend_context as spend_mod

    monkeypatch.setattr(spend_mod, "default_context", _spend)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/messages",
        json={"content": "hi"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assistant_message"]["content"] == "two options"


def test_visual_unbilled_is_402_without_image_call(client, monkeypatch):
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    locked: list[str] = []

    async def _load(persona_id, *, user_id):
        locked.append("loaded")
        return _persona()

    monkeypatch.setattr(repo, "get", _load)
    from marketer.personas import visual as persona_visual

    async def _lock(*a, **k):
        locked.append("image")
        return "/tmp/x.png"

    monkeypatch.setattr(persona_visual, "lock_reference", _lock)

    resp = client.post(f"/api/v1/personas/{uuid4()}/visual", headers=AUTH)
    assert resp.status_code == 402
    assert locked == []


def test_visual_already_locked_is_409_without_image_call(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unbilled_usage", True)
    persona = _persona(visual_locked_at=datetime.now(UTC), visual_ref_path="/tmp/face.png")
    images: list[str] = []

    async def _load(persona_id, *, user_id):
        return persona

    monkeypatch.setattr(repo, "get", _load)
    from marketer.personas import visual as persona_visual

    async def _lock(*a, **k):
        images.append("ran")
        return "/tmp/new.png"

    monkeypatch.setattr(persona_visual, "lock_reference", _lock)

    resp = client.post(f"/api/v1/personas/{persona.id}/visual", headers=AUTH)
    assert resp.status_code == 409
    assert images == []


def test_create_with_foreign_niche_is_404(client, monkeypatch):
    created: list[str] = []

    async def _niche_get(niche_id, *, user_id):
        return None

    async def _create(**kwargs):
        created.append(kwargs.get("name", ""))
        raise AssertionError("persona must not be created for a foreign niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(repo, "create", _create)

    resp = client.post(
        "/api/v1/personas",
        json={"name": "Sol", "niche_id": str(NICHE)},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert created == []


def test_empty_thread_returns_greeting_without_writing(client, monkeypatch):
    persona = _persona(greeting="Hey there.")
    writes: list[str] = []

    async def _load(persona_id, *, user_id):
        return persona

    async def _history(persona_id, *, user_id, limit):
        return []

    async def _clear(*a, **k):
        writes.append("mutated")

    monkeypatch.setattr(repo, "get", _load)
    monkeypatch.setattr(repo, "list_messages", _history)
    monkeypatch.setattr(repo, "append_turn", _clear)

    resp = client.get(f"/api/v1/personas/{persona.id}/messages", headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["role"] == "assistant"
    assert body[0]["content"] == "Hey there."
    assert writes == []
