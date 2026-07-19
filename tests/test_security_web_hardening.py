"""Team 5 hardening: security/authz gaps in niches, templates, and
image-posts routes that the wave-5 audit didn't reach.

No DB required — repos are monkeypatched per test, auth is bypassed via
FastAPI dependency_overrides (mirrors tests/test_audit_round2_fixes.py
and tests/test_niches_route.py).
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.models import Niche, PostingWindow, Template

_USER_ID = "user_test"
_OTHER_USER_ID = "other_user"
_NICHE_ID = UUID("11111111-1111-1111-1111-111111111111")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _make_admin_client(monkeypatch) -> TestClient:
    client = _make_authed_client(monkeypatch)
    from backend.auth import AdminCtx, require_admin

    async def _fake_admin():
        return AdminCtx(user_id=_USER_ID, email="t@t.com", ip="127.0.0.1", user_agent="t")

    client.app.dependency_overrides[require_admin] = _fake_admin
    return client


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


def _make_niche(**overrides) -> Niche:
    base = dict(
        id=_NICHE_ID,
        user_id=_USER_ID,
        title="Cooking Tips",
        description="Short recipe ideas",
        target_audience="Home cooks",
        hashtags=["#food"],
        visual_style="Bright",
        voice="Friendly",
        target_duration_sec=30,
        scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Niche(**base)


# --------------------------------------------------------------------------- #
# 1. elevenlabs_voice_id validation (path-traversal / SSRF-ish defense)
# --------------------------------------------------------------------------- #

def test_create_niche_rejects_malicious_voice_id(monkeypatch):
    """A voice id crafted to break out of the URL path segment must 422
    before it ever reaches elevenlabs_tts.synthesize's f-string."""
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _create(user_id, **kwargs):
        raise AssertionError("repo.create must not run — validation should 422 first")

    monkeypatch.setattr(niches_repo, "create", _create)
    client = _make_authed_client(monkeypatch)

    for bad in (
        "../../etc/passwd",
        "voice/with/slashes",
        "voice id with spaces",
        "https://evil.example.com/x",
        "%2e%2e%2f",
        "a" * 41,  # too long
        "voice\nwith\nnewline",
    ):
        resp = client.post(
            "/api/v1/niches",
            json={**_VALID_PAYLOAD, "elevenlabs_voice_id": bad},
            headers={"Authorization": "Bearer mkt_tok"},
        )
        assert resp.status_code == 422, f"{bad!r} should be rejected, got {resp.status_code}"


