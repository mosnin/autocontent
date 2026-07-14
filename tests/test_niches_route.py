"""Route-level tests for /api/v1/niches.

No DB required — niches_repo functions are monkeypatched per test.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient

from marketer.models import Niche, PostingWindow

# ---------------------------------------------------------------------------
# Constants / helpers shared across tests
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_OTHER_USER_ID = "other_user"

_NICHE_ID = UUID("11111111-1111-1111-1111-111111111111")


def _make_niche(niche_id: UUID | None = None, *, user_id: str = _USER_ID) -> Niche:
    return Niche(
        id=niche_id or _NICHE_ID,
        user_id=user_id,
        title="Cooking Tips",
        description="Short recipe ideas",
        target_audience="Home cooks",
        hashtags=["#food", "#cooking"],
        visual_style="Bright, overhead",
        voice="Friendly",
        target_duration_sec=30,
        scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )


_VALID_PAYLOAD: dict = {
    "title": "Cooking Tips",
    "description": "Short recipe ideas",
    "target_audience": "Home cooks",
    "hashtags": ["#food"],
    "visual_style": "Bright",
    "voice": "Friendly",
    "target_duration_sec": 30,
    "scene_count": 3,
    "posting_windows": [{"hour": 9, "minute": 0, "tz": "UTC"}],
    "platforms": ["tiktok"],
    "daily_spend_cap_usd": "5.00",
}


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# GET / — list niches
# ---------------------------------------------------------------------------

def test_list_niches_returns_200_empty(monkeypatch):
    """Empty list is a valid response."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _list(user_id: str):
        return []

    monkeypatch.setattr(niches_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/niches", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_niches_returns_owned_niches(monkeypatch):
    """Returns niches owned by the authenticated user."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    niche = _make_niche()

    async def _list(user_id: str):
        assert user_id == _USER_ID
        return [niche]

    monkeypatch.setattr(niches_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/niches", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["title"] == "Cooking Tips"


def test_list_niches_without_auth_returns_401(monkeypatch):
    """No auth header → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/niches")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST / — create niche
# ---------------------------------------------------------------------------

def test_create_niche_returns_201(monkeypatch):
    """Valid payload → 201 with returned niche fields."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _create(user_id: str, **kwargs) -> Niche:
        return _make_niche()

    monkeypatch.setattr(niches_repo, "create", _create)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/niches",
        json=_VALID_PAYLOAD,
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Cooking Tips"
    assert data["user_id"] == _USER_ID


def test_create_niche_missing_field_returns_422(monkeypatch):
    """Missing required field → 422 Unprocessable Entity."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    bad_payload = {k: v for k, v in _VALID_PAYLOAD.items() if k != "title"}
    resp = client.post(
        "/api/v1/niches",
        json=bad_payload,
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_create_niche_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/api/v1/niches", json=_VALID_PAYLOAD)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /{id} — single niche
# ---------------------------------------------------------------------------

def test_get_niche_returns_200_for_owned(monkeypatch):
    """Niche owned by user → 200."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    niche = _make_niche()

    async def _get(niche_id: UUID, *, user_id: str) -> Niche | None:
        if niche_id == _NICHE_ID and user_id == _USER_ID:
            return niche
        return None

    monkeypatch.setattr(niches_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(_NICHE_ID)


def test_get_niche_returns_404_for_other_user(monkeypatch):
    """Niche owned by another user → 404 (scope isolation)."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    # Repo returns None when user_id doesn't match (ownership check).
    async def _get(niche_id: UUID, *, user_id: str) -> Niche | None:
        return None

    monkeypatch.setattr(niches_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404


def test_get_niche_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get(f"/api/v1/niches/{_NICHE_ID}")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PUT /{id} — partial update
# ---------------------------------------------------------------------------

def test_update_niche_changes_title(monkeypatch):
    """PUT with only title returns updated niche; other fields preserved."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    updated = _make_niche()
    updated.title = "Updated Title"

    async def _update(niche_id: UUID, *, user_id: str, **fields) -> Niche | None:
        assert fields.get("title") == "Updated Title"
        return updated

    monkeypatch.setattr(niches_repo, "update", _update)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"title": "Updated Title"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


def test_update_niche_returns_404_when_not_found(monkeypatch):
    """PUT on non-owned niche → 404."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _update(niche_id: UUID, *, user_id: str, **fields) -> Niche | None:
        return None

    monkeypatch.setattr(niches_repo, "update", _update)

    client = _make_authed_client(monkeypatch)
    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"title": "x"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /{id} — archive
# ---------------------------------------------------------------------------

def test_delete_niche_returns_204(monkeypatch):
    """DELETE returns 204 No Content."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    archived: list[UUID] = []

    async def _archive(niche_id: UUID, *, user_id: str) -> None:
        archived.append(niche_id)

    monkeypatch.setattr(niches_repo, "archive", _archive)

    client = _make_authed_client(monkeypatch)
    resp = client.delete(
        f"/api/v1/niches/{_NICHE_ID}",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 204
    assert _NICHE_ID in archived


def test_delete_niche_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/niches/{_NICHE_ID}")
    assert resp.status_code == 401
