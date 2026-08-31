"""HTTP ownership for /api/v1/kits.

Repo tests in integration/test_pg_kits.py prove the SQL is user-scoped.
Nothing on main hits the route, so a dropped ``user_id=ctx.user_id`` on
get/update/delete would 200 someone else's skill (or erase it) without
CI noticing. Kits steer agent prompts and ad proposals.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.models import Kit

_USER_ID = "user_kits_test"
_KIT_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


def _kit(*, user_id: str = _USER_ID, kit_id: UUID | None = None) -> Kit:
    return Kit(
        id=kit_id or _KIT_ID,
        user_id=user_id,
        kind="design",
        name="desk",
        description="",
        content="keep the camera still",
        rules={},
        is_default=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def test_list_kits_forwards_caller_id(monkeypatch):
    import marketer.repos.kits as kits_repo

    seen: list[tuple] = []

    async def _list(user_id, *, kind=None):
        seen.append((user_id, kind))
        return [_kit()]

    monkeypatch.setattr(kits_repo, "list_for_user", _list)
    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/kits?kind=design")
    assert resp.status_code == 200
    assert seen == [(_USER_ID, "design")]
    assert resp.json()[0]["name"] == "desk"


def test_create_kit_stamps_caller_id(monkeypatch):
    import marketer.repos.kits as kits_repo

    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _kit()

    monkeypatch.setattr(kits_repo, "create", _create)
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/kits",
        json={"kind": "writing", "name": "voice", "content": "short sentences"},
    )
    assert resp.status_code == 201
    assert captured["user_id"] == _USER_ID
    assert captured["kind"] == "writing"
    assert captured["name"] == "voice"


def test_get_foreign_or_missing_kit_is_404(monkeypatch):
    import marketer.repos.kits as kits_repo

    async def _get(kit_id, *, user_id):
        assert user_id == _USER_ID
        return None

    monkeypatch.setattr(kits_repo, "get", _get)
    client = _make_authed_client(monkeypatch)
    resp = client.get(f"/api/v1/kits/{uuid4()}")
    assert resp.status_code == 404


def test_update_foreign_kit_is_404(monkeypatch):
    import marketer.repos.kits as kits_repo

    seen: list[tuple] = []

    async def _update(kit_id, *, user_id, **kwargs):
        seen.append((kit_id, user_id))
        return None

    monkeypatch.setattr(kits_repo, "update", _update)
    client = _make_authed_client(monkeypatch)
    resp = client.put(f"/api/v1/kits/{_KIT_ID}", json={"name": "stolen"})
    assert resp.status_code == 404
    assert seen == [(_KIT_ID, _USER_ID)]


def test_delete_foreign_kit_is_404_and_does_not_claim_success(monkeypatch):
    import marketer.repos.kits as kits_repo

    seen: list[tuple] = []

    async def _delete(kit_id, *, user_id):
        seen.append((kit_id, user_id))
        return False

    monkeypatch.setattr(kits_repo, "delete", _delete)
    client = _make_authed_client(monkeypatch)
    resp = client.delete(f"/api/v1/kits/{_KIT_ID}")
    assert resp.status_code == 404
    assert seen == [(_KIT_ID, _USER_ID)]


def test_delete_own_kit_is_204(monkeypatch):
    import marketer.repos.kits as kits_repo

    async def _delete(kit_id, *, user_id):
        assert user_id == _USER_ID
        return True

    monkeypatch.setattr(kits_repo, "delete", _delete)
    client = _make_authed_client(monkeypatch)
    resp = client.delete(f"/api/v1/kits/{_KIT_ID}")
    assert resp.status_code == 204
