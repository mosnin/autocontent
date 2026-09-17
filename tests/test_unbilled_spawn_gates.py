"""HTTP-edge unbilled 402s on paid spawn paths that still lack route tests.

Jobs, articles enqueue, motion create, CMS bulk-topics, and dramas already
pin this gate. These cases cover the remaining Modal/GPU surfaces where
``refuse_unbilled_generate`` is the only thing stopping a broke deployment
from touching operator keys.
"""
from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.config import settings

_USER_ID = "user_unbilled_gates"


def _reset_limiter() -> None:
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=_USER_ID, email="u@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    _reset_limiter()
    return TestClient(app, raise_server_exceptions=False)


def _forbid_spawn(monkeypatch) -> list[tuple]:
    """Any Modal spawn after a 402 is a money leak."""
    import modal

    spawned: list[tuple] = []

    class _Fn:
        def spawn(self, *args):
            spawned.append(args)
            raise AssertionError("must not spawn when unbilled usage is refused")

    monkeypatch.setattr(modal.Function, "from_name", staticmethod(lambda app, name: _Fn()))
    return spawned


def _assert_unbilled(resp) -> None:
    assert resp.status_code == 402, resp.text
    assert "unbilled" in resp.json()["detail"]


def test_headshots_create_402_before_row_or_spawn(monkeypatch):
    from marketer.repos import headshots as repo

    created: list[dict] = []

    async def _create(**kwargs):
        created.append(kwargs)
        raise AssertionError("headshot batch must not be created when unbilled")

    monkeypatch.setattr(repo, "create_batch", _create)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={"style_key": "corporate_classic", "source_image_ids": [str(uuid4())]},
    )
    _assert_unbilled(resp)
    assert created == []
    assert spawned == []


def test_headshots_retry_402_before_claim_or_spawn(monkeypatch):
    from marketer.repos import headshots as repo

    claimed: list = []

    async def _claim(batch_id, *, user_id):
        claimed.append((batch_id, user_id))
        raise AssertionError("headshot retry must not claim when unbilled")

    monkeypatch.setattr(repo, "claim_for_retry", _claim)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/headshots/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert claimed == []
    assert spawned == []


def test_ugc_create_402_before_submit(monkeypatch):
    from marketer.ugc import render as render_svc

    submitted: list[dict] = []

    async def _submit(**kwargs):
        submitted.append(kwargs)
        raise AssertionError("ugc submit must not run when unbilled")

    monkeypatch.setattr(render_svc, "submit_render", _submit)
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "grok-video", "prompt": "say hi"},
    )
    _assert_unbilled(resp)
    assert submitted == []


def test_ugc_retry_402_before_submit(monkeypatch):
    from marketer.ugc import render as render_svc

    retried: list = []

    async def _retry(render_id, *, user_id):
        retried.append((render_id, user_id))
        raise AssertionError("ugc retry must not run when unbilled")

    monkeypatch.setattr(render_svc, "retry_render", _retry)
    resp = _client(monkeypatch).post(f"/api/v1/ugc/renders/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert retried == []


def test_library_composition_402_before_row_or_spawn(monkeypatch):
    import marketer.repos.media as media_repo

    created: list[dict] = []

    async def _create(**kwargs):
        created.append(kwargs)
        raise AssertionError("composition must not be created when unbilled")

    monkeypatch.setattr(media_repo, "create_composition", _create)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(
        "/api/v1/library/compositions",
        json={"clip_asset_ids": [str(uuid4())]},
    )
    _assert_unbilled(resp)
    assert created == []
    assert spawned == []


def test_formats_trend_research_402_before_row_or_spawn(monkeypatch):
    from marketer.repos import trend_reports as reports_repo

    created: list[dict] = []

    async def _create(**kwargs):
        created.append(kwargs)
        raise AssertionError("trend report must not be created when unbilled")

    monkeypatch.setattr(reports_repo, "create", _create)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(
        "/api/v1/formats/trends",
        json={"niche_id": str(uuid4())},
    )
    _assert_unbilled(resp)
    assert created == []
    assert spawned == []


def test_motion_retry_402_before_claim_or_spawn(monkeypatch):
    from marketer.repos import motion_projects as projects_repo

    claimed: list = []

    async def _claim(project_id, *, user_id):
        claimed.append((project_id, user_id))
        raise AssertionError("motion retry must not claim when unbilled")

    monkeypatch.setattr(projects_repo, "claim_for_retry", _claim)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/motion/projects/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert claimed == []
    assert spawned == []


def test_template_remix_402_before_lookup_or_spawn(monkeypatch):
    from marketer.repos import templates as templates_repo

    looked_up: list = []

    async def _get(template_id):
        looked_up.append(template_id)
        raise AssertionError("remix must not load a template when unbilled")

    monkeypatch.setattr(templates_repo, "get", _get)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/templates/{uuid4()}/remix", json={})
    _assert_unbilled(resp)
    assert looked_up == []
    assert spawned == []


def test_article_retry_402_before_credit_or_claim(monkeypatch):
    from marketer.repos import articles as articles_repo
    from marketer.services import run_estimate

    claimed: list = []

    async def _claim(article_id, *, user_id):
        claimed.append((article_id, user_id))
        raise AssertionError("article retry must not claim when unbilled")

    async def _credit(*_a, **_k):
        raise AssertionError("credit gate must not run after unbilled refusal")

    monkeypatch.setattr(articles_repo, "claim_for_retry", _claim)
    monkeypatch.setattr(run_estimate, "refuse_if_credit_below", _credit)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/articles/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert claimed == []
    assert spawned == []


def test_image_post_retry_402_before_credit_or_claim(monkeypatch):
    from marketer.repos import image_posts as image_posts_repo
    from marketer.services import run_estimate

    claimed: list = []

    async def _claim(post_id, *, user_id):
        claimed.append((post_id, user_id))
        raise AssertionError("image-post retry must not claim when unbilled")

    async def _credit(*_a, **_k):
        raise AssertionError("credit gate must not run after unbilled refusal")

    monkeypatch.setattr(image_posts_repo, "claim_for_retry", _claim)
    monkeypatch.setattr(run_estimate, "refuse_if_credit_below", _credit)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/image-posts/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert claimed == []
    assert spawned == []


def test_design_retry_402_before_claim_or_spawn(monkeypatch):
    from marketer.repos import design_projects as projects_repo

    claimed: list = []

    async def _claim(project_id, *, user_id):
        claimed.append((project_id, user_id))
        raise AssertionError("design retry must not claim when unbilled")

    monkeypatch.setattr(projects_repo, "claim_for_retry", _claim)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(f"/api/v1/design/projects/{uuid4()}/retry")
    _assert_unbilled(resp)
    assert claimed == []
    assert spawned == []


def test_design_step_retry_402_before_lookup_or_spawn(monkeypatch):
    from marketer.repos import design_projects as projects_repo

    looked_up: list = []

    async def _get(project_id, *, user_id):
        looked_up.append((project_id, user_id))
        raise AssertionError("design step retry must not load when unbilled")

    monkeypatch.setattr(projects_repo, "get", _get)
    spawned = _forbid_spawn(monkeypatch)
    resp = _client(monkeypatch).post(
        f"/api/v1/design/projects/{uuid4()}/steps/s1/retry"
    )
    _assert_unbilled(resp)
    assert looked_up == []
    assert spawned == []