def test_create_niche_accepts_valid_or_empty_voice_id(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _create(user_id, **kwargs):
        return _make_niche(elevenlabs_voice_id=kwargs.get("elevenlabs_voice_id", ""))

    monkeypatch.setattr(niches_repo, "create", _create)
    client = _make_authed_client(monkeypatch)

    for good in ("", "21m00Tcm4TlvDq8ikWAM", "A" * 40):
        resp = client.post(
            "/api/v1/niches",
            json={**_VALID_PAYLOAD, "elevenlabs_voice_id": good},
            headers={"Authorization": "Bearer mkt_tok"},
        )
        assert resp.status_code == 201, resp.text


def test_update_niche_rejects_malicious_voice_id(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _update(niche_id, *, user_id, **kwargs):
        raise AssertionError("repo.update must not run — validation should 422 first")

    monkeypatch.setattr(niches_repo, "update", _update)
    client = _make_authed_client(monkeypatch)

    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"elevenlabs_voice_id": "../../secret"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_update_niche_accepts_empty_voice_id(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _update(niche_id, *, user_id, **kwargs):
        return _make_niche()

    monkeypatch.setattr(niches_repo, "update", _update)
    client = _make_authed_client(monkeypatch)

    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"elevenlabs_voice_id": ""},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# 2. voice_provider='elevenlabs' rejected when ElevenLabs isn't configured
# --------------------------------------------------------------------------- #

def test_create_niche_rejects_elevenlabs_when_disabled(monkeypatch):
    _reset_limiter()
    from marketer.services import elevenlabs_tts
    monkeypatch.setattr(elevenlabs_tts, "enabled", lambda: False)

    import marketer.repos.niches as niches_repo

    async def _create(user_id, **kwargs):
        raise AssertionError("repo.create must not run when the provider is unavailable")

    monkeypatch.setattr(niches_repo, "create", _create)
    client = _make_authed_client(monkeypatch)

    resp = client.post(
        "/api/v1/niches",
        json={**_VALID_PAYLOAD, "voice_provider": "elevenlabs"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422
    assert "elevenlabs" in resp.json()["detail"].lower()


def test_create_niche_allows_elevenlabs_when_enabled(monkeypatch):
    _reset_limiter()
    from marketer.services import elevenlabs_tts
    monkeypatch.setattr(elevenlabs_tts, "enabled", lambda: True)

    import marketer.repos.niches as niches_repo

    async def _create(user_id, **kwargs):
        return _make_niche(voice_provider=kwargs.get("voice_provider", "openai"))

    monkeypatch.setattr(niches_repo, "create", _create)
    client = _make_authed_client(monkeypatch)

    resp = client.post(
        "/api/v1/niches",
        json={**_VALID_PAYLOAD, "voice_provider": "elevenlabs"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201, resp.text


def test_update_niche_rejects_elevenlabs_when_disabled(monkeypatch):
    _reset_limiter()
    from marketer.services import elevenlabs_tts
    monkeypatch.setattr(elevenlabs_tts, "enabled", lambda: False)

    import marketer.repos.niches as niches_repo

    async def _update(niche_id, *, user_id, **kwargs):
        raise AssertionError("repo.update must not run when the provider is unavailable")

    monkeypatch.setattr(niches_repo, "update", _update)
    client = _make_authed_client(monkeypatch)

    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"voice_provider": "elevenlabs"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_update_niche_leaves_voice_provider_untouched_is_allowed(monkeypatch):
    """Omitting voice_provider entirely (leave-alone semantics) must never
    trigger the availability check, even when elevenlabs is disabled —
    otherwise every unrelated field edit on an existing elevenlabs niche
    would start failing the moment the deploy loses the key."""
    _reset_limiter()
    from marketer.services import elevenlabs_tts
    monkeypatch.setattr(elevenlabs_tts, "enabled", lambda: False)

    import marketer.repos.niches as niches_repo

    async def _update(niche_id, *, user_id, **kwargs):
        assert "voice_provider" not in kwargs
        return _make_niche()

    monkeypatch.setattr(niches_repo, "update", _update)
    client = _make_authed_client(monkeypatch)

    resp = client.put(
        f"/api/v1/niches/{_NICHE_ID}",
        json={"title": "New title"},
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# 3. templates /admin/all is not shadowed by /{template_id}
# --------------------------------------------------------------------------- #

def test_templates_admin_all_resolves_to_admin_handler(monkeypatch):
    """GET /api/v1/templates/admin/all must hit list_all_templates, not
    get swallowed by a dynamic /{template_id} route trying (and failing)
    to parse 'admin' as a UUID."""
    _reset_limiter()
    import marketer.repos.templates as templates_repo

    sentinel = [
        Template(
            id=uuid4(), kind="image", name="Draft", description="", prompt="p",
            reference_key="", is_published=False, created_by=_USER_ID,
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
    ]

    async def _list_templates(*, published_only, kind=None):
        assert published_only is False
        return sentinel

    monkeypatch.setattr(templates_repo, "list_templates", _list_templates)
    client = _make_admin_client(monkeypatch)

    resp = client.get(
        "/api/v1/templates/admin/all", headers={"Authorization": "Bearer mkt_tok"}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Draft"


def test_templates_admin_all_requires_admin(monkeypatch):
    """No admin override -> require_admin's internal require_user() call
    (not routed through dependency_overrides, since it's an in-body call
    rather than a Depends()) hits the real auth path. With no bearer
    token that's a clean 401, matching test_template_admin_routes_reject_non_admin
    in tests/test_audit_round2_fixes.py."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)  # no admin override, no bearer token
    resp = client.get("/api/v1/templates/admin/all")
    assert resp.status_code in (401, 403)


# --------------------------------------------------------------------------- #
# 4. template creation: base64 payload must actually decode to an image
# --------------------------------------------------------------------------- #

def test_create_template_rejects_non_image_payload(monkeypatch, tmp_path):
    _reset_limiter()
    from marketer.config import settings as cfg
    monkeypatch.setattr(cfg, "artifacts_dir", str(tmp_path))

    client = _make_admin_client(monkeypatch)
    not_an_image = base64.b64encode(b"#!/bin/sh\nrm -rf /\n").decode()
    resp = client.post(
        "/api/v1/templates",
        json={
            "kind": "image",
            "name": "Bad upload",
            "prompt": "a prompt",
            "reference_image_b64": not_an_image,
        },
        headers={
            "Authorization": "Bearer mkt_tok",
            "content-length": str(len(not_an_image)),
        },
    )
    assert resp.status_code == 422
    assert "image" in resp.json()["detail"].lower()


def test_create_template_accepts_real_png(monkeypatch, tmp_path):
    _reset_limiter()
    from marketer.config import settings as cfg
    monkeypatch.setattr(cfg, "artifacts_dir", str(tmp_path))

    import marketer.repos.templates as templates_repo

    async def _create(**kwargs):
        return Template(
            id=uuid4(), kind=kwargs["kind"], name=kwargs["name"],
            description=kwargs["description"], prompt=kwargs["prompt"],
            reference_key=kwargs["reference_key"], is_published=kwargs["is_published"],
            created_by=kwargs["created_by"],
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(templates_repo, "create", _create)
    client = _make_admin_client(monkeypatch)

    # Minimal valid 1x1 PNG.
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
        "+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    good_b64 = base64.b64encode(png_bytes).decode()
    resp = client.post(
        "/api/v1/templates",
        json={
            "kind": "image",
            "name": "Good upload",
            "prompt": "a prompt",
            "reference_image_b64": good_b64,
        },
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 201, resp.text


# --------------------------------------------------------------------------- #
# 5. image-post retry/approve are scoped to the caller's own posts
# --------------------------------------------------------------------------- #

def test_retry_image_post_is_scoped_to_caller(monkeypatch):
    """The route must pass ctx.user_id through to claim_for_retry — a
    caller can't retry (or discover the existence of) someone else's
    post by guessing its id."""
    _reset_limiter()
    import marketer.repos.image_posts as image_posts_repo

    calls = []

    async def _claim_for_retry(image_post_id, *, user_id):
        calls.append(user_id)
        assert user_id == _USER_ID
        return False  # not claimable — exercise the not-found branch too

    async def _get(image_post_id, *, user_id):
        assert user_id == _USER_ID
        return None  # belongs to nobody the caller can see -> 404, never leaks

    monkeypatch.setattr(image_posts_repo, "claim_for_retry", _claim_for_retry)
    monkeypatch.setattr(image_posts_repo, "get", _get)
    client = _make_authed_client(monkeypatch)

    post_id = uuid4()
    resp = client.post(
        f"/api/v1/image-posts/{post_id}/retry",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 404
    assert calls == [_USER_ID]


def test_approve_image_post_is_scoped_to_caller(monkeypatch):
    _reset_limiter()
    import marketer.repos.image_posts as image_posts_repo

    calls = []

    async def _claim_for_scheduling(image_post_id, *, user_id):
        calls.append(user_id)
        return False

    async def _get(image_post_id, *, user_id):
        return {"id": str(image_post_id), "status": "queued"}

    monkeypatch.setattr(image_posts_repo, "claim_for_scheduling", _claim_for_scheduling)
    monkeypatch.setattr(image_posts_repo, "get", _get)
    client = _make_authed_client(monkeypatch)

    post_id = uuid4()
    resp = client.post(
        f"/api/v1/image-posts/{post_id}/approve",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 409
    assert calls == [_USER_ID]


def test_image_posts_and_providers_routes_require_auth(monkeypatch):
    """No Authorization header -> 401 on every route this team owns."""
    _reset_limiter()
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)

    assert client.get("/api/v1/image-posts").status_code == 401
    assert client.post(f"/api/v1/image-posts/{uuid4()}/retry").status_code == 401
    assert client.post(f"/api/v1/image-posts/{uuid4()}/approve").status_code == 401
    assert client.get("/api/v1/providers/video-models").status_code == 401
    assert client.get("/api/v1/providers/script-models").status_code == 401
    assert client.get("/api/v1/providers/audio").status_code == 401
