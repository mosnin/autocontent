"""Unit tests for the ``Idempotency-Key`` HTTP middleware
(``backend.idempotency_api``): key derivation, passthrough for
GET/no-header requests, first-request claim + cache, replay with the
``Idempotency-Replayed`` header, body-hash conflict -> 422, in-flight
duplicate -> 409, and fail-open when the dedup store errors.

No real DB: ``idempotency_repo`` is monkeypatched to an in-memory fake and
auth resolution is monkeypatched directly on the module (the middleware
calls ``require_user`` as a plain function, not through FastAPI's
dependency-injection, so ``app.dependency_overrides`` doesn't reach it).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import Response

from backend import idempotency_api


# ---------------------------------------------------------------------------
# Key / hash derivation (pure functions, no app needed)
# ---------------------------------------------------------------------------


def test_derive_storage_key_differs_by_user():
    a = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k1")
    b = idempotency_api.derive_storage_key("user_b", "POST", "/items", "k1")
    assert a != b


def test_derive_storage_key_differs_by_method():
    a = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k1")
    b = idempotency_api.derive_storage_key("user_a", "DELETE", "/items", "k1")
    assert a != b


def test_derive_storage_key_differs_by_path():
    a = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k1")
    b = idempotency_api.derive_storage_key("user_a", "POST", "/other", "k1")
    assert a != b


def test_derive_storage_key_differs_by_key():
    a = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k1")
    b = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k2")
    assert a != b


def test_derive_storage_key_stable_for_same_tuple():
    a = idempotency_api.derive_storage_key("user_a", "POST", "/items", "k1")
    b = idempotency_api.derive_storage_key("user_a", "post", "/items", "k1")
    assert a == b  # method comparison is case-insensitive


def test_hash_body_deterministic_and_sensitive_to_content():
    h1 = idempotency_api.hash_body(b'{"a":1}')
    h2 = idempotency_api.hash_body(b'{"a":1}')
    h3 = idempotency_api.hash_body(b'{"a":2}')
    assert h1 == h2
    assert h1 != h3


# ---------------------------------------------------------------------------
# In-memory fake store standing in for marketer.repos.idempotency
# ---------------------------------------------------------------------------


@dataclass
class _Ctx:
    user_id: str


class _FakeStore:
    """Mimics the repo's claim/get_record/record_body_hash/store_response
    contract in memory: first claim of a key wins, everything else is
    bookkeeping keyed off that."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.raise_on_claim: Exception | None = None
        self.raise_on_get_record: Exception | None = None

    async def claim(self, key: str, *, ttl_seconds: int | None = None) -> bool:
        if self.raise_on_claim is not None:
            raise self.raise_on_claim
        if key in self.rows:
            return False
        self.rows[key] = {"status": "claimed", "body_hash": None, "response": None}
        return True

    async def record_body_hash(self, key: str, body_hash: str) -> None:
        row = self.rows.get(key)
        if row is not None:
            row["body_hash"] = body_hash

    async def get_record(self, key: str) -> dict | None:
        if self.raise_on_get_record is not None:
            raise self.raise_on_get_record
        return self.rows.get(key)

    async def store_response(self, key: str, *, body_hash: str, status: int, headers: dict, body: str) -> None:
        self.rows[key] = {
            "status": "done",
            "body_hash": body_hash,
            "response": {"status": status, "headers": headers, "body": body},
        }


def _build_app(monkeypatch, store: _FakeStore, *, user_id: str = "user_abc", raw_body_route: bool = False):
    monkeypatch.setattr(idempotency_api, "idempotency_repo", store)

    async def _fake_require_user(request):
        return _Ctx(user_id=user_id)

    monkeypatch.setattr(idempotency_api, "require_user", _fake_require_user)

    app = FastAPI()
    app.add_middleware(idempotency_api.IdempotencyMiddleware)

    calls = {"count": 0}

    @app.post("/items")
    async def create_item(payload: dict):
        calls["count"] += 1
        return {"id": calls["count"], "received": payload}

    @app.get("/items")
    async def list_items():
        calls["count"] += 1
        return {"count": calls["count"]}

    if raw_body_route:
        @app.post("/binary")
        async def create_binary():
            calls["count"] += 1
            return Response(content=b"\xff\xfe\x00binary", media_type="application/octet-stream")

    return app, calls


