"""Tests for the API foundation modules: errors, pagination, openapi.

A tiny throwaway FastAPI app is built in-process (not the real
``backend.main`` app) so these tests exercise exactly the handlers/tools
this module ships, independent of the rest of the API's routes/auth/db.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.errors import (
    AppError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ProviderError,
    RateLimitedError,
    SpendCapExceededError,
    UnavailableError,
    ValidationFailedError,
    app_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from backend.openapi import SECURITY_SCHEME_NAME, customize_openapi
from backend.pagination import (
    MAX_LIMIT,
    Page,
    PageParams,
    build_page,
    decode_cursor,
    encode_cursor,
)


# ---------------------------------------------------------------------------
# Throwaway app
# ---------------------------------------------------------------------------

class Item(BaseModel):
    id: str
    created_at: datetime
    name: str


class Body(BaseModel):
    n: int


def _make_rows(count: int, *, start: datetime) -> list[Item]:
    return [
        Item(id=f"id-{i:03d}", created_at=start - timedelta(seconds=i), name=f"item-{i}")
        for i in range(count)
    ]


_ALL_ROWS = _make_rows(25, start=datetime(2026, 1, 1, tzinfo=timezone.utc))


def _make_app() -> FastAPI:
    app = FastAPI(title="foundation-test")

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.get("/boom/not-found")
    def _not_found():
        raise NotFoundError("widget not found")

    @app.get("/boom/forbidden")
    def _forbidden():
        raise ForbiddenError("nope")

    @app.get("/boom/conflict")
    def _conflict():
        raise ConflictError("already exists")

    @app.get("/boom/validation-failed")
    def _validation_failed():
        raise ValidationFailedError("bad input")

    @app.get("/boom/rate-limited")
    def _rate_limited():
        raise RateLimitedError("slow down")

    @app.get("/boom/spend-cap")
    def _spend_cap():
        raise SpendCapExceededError("cap exceeded")

    @app.get("/boom/provider")
    def _provider():
        raise ProviderError("upstream 500")

    @app.get("/boom/unavailable")
    def _unavailable():
        raise UnavailableError("try later")

    @app.get("/boom/http-exception")
    def _http_exc():
        raise HTTPException(404, "legacy not found")

    @app.get("/boom/http-exception-500")
    def _http_exc_500():
        raise HTTPException(500, "legacy internal detail leak attempt")

    @app.post("/boom/validation-body")
    def _validation_body(body: Body):
        return {"n": body.n}

    @app.get("/boom/unhandled")
    def _unhandled():
        raise RuntimeError("kaboom: secret_db_password=hunter2")

    @app.get("/items", response_model=Page[Item])
    def _list_items(params: PageParams = Depends()):
        position = params.position
        if position is None:
            remaining = _ALL_ROWS
        else:
            remaining = [
                r for r in _ALL_ROWS if (r.created_at, r.id) < (position.created_at, position.id)
            ]
        window = remaining[: params.limit + 1]
        return build_page(window, limit=params.limit, cursor_key=lambda r: (r.created_at, r.id))

    customize_openapi(app)
    return app


@pytest.fixture()
def client() -> TestClient:
    # raise_server_exceptions=False so unhandled exceptions caught by our
    # own Exception handler produce a normal HTTP response object here
    # instead of re-raising into the test (TestClient's default behaviour).
    return TestClient(_make_app(), raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# AppError subclasses -> envelope
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("path", "status_code", "code", "retryable"),
    [
        ("/boom/not-found", 404, "not_found", False),
        ("/boom/forbidden", 403, "forbidden", False),
        ("/boom/conflict", 409, "conflict", False),
        ("/boom/validation-failed", 422, "validation_failed", False),
        ("/boom/rate-limited", 429, "rate_limited", True),
        ("/boom/spend-cap", 402, "spend_cap_exceeded", False),
        ("/boom/provider", 502, "provider_error", True),
        ("/boom/unavailable", 503, "unavailable", True),
    ],
)
def test_app_error_envelope(client: TestClient, path, status_code, code, retryable):
    resp = client.get(path)
    assert resp.status_code == status_code
    body = resp.json()
    assert body["error"]["code"] == code
    assert body["error"]["retryable"] is retryable
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]
    # correlation id present as a response header, and a fresh one is minted
    # when the client didn't send one.
    assert resp.headers.get("x-request-id")


def test_request_id_echoed_when_client_supplies_one(client: TestClient):
    resp = client.get("/boom/not-found", headers={"X-Request-ID": "my-correlation-id"})
    assert resp.headers["x-request-id"] == "my-correlation-id"


# ---------------------------------------------------------------------------
# HTTPException backwards compatibility
# ---------------------------------------------------------------------------

def test_http_exception_maps_into_envelope(client: TestClient):
    resp = client.get("/boom/http-exception")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "legacy not found"
    assert body["error"]["retryable"] is False


def test_http_exception_500_does_not_leak_detail(client: TestClient):
    resp = client.get("/boom/http-exception-500")
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "internal_error"
    assert "leak attempt" not in body["error"]["message"]
    assert "secret" not in body["error"]["message"]


# ---------------------------------------------------------------------------
# RequestValidationError
# ---------------------------------------------------------------------------

def test_validation_error_maps_into_envelope(client: TestClient):
    resp = client.post("/boom/validation-body", json={"n": "not-an-int"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_failed"
    assert body["error"]["details"]["errors"]
    assert body["error"]["details"]["errors"][0]["loc"]


# ---------------------------------------------------------------------------
# Unhandled Exception -> generic 500, no leak, but logged with correlation id
# ---------------------------------------------------------------------------

def test_unhandled_exception_returns_generic_500(client: TestClient):
    resp = client.get("/boom/unhandled")
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "internal_error"
    assert "kaboom" not in body["error"]["message"]
    assert "hunter2" not in body["error"]["message"]
    assert body["error"]["retryable"] is True
    assert resp.headers.get("x-request-id")


# ---------------------------------------------------------------------------
# Cursor encode/decode
# ---------------------------------------------------------------------------

def test_cursor_round_trips():
    now = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    cursor = encode_cursor(now, "abc-123")
    position = decode_cursor(cursor)
    assert position is not None
    assert position.id == "abc-123"
    assert position.created_at == now


def test_decode_cursor_none_for_empty():
    assert decode_cursor(None) is None
    assert decode_cursor("") is None


def test_decode_cursor_rejects_tampered_value():
    from backend.pagination import CursorDecodeError

    now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    cursor = encode_cursor(now, "abc-123")
    tampered = cursor[:-1] + ("A" if cursor[-1] != "A" else "B")
    with pytest.raises(CursorDecodeError):
        decode_cursor(tampered)


def test_page_params_rejects_invalid_cursor_as_http_400(client: TestClient):
    resp = client.get("/items", params={"cursor": "not-a-valid-cursor!!"})
    assert resp.status_code == 400


def test_page_params_limit_is_bounded(client: TestClient):
    resp = client.get("/items", params={"limit": MAX_LIMIT + 1})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# build_page / Page[T] boundary behaviour
# ---------------------------------------------------------------------------

def test_pagination_first_page_has_more(client: TestClient):
    resp = client.get("/items", params={"limit": 10})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 10
    assert body["has_more"] is True
    assert body["next_cursor"] is not None


def test_pagination_walks_to_last_page(client: TestClient):
    cursor = None
    seen_ids: list[str] = []
    for _ in range(10):  # guard against infinite loop on a bug
        params = {"limit": 10}
        if cursor:
            params["cursor"] = cursor
        resp = client.get("/items", params=params)
        assert resp.status_code == 200
        body = resp.json()
        seen_ids.extend(item["id"] for item in body["items"])
        if not body["has_more"]:
            assert body["next_cursor"] is None
            break
        cursor = body["next_cursor"]
    else:
        pytest.fail("pagination did not terminate within 10 pages")

    assert seen_ids == [row.id for row in _ALL_ROWS]
    assert len(set(seen_ids)) == len(_ALL_ROWS)


def test_build_page_exact_boundary_no_lookahead_row():
    rows = _make_rows(5, start=datetime(2026, 1, 1, tzinfo=timezone.utc))
    # Exactly `limit` rows returned (no n+1 lookahead row present) => no more.
    page = build_page(rows, limit=5, cursor_key=lambda r: (r.created_at, r.id))
    assert page.has_more is False
    assert page.next_cursor is None
    assert len(page.items) == 5


def test_build_page_with_lookahead_row_sets_has_more():
    rows = _make_rows(6, start=datetime(2026, 1, 1, tzinfo=timezone.utc))
    # limit=5 but 6 rows fetched (the n+1 lookahead) => has_more True, and
    # the lookahead row itself must be excluded from `items`.
    page = build_page(rows, limit=5, cursor_key=lambda r: (r.created_at, r.id))
    assert page.has_more is True
    assert len(page.items) == 5
    assert page.items[-1].id == rows[4].id
    assert page.next_cursor is not None
    decoded = decode_cursor(page.next_cursor)
    assert decoded.id == rows[4].id


# ---------------------------------------------------------------------------
# OpenAPI customization
# ---------------------------------------------------------------------------

def test_customize_openapi_sets_security_scheme_and_tags(client: TestClient):
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()

    assert schema["info"]["title"]
    assert schema["info"]["version"]
    assert schema.get("servers")

    security_schemes = schema["components"]["securitySchemes"]
    assert SECURITY_SCHEME_NAME in security_schemes
    assert security_schemes[SECURITY_SCHEME_NAME]["scheme"] == "bearer"
    assert schema["security"] == [{SECURITY_SCHEME_NAME: []}]

    assert "x-tagGroups" in schema
    assert isinstance(schema["x-tagGroups"], list) and schema["x-tagGroups"]


def test_customize_openapi_assigns_stable_operation_ids(client: TestClient):
    schema = client.get("/openapi.json").json()
    op_ids = []
    for _path, methods in schema["paths"].items():
        for method, operation in methods.items():
            if method in ("get", "post", "put", "delete", "patch"):
                op_ids.append(operation["operationId"])
    assert op_ids
    assert len(op_ids) == len(set(op_ids)), "operationIds must be unique"


def test_sorted_openapi_schema_is_deterministic():
    from backend.openapi import sorted_openapi_schema

    app = _make_app()
    first = sorted_openapi_schema(app)
    app.openapi_schema = None  # force rebuild
    second = sorted_openapi_schema(app)
    assert first == second
    assert list(first.keys()) == sorted(first.keys())
