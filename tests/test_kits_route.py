"""Kit HTTP routes: tenant isolation and validation.

Kits inject instructions into agents (including ad proposers). A missed
user_id scope would let one tenant read or mutate another tenant's skills.
"""
from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import Kit

_USER = "user_kits_1"
_KIT_ID = UUID("66666666-6666-6666-6666-666666666666")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _kit(**kw) -> Kit:
    base = {
        "id": _KIT_ID,
        "user_id": _USER,
        "kind": "design",
        "name": "Voice",
        "description": "",
        "content": "keep it short",
        "rules": {},
        "is_default": False,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    base.update(kw)
    return Kit(**base)


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=_USER, email="k@k.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_list_kits_is_scoped_to_caller(monkeypatch):
    _reset_limiter()
    import marketer.repos.kits as kits_repo

    seen: list[str] = []

    async def _list(user_id, *, kind=None):
        seen.append(user_id)
        return [_kit()]

    monkeypatch.setattr(kits_repo, "list_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/kits", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert seen == [_USER]
    assert resp.json()[0]["user_id"] == _USER


def test_create_kit_stamps_caller_user_id(monkeypatch):
    _reset_limiter()
    import marketer.repos.kits as kits_repo

    created: dict = {}

    async def _create(**kw):
        created.update(kw)
        return _kit(kind=kw["kind"], name=kw["name"], content=kw["content"])

    monkeypatch.setattr(kits_repo, "create", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/kits",
        json={"kind": "writing", "name": "Tone", "content": "no hype"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201
    assert created["user_id"] == _USER
    assert created["kind"] == "writing"


def test_get_update_delete_foreign_kit_404(monkeypatch):
    """Repo miss (other tenant or unknown id) must 404, never leak."""
    _reset_limiter()
    import marketer.repos.kits as kits_repo

    async def _none(*a, **k):
        return None

    async def _delete(*a, **k):
        return False

    monkeypatch.setattr(kits_repo, "get", _none)
    monkeypatch.setattr(kits_repo, "update", _none)
    monkeypatch.setattr(kits_repo, "delete", _delete)
    client = _client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_x"}
    foreign = uuid4()
    assert client.get(f"/api/v1/kits/{foreign}", headers=headers).status_code == 404
    assert client.put(
        f"/api/v1/kits/{foreign}", json={"name": "x"}, headers=headers
    ).status_code == 404
    assert client.delete(f"/api/v1/kits/{foreign}", headers=headers).status_code == 404


def test_create_kit_rejects_unknown_kind_and_oversize(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_x"}
    resp = client.post(
        "/api/v1/kits",
        json={"kind": "ops", "name": "Nope"},
        headers=headers,
    )
    assert resp.status_code == 422

    from marketer.repos.kits import MAX_CONTENT_CHARS

    resp = client.post(
        "/api/v1/kits",
        json={"kind": "design", "name": "Huge", "content": "x" * (MAX_CONTENT_CHARS + 1)},
        headers=headers,
    )
    assert resp.status_code == 422


def test_kits_without_auth_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.main import create_app

    client = TestClient(create_app(), raise_server_exceptions=False)
    assert client.get("/api/v1/kits").status_code == 401
    assert client.post("/api/v1/kits", json={"kind": "design", "name": "x"}).status_code == 401