def _client(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Passthrough: no header, and GET, do zero dedup work
# ---------------------------------------------------------------------------


def test_no_header_passes_through_untouched(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r1 = client.post("/items", json={"a": 1})
    r2 = client.post("/items", json={"a": 1})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert calls["count"] == 2  # handler ran twice — no dedup without the header
    assert store.rows == {}  # middleware never touched the store


def test_get_with_header_passes_through_untouched(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r1 = client.get("/items", headers={"Idempotency-Key": "k1"})
    r2 = client.get("/items", headers={"Idempotency-Key": "k1"})

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert calls["count"] == 2  # GET is never deduped, even with the header
    assert store.rows == {}


# ---------------------------------------------------------------------------
# First request claims + caches; identical replay returns the same body
# ---------------------------------------------------------------------------


def test_first_request_runs_handler_and_caches(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 200
    assert calls["count"] == 1
    assert len(store.rows) == 1
    row = next(iter(store.rows.values()))
    assert row["status"] == "done"
    assert row["response"]["status"] == 200


def test_replay_returns_stored_response_without_rerunning_handler(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r1 = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})
    r2 = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert calls["count"] == 1  # handler executed exactly once
    assert r1.json() == r2.json()
    assert r2.headers.get("idempotency-replayed") == "true"
    assert "idempotency-replayed" not in r1.headers


def test_different_key_is_a_distinct_unit_of_work(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})
    r2 = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k2"})

    assert calls["count"] == 2
    assert r2.headers.get("idempotency-replayed") is None


def test_same_key_different_user_does_not_collide(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store, user_id="user_a")
    client = _client(app)
    client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    # Same store, same key, but a different authenticated user.
    async def _fake_require_user_b(request):
        return _Ctx(user_id="user_b")

    monkeypatch.setattr(idempotency_api, "require_user", _fake_require_user_b)
    r2 = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert calls["count"] == 2  # a distinct unit of work for user_b
    assert r2.headers.get("idempotency-replayed") is None


# ---------------------------------------------------------------------------
# Body-hash conflict: same key, different body -> 422 (never a replay,
# never a second execution of the ORIGINAL request)
# ---------------------------------------------------------------------------


def test_same_key_different_body_after_completion_is_422(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r1 = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})
    r2 = client.post("/items", json={"a": 2}, headers={"Idempotency-Key": "k1"})

    assert r1.status_code == 200
    assert r2.status_code == 422
    assert calls["count"] == 1  # handler never ran for the conflicting body


def test_same_key_different_body_while_in_flight_is_422(monkeypatch):
    store = _FakeStore()
    key = idempotency_api.derive_storage_key("user_abc", "POST", "/items", "k1")
    store.rows[key] = {
        "status": "claimed",
        "body_hash": idempotency_api.hash_body(b'{"a": 1}'),
        "response": None,
    }
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r = client.post("/items", json={"a": 2}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 422
    assert calls["count"] == 0


# ---------------------------------------------------------------------------
# In-flight duplicate (same body, not yet done) -> 409, handler not re-run
# ---------------------------------------------------------------------------


def test_in_flight_duplicate_same_body_is_409(monkeypatch):
    store = _FakeStore()
    body_hash = idempotency_api.hash_body(b'{"a":1}')
    key = idempotency_api.derive_storage_key("user_abc", "POST", "/items", "k1")
    store.rows[key] = {"status": "claimed", "body_hash": body_hash, "response": None}
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r = client.post("/items", content=b'{"a":1}', headers={
        "Idempotency-Key": "k1",
        "Content-Type": "application/json",
    })

    assert r.status_code == 409
    assert calls["count"] == 0  # must NOT double-execute
    assert "processed" in r.json()["error"]["message"]


def test_in_flight_duplicate_hash_not_yet_recorded_is_409(monkeypatch):
    """The tiny window between claim() succeeding and record_body_hash()
    landing: body_hash is still None. Treated conservatively as
    still-processing (409), never as an automatic conflict or replay."""
    store = _FakeStore()
    key = idempotency_api.derive_storage_key("user_abc", "POST", "/items", "k1")
    store.rows[key] = {"status": "claimed", "body_hash": None, "response": None}
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    r = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 409
    assert calls["count"] == 0


# ---------------------------------------------------------------------------
# Fail-open on a dedup-store outage (claim path only)
# ---------------------------------------------------------------------------


def test_fail_open_when_claim_raises(monkeypatch, caplog):
    store = _FakeStore()
    store.raise_on_claim = ConnectionError("store down")
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    with caplog.at_level("ERROR"):
        r = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 200
    assert calls["count"] == 1  # request still ran despite the store being down
    assert any("fail open" in rec.message.lower() or "store unreachable" in rec.message.lower() for rec in caplog.records)


def test_fail_open_when_reading_existing_claim_raises(monkeypatch, caplog):
    store = _FakeStore()
    key = idempotency_api.derive_storage_key("user_abc", "POST", "/items", "k1")
    store.rows[key] = {"status": "claimed", "body_hash": None, "response": None}
    store.raise_on_get_record = ConnectionError("store down")
    app, calls = _build_app(monkeypatch, store)
    client = _client(app)

    with caplog.at_level("ERROR"):
        r = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 200
    assert calls["count"] == 1  # ran the handler rather than wedging on the read error


# ---------------------------------------------------------------------------
# Auth resolution failure: middleware steps aside, doesn't invent its own 401
# ---------------------------------------------------------------------------


def test_auth_failure_falls_through_untouched(monkeypatch):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store)

    async def _boom(request):
        raise Exception("bad token")

    monkeypatch.setattr(idempotency_api, "require_user", _boom)
    client = _client(app)

    r = client.post("/items", json={"a": 1}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 200  # this toy app has no real auth dependency;
    assert calls["count"] == 1   # the point is the middleware didn't block it itself
    assert store.rows == {}


# ---------------------------------------------------------------------------
# Non-UTF8 response body: caching is skipped, but the live response is
# unaffected (documented limitation — this app's routes are all JSON).
# ---------------------------------------------------------------------------


def test_non_utf8_response_skips_caching_but_still_returns(monkeypatch, caplog):
    store = _FakeStore()
    app, calls = _build_app(monkeypatch, store, raw_body_route=True)
    client = _client(app)

    with caplog.at_level("WARNING"):
        r = client.post("/binary", json={}, headers={"Idempotency-Key": "k1"})

    assert r.status_code == 200
    assert calls["count"] == 1
    key = idempotency_api.derive_storage_key("user_abc", "POST", "/binary", "k1")
    # Claimed, but never marked done since the response couldn't be cached.
    assert store.rows[key]["status"] == "claimed"
