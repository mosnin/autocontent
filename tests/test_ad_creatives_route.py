"""Route-level tests for /api/v1/ad-creatives.

Repos, Modal, and the Context.dev flag are stubbed. The properties this
suite pins are: unbilled generate never writes a run, a private/internal
domain is 422 (SSRF), a foreign niche is 404, and a slot retry claims
once — a second click or a foreign slot does not spawn another render.
"""
from __future__ import annotations

import sys
import types
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.repos import ad_creatives as runs_repo
from marketer.repos import niches as niches_repo

USER = "user_adcr"
AUTH = {"Authorization": "Bearer mkt_x"}
NICHE = UUID("44444444-4444-4444-4444-444444444444")


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _run(*, run_id=None, domain="stripe.com") -> dict:
    return {
        "id": run_id or uuid4(),
        "user_id": USER,
        "domain": domain,
        "niche_id": None,
        "status": "queued",
    }


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import ad_creatives as ad_routes

    monkeypatch.setattr(ad_routes, "is_configured", lambda: True)

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


def test_create_unbilled_is_402_without_row_or_spawn(env, monkeypatch):
    client, spawned = env
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)
    created: list[str] = []

    async def _create(**kwargs):
        created.append(kwargs.get("domain", ""))
        raise AssertionError("ad run must not be created when unbilled is refused")

    monkeypatch.setattr(runs_repo, "create_run", _create)

    resp = client.post(
        "/api/v1/ad-creatives",
        json={"domain": "stripe.com"},
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert created == []
    assert spawned == []


def test_create_private_host_is_422_without_spawn(env, monkeypatch):
    client, spawned = env
    created: list[str] = []

    async def _create(**kwargs):
        created.append(kwargs.get("domain", ""))
        raise AssertionError("internal host must not become a run")

    monkeypatch.setattr(runs_repo, "create_run", _create)

    for host in ("169.254.169.254", "localhost", "http://127.0.0.1/latest"):
        resp = client.post(
            "/api/v1/ad-creatives",
            json={"domain": host},
            headers=AUTH,
        )
        assert resp.status_code == 422, host
    assert created == []
    assert spawned == []


def test_create_foreign_niche_is_404_without_spawn(env, monkeypatch):
    client, spawned = env
    created: list[str] = []

    async def _niche_get(niche_id, *, user_id):
        return None

    async def _create(**kwargs):
        created.append("ran")
        raise AssertionError("run must not be created for a foreign niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(runs_repo, "create_run", _create)

    resp = client.post(
        "/api/v1/ad-creatives",
        json={"domain": "stripe.com", "niche_id": str(NICHE)},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert created == []
    assert spawned == []


def test_create_own_domain_spawns_once(env, monkeypatch):
    client, spawned = env
    row = _run()

    async def _create(*, user_id, domain, niche_id=None):
        assert user_id == USER
        assert domain == "stripe.com"
        return row

    monkeypatch.setattr(runs_repo, "create_run", _create)

    resp = client.post(
        "/api/v1/ad-creatives",
        json={"domain": "https://www.stripe.com/pricing"},
        headers=AUTH,
    )
    assert resp.status_code == 202
    assert spawned == [(USER, str(row["id"]))]


def test_retry_failed_slot_spawns_once_then_409(env, monkeypatch):
    client, spawned = env
    run_id = uuid4()
    slot_id = uuid4()
    claims = {"n": 0}

    async def _get_slot(sid, *, user_id):
        assert user_id == USER
        return {"id": sid, "run_id": run_id, "status": "failed"}

    async def _claim(sid, *, user_id):
        claims["n"] += 1
        return claims["n"] == 1

    monkeypatch.setattr(runs_repo, "get_slot", _get_slot)
    monkeypatch.setattr(runs_repo, "claim_slot_for_retry", _claim)

    path = f"/api/v1/ad-creatives/{run_id}/slots/{slot_id}/retry"
    first = client.post(path, headers=AUTH)
    second = client.post(path, headers=AUTH)
    assert first.status_code == 202
    assert first.json()["status"] == "queued"
    assert second.status_code == 409
    assert spawned == [(USER, str(run_id), str(slot_id))]


def test_retry_foreign_or_mismatched_slot_is_404(env, monkeypatch):
    client, spawned = env
    run_id = uuid4()
    claimed: list[UUID] = []

    async def _missing(sid, *, user_id):
        return None

    async def _claim(sid, *, user_id):
        claimed.append(sid)
        return True

    monkeypatch.setattr(runs_repo, "get_slot", _missing)
    monkeypatch.setattr(runs_repo, "claim_slot_for_retry", _claim)

    resp = client.post(
        f"/api/v1/ad-creatives/{run_id}/slots/{uuid4()}/retry",
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert claimed == []
    assert spawned == []

    other_run = uuid4()

    async def _wrong_run(sid, *, user_id):
        return {"id": sid, "run_id": other_run, "status": "failed"}

    monkeypatch.setattr(runs_repo, "get_slot", _wrong_run)
    resp = client.post(
        f"/api/v1/ad-creatives/{run_id}/slots/{uuid4()}/retry",
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert claimed == []
    assert spawned == []
