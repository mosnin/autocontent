"""Real-Postgres coverage for the ``Idempotency-Key`` HTTP middleware
(``backend.idempotency_api``): a genuine duplicate POST against a tiny
mounted app, backed by the real ``idempotency_keys`` table, must return
the cached response and must NOT re-run the handler.

Requires MARKETER_DATABASE_URL pointed at a real Postgres (see
tests/integration/test_pg_idempotency.py for the pattern this follows).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from idempotency_keys")


@dataclass
class _Ctx:
    user_id: str


def _build_app(monkeypatch, *, user_id: str, raise_get_pool: bool = False):
    """A tiny FastAPI app wrapped with the real middleware, wired to the
    real ``marketer.repos.idempotency`` module (i.e. the real DB pool via
    the ``pool`` fixture) — only auth resolution is faked, since standing
    up real Clerk/PAT auth isn't the point of this test."""
    from backend import idempotency_api

    async def _fake_require_user(request):
        return _Ctx(user_id=user_id)

    monkeypatch.setattr(idempotency_api, "require_user", _fake_require_user)

    app = FastAPI()
    app.add_middleware(idempotency_api.IdempotencyMiddleware)

    calls = {"count": 0}

    @app.post("/widgets")
    async def create_widget(payload: dict):
        calls["count"] += 1
        return {"call_number": calls["count"], "received": payload}

    return app, calls


async def _client(app) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# The core promise: a real duplicate POST is served from cache, not re-run
# ---------------------------------------------------------------------------


async def test_duplicate_post_returns_cached_response_and_does_not_rerun_handler(pool, monkeypatch):
    app, calls = _build_app(monkeypatch, user_id=f"user_{uuid4().hex}")
    key = f"integration-{uuid4().hex}"
    payload = {"name": "widget-1"}

    async with await _client(app) as client:
        r1 = await client.post("/widgets", json=payload, headers={"Idempotency-Key": key})
        r2 = await client.post("/widgets", json=payload, headers={"Idempotency-Key": key})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert calls["count"] == 1  # the handler executed exactly once across both requests
    assert r1.json() == r2.json()
    assert r2.headers.get("idempotency-replayed") == "true"
    assert "idempotency-replayed" not in r1.headers

    # Confirm the row actually landed in the real table with the shape the
    # middleware expects to read back.
    rows = await pool.fetch("select key, status, result from idempotency_keys")
    assert len(rows) == 1
    assert rows[0]["status"] == "done"


async def test_three_concurrent_duplicate_posts_handler_runs_once(pool, monkeypatch):
    """Fire several identical requests concurrently against the real store
    and confirm exactly one of them actually executed the handler — the
    others either got the in-flight 409 or, if they landed after
    completion, the replayed 200."""
    import asyncio

    app, calls = _build_app(monkeypatch, user_id=f"user_{uuid4().hex}")
    key = f"integration-{uuid4().hex}"
    payload = {"name": "widget-concurrent"}

    async with await _client(app) as client:
        responses = await asyncio.gather(
            *[
                client.post("/widgets", json=payload, headers={"Idempotency-Key": key})
                for _ in range(5)
            ]
        )

    assert calls["count"] == 1
    statuses = sorted(r.status_code for r in responses)
    # Whichever request wins the claim (200, freshly executed) and any that
    # land after it completes (200, replayed) both report 200; anything
    # that lands while it's still in flight gets 409. None may ever be a
    # 422 — same key, same body throughout. The one invariant regardless
    # of scheduling is calls["count"] == 1, asserted above.
    assert all(s in (200, 409) for s in statuses)
    assert statuses.count(200) >= 1


async def test_different_body_same_key_conflicts_after_completion(pool, monkeypatch):
    app, calls = _build_app(monkeypatch, user_id=f"user_{uuid4().hex}")
    key = f"integration-{uuid4().hex}"

    async with await _client(app) as client:
        r1 = await client.post("/widgets", json={"name": "a"}, headers={"Idempotency-Key": key})
        r2 = await client.post("/widgets", json={"name": "different"}, headers={"Idempotency-Key": key})

    assert r1.status_code == 200
    assert r2.status_code == 422
    assert calls["count"] == 1


async def test_different_users_same_key_both_execute(pool, monkeypatch):
    from backend import idempotency_api

    app, calls = _build_app(monkeypatch, user_id="user_one")
    key = f"integration-{uuid4().hex}"
    payload = {"name": "widget-shared-key"}

    async with await _client(app) as client:
        r1 = await client.post("/widgets", json=payload, headers={"Idempotency-Key": key})

        async def _fake_require_user_two(request):
            return _Ctx(user_id="user_two")

        monkeypatch.setattr(idempotency_api, "require_user", _fake_require_user_two)
        r2 = await client.post("/widgets", json=payload, headers={"Idempotency-Key": key})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert calls["count"] == 2  # distinct users -> distinct storage keys -> both ran
