"""Brand kit route + prompt-context rendering (unit, stubbed)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from marketer.repos.brand_kit import BrandKit, as_prompt_context

_USER = "user_bk_1"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="b@b.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_get_returns_empty_kit_when_unset(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as repo

    async def _get(uid):
        return None

    monkeypatch.setattr(repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/brand-kit", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json()["brand_name"] == ""


def test_put_normalizes_hashtags_and_rejects_bad_hex(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as repo
    saved = {}

    async def _upsert(uid, kit):
        saved["kit"] = kit
        return kit

    monkeypatch.setattr(repo, "upsert", _upsert)
    client = _client(monkeypatch)

    # bad hex → 422
    bad = client.put(
        "/api/v1/brand-kit", json={"color_hex": "red"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert bad.status_code == 422

    ok = client.put(
        "/api/v1/brand-kit",
        json={
            "brand_name": "Harbor Coffee",
            "preferred_hashtags": ["coffee", "#espresso", "  "],
            "banned_words": ["cheap", ""],
            "color_hex": "#a3402f",
        },
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert ok.status_code == 200
    kit = saved["kit"]
    assert kit.preferred_hashtags == ["#coffee", "#espresso"]
    assert kit.banned_words == ["cheap"]


def test_prompt_context_renders_only_set_fields():
    empty = as_prompt_context(BrandKit())
    assert empty == ""
    ctx = as_prompt_context(BrandKit(brand_name="Harbor", tone_of_voice="warm",
                                     banned_words=["cheap"]))
    assert "Brand: Harbor" in ctx
    assert "warm" in ctx
    assert "cheap" in ctx
    assert "Tagline" not in ctx  # unset fields omitted
