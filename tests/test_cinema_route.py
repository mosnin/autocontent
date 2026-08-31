"""HTTP tests for /api/v1/cinema — catalog is code; saved rows are user-scoped.

The catalog/compose endpoints are pure (no spend). Saved selections are
the stateful half: a typo must 422 before persist, and a foreign id must
be indistinguishable from missing (404, no delete).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.cinema.presets import CinemaSelection
from marketer.config import settings
from marketer.repos import cinema_presets as saved_repo
from marketer.repos.cinema_presets import SavedCinemaPreset

USER = "user_cinema"
AUTH = {"Authorization": "Bearer mkt_x"}


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=USER, email="c@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _saved(*, saved_id: UUID | None = None, name: str = "My look") -> SavedCinemaPreset:
    now = datetime.now(timezone.utc)
    return SavedCinemaPreset(
        id=saved_id or uuid4(),
        user_id=USER,
        name=name,
        preset_key="classic_anamorphic",
        selection=CinemaSelection(),
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def client(monkeypatch) -> TestClient:
    _reset_limiter()
    return _client(monkeypatch)


def test_cinema_routes_require_auth(monkeypatch):
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.main import create_app

    unauth = TestClient(create_app(), raise_server_exceptions=False)
    saved_id = uuid4()
    assert unauth.get("/api/v1/cinema/presets").status_code == 401
    assert unauth.get("/api/v1/cinema/saved").status_code == 401
    assert unauth.post("/api/v1/cinema/compose", json={"subject": "x"}).status_code == 401
    assert unauth.post("/api/v1/cinema/saved", json={"name": "x"}).status_code == 401
    assert unauth.delete(f"/api/v1/cinema/saved/{saved_id}").status_code == 401


def test_compose_unknown_preset_is_422(client):
    resp = client.post(
        "/api/v1/cinema/compose",
        json={"subject": "a diner", "preset_key": "not_a_real_preset"},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert "not_a_real_preset" in resp.json()["detail"]


def test_compose_unknown_override_key_is_422(client):
    resp = client.post(
        "/api/v1/cinema/compose",
        json={"subject": "a diner", "overrides": {"lens_key": "no_such_lens"}},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert "no_such_lens" in resp.json()["detail"]


def test_compose_valid_preset_returns_prompt(client):
    resp = client.post(
        "/api/v1/cinema/compose",
        json={"subject": "a diner at night", "preset_key": "classic_anamorphic"},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "diner" in body["prompt"]
    assert body["motion_prompt"]


def test_save_unknown_preset_does_not_persist(client, monkeypatch):
    saved: list[dict] = []

    async def _save(**kwargs):
        saved.append(kwargs)
        return _saved()

    monkeypatch.setattr(saved_repo, "save", _save)
    resp = client.post(
        "/api/v1/cinema/saved",
        json={"name": "Broken", "preset_key": "not_a_real_preset"},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert "not_a_real_preset" in resp.json()["detail"]
    assert saved == []


def test_save_is_scoped_to_caller(client, monkeypatch):
    seen: dict = {}

    async def _save(**kwargs):
        seen.update(kwargs)
        return _saved(name=kwargs["name"])

    monkeypatch.setattr(saved_repo, "save", _save)
    resp = client.post(
        "/api/v1/cinema/saved",
        json={"name": "Blockbuster", "preset_key": "classic_anamorphic"},
        headers=AUTH,
    )
    assert resp.status_code == 201, resp.text
    assert seen["user_id"] == USER
    assert seen["name"] == "Blockbuster"
    assert seen["preset_key"] == "classic_anamorphic"
    assert resp.json()["name"] == "Blockbuster"


def test_list_saved_is_scoped_to_caller(client, monkeypatch):
    seen: list[str] = []

    async def _list(user_id):
        seen.append(user_id)
        return [_saved(name="Mine")]

    monkeypatch.setattr(saved_repo, "list_for_user", _list)
    resp = client.get("/api/v1/cinema/saved", headers=AUTH)
    assert resp.status_code == 200
    assert seen == [USER]
    assert resp.json()[0]["name"] == "Mine"


def test_delete_foreign_or_missing_is_404(client, monkeypatch):
    deleted: list[tuple] = []

    async def _delete(saved_id, *, user_id):
        deleted.append((saved_id, user_id))
        return False

    monkeypatch.setattr(saved_repo, "delete", _delete)
    saved_id = uuid4()
    resp = client.delete(f"/api/v1/cinema/saved/{saved_id}", headers=AUTH)
    assert resp.status_code == 404
    assert deleted == [(saved_id, USER)]


def test_delete_own_is_204(client, monkeypatch):
    async def _delete(saved_id, *, user_id):
        assert user_id == USER
        return True

    monkeypatch.setattr(saved_repo, "delete", _delete)
    resp = client.delete(f"/api/v1/cinema/saved/{uuid4()}", headers=AUTH)
    assert resp.status_code == 204
