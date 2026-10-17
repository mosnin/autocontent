"""Route-level tests for /api/v1/dramas.

Repos and Modal are stubbed; auth is overridden. The suite exists for
ownership and retry-claim: a foreign niche or drama must not create a
row or spawn a pipeline, and a non-failed / concurrent retry must 409
without a second spawn. Unbilled 402 is already pinned in
test_hosted_money_contract.py.
"""
from __future__ import annotations

import sys
import types
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.drama.schemas import Character, Drama, DramaPlan, DramaStatus
from marketer.repos import dramas as dramas_repo
from marketer.repos import niches as niches_repo

USER = "user_dramas"
AUTH = {"Authorization": "Bearer mkt_x"}
NICHE = UUID("22222222-2222-2222-2222-222222222222")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _drama(*, drama_id=None, user_id=USER, status=DramaStatus.queued, **over) -> Drama:
    base = dict(
        id=drama_id or uuid4(),
        user_id=user_id,
        niche_id=NICHE,
        status=status,
        idea="a coffee heist",
        created_at=datetime.now(UTC),
    )
    base.update(over)
    return Drama(**base)


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
def env(monkeypatch):
    _reset_limiter()
    spawned: list[tuple] = []

    class _FakeFn:
        def spawn(self, *a):
            spawned.append(a)

    monkeypatch.setitem(
        sys.modules,
        "modal",
        types.SimpleNamespace(
            Function=types.SimpleNamespace(from_name=lambda app, name: _FakeFn())
        ),
    )
    return _client(monkeypatch), spawned


def test_enqueue_foreign_niche_is_404_without_row_or_spawn(env, monkeypatch):
    client, spawned = env
    created: list[str] = []

    async def _niche_get(niche_id, *, user_id):
        return None

    async def _create(**kwargs):
        created.append(kwargs.get("user_id", ""))
        raise AssertionError("drama row must not be created for a foreign niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(dramas_repo, "create", _create)

    resp = client.post(
        "/api/v1/dramas",
        json={"niche_id": str(NICHE), "idea": "a coffee heist"},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert created == []
    assert spawned == []


def test_enqueue_own_niche_creates_and_spawns_once(env, monkeypatch):
    client, spawned = env
    row = _drama()

    async def _niche_get(niche_id, *, user_id):
        assert user_id == USER
        return types.SimpleNamespace(id=niche_id)

    async def _create(**kwargs):
        assert kwargs["user_id"] == USER
        assert kwargs["niche_id"] == NICHE
        return row

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(dramas_repo, "create", _create)

    resp = client.post(
        "/api/v1/dramas",
        json={"niche_id": str(NICHE), "idea": "a coffee heist"},
        headers=AUTH,
    )
    assert resp.status_code == 202
    assert resp.json()["id"] == str(row.id)
    assert spawned == [(USER, str(row.id))]


def test_enqueue_requires_idea_or_script(env):
    client, spawned = env
    resp = client.post(
        "/api/v1/dramas",
        json={"niche_id": str(NICHE), "idea": "   "},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert spawned == []


def test_retry_failed_claims_and_spawns_once(env, monkeypatch):
    client, spawned = env
    row = _drama(status=DramaStatus.queued)
    claims = {"n": 0}

    async def _claim(drama_id, *, user_id):
        claims["n"] += 1
        assert user_id == USER
        return row

    monkeypatch.setattr(dramas_repo, "claim_for_retry", _claim)

    resp = client.post(f"/api/v1/dramas/{row.id}/retry", headers=AUTH)
    assert resp.status_code == 202
    assert claims["n"] == 1
    assert spawned == [(USER, str(row.id))]


def test_retry_not_failed_is_409_without_spawn(env, monkeypatch):
    client, spawned = env
    existing = _drama(status=DramaStatus.rendering)

    async def _claim(drama_id, *, user_id):
        return None

    async def _get(drama_id, *, user_id):
        return existing

    monkeypatch.setattr(dramas_repo, "claim_for_retry", _claim)
    monkeypatch.setattr(dramas_repo, "get", _get)

    resp = client.post(f"/api/v1/dramas/{existing.id}/retry", headers=AUTH)
    assert resp.status_code == 409
    assert "rendering" in resp.json()["detail"]
    assert spawned == []


def test_retry_foreign_is_404_without_spawn(env, monkeypatch):
    client, spawned = env

    async def _claim(drama_id, *, user_id):
        return None

    async def _get(drama_id, *, user_id):
        return None

    monkeypatch.setattr(dramas_repo, "claim_for_retry", _claim)
    monkeypatch.setattr(dramas_repo, "get", _get)

    resp = client.post(f"/api/v1/dramas/{uuid4()}/retry", headers=AUTH)
    assert resp.status_code == 404
    assert spawned == []


def test_get_foreign_drama_is_404(env, monkeypatch):
    client, _ = env

    async def _get(drama_id, *, user_id):
        return None

    monkeypatch.setattr(dramas_repo, "get", _get)
    resp = client.get(f"/api/v1/dramas/{uuid4()}", headers=AUTH)
    assert resp.status_code == 404


def test_character_image_rejects_traversal_id(env, monkeypatch):
    """character_id is looked up in the plan — never used as a filesystem path."""
    client, _ = env
    row = _drama(
        plan=DramaPlan(
            cast=[
                Character(
                    id="hero",
                    name="Hero",
                    reference_image_path="/tmp/hero.png",
                )
            ]
        )
    )

    async def _get(drama_id, *, user_id):
        return row if user_id == USER else None

    monkeypatch.setattr(dramas_repo, "get", _get)
    # Path-shaped ids must not be treated as filesystem paths — lookup is
    # plan.character_by_id only, so a miss is 404 with no FileResponse.
    resp = client.get(
        f"/api/v1/dramas/{row.id}/characters/..%2Fetc%2Fpasswd/image",
        headers=AUTH,
    )
    assert resp.status_code == 404
