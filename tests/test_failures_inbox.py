"""Tests for the failures inbox: the error->category classifier and the
``/api/v1/failures`` router.

No DB required — repos are monkeypatched. The router is mounted on a bare
FastAPI app (it is not yet wired into ``backend/main.py``; that's the
orchestrator's job), auth is bypassed via a dependency override exactly
like ``tests/test_jobs_route.py``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from marketer.articles.models import Article, ArticleStatus
from marketer.repos import jobs as jobs_repo

# ---------------------------------------------------------------------------
# classify_failure — pure function, exhaustive over known prefixes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "error, expected",
    [
        # content/render QA — Cycle-1 prefixes, checked before anything else.
        ("content QA failed: script mentions a competitor", "content_qa"),
        ("content QA failed: ", "content_qa"),
        ("render QA failed: black frames detected", "render_qa"),
        ("render QA failed: ", "render_qa"),
        # spend cap — SpendCapExceeded message shapes from spend.py /
        # spend_context.py and the pipeline.py fan-out short-circuit.
        ("niche 123 hit daily cap: $10.00 >= $10.00", "spend_cap"),
        ("user abc hit global daily cap: $50.00 >= $50.00", "spend_cap"),
        (
            "niche 123 pre-flight cap check: $9 + $2 > $10",
            "spend_cap",
        ),
        (
            "user abc pre-flight global cap check: $40 + $20 > $50",
            "spend_cap",
        ),
        (
            "user abc exhausted prepaid credit during job: balance $-1.00 "
            "after openai/dalle3. Top up to continue.",
            "spend_cap",
        ),
        (
            "niche 123 spend aborted: niche limit already reached",
            "spend_cap",
        ),
        ("spend_cap_exceeded during fan-out", "spend_cap"),
        # timeout / stuck — reap_stale's message.
        (
            "reaped: no progress (container died or timed out mid-run)",
            "timeout_stuck",
        ),
        ("no progress detected, marking failed", "timeout_stuck"),
        # provider errors — named third-party services / transient
        # exception classes / polling timeouts.
        ("fal request timed out after 300s", "provider_error"),
        ("job req_123 timed out after 120s", "provider_error"),  # grok_imagine
        ("RateLimitError: 429 too many requests", "provider_error"),
        ("APIConnectionError: connection reset", "provider_error"),
        ("APITimeoutError: read timed out", "provider_error"),
        ("openai: insufficient_quota", "provider_error"),
        ("elevenlabs returned 503", "provider_error"),
        ("ayrshare post failed: invalid profile key", "provider_error"),
        ("pixabay rate limit exceeded", "provider_error"),
        ("upstream 5xx from provider", "provider_error"),
        # fallback
        ("niche already running in another job", "other"),
        ("rejected by operator before posting", "other"),
        ("something completely unexpected happened", "other"),
        (None, "other"),
        ("", "other"),
    ],
)
def test_classify_failure(error, expected):
    assert jobs_repo.classify_failure(error) == expected


def test_classify_failure_categories_are_exhaustive_and_stable():
    """FAILURE_CATEGORIES must list every category the classifier can
    return — a future PR adding a category to one but not the other
    would silently break `counts` in the route (missing key)."""
    possible = {
        jobs_repo.classify_failure(e)
        for e in [
            "content QA failed: x",
            "render QA failed: x",
            "niche 1 hit daily cap: $1 >= $1",
            "reaped: no progress (container died or timed out mid-run)",
            "RateLimitError: 429",
            "totally unrecognized",
        ]
    }
    assert possible <= set(jobs_repo.FAILURE_CATEGORIES)
    assert possible == {
        "content_qa",
        "render_qa",
        "spend_cap",
        "timeout_stuck",
        "provider_error",
        "other",
    }


# ---------------------------------------------------------------------------
# Route: GET /api/v1/failures — user-scoped, 200 shape
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_OTHER_USER_ID = "user_other"
_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_JOB_ID = UUID("33333333-3333-3333-3333-333333333333")
_IMAGE_POST_ID = UUID("44444444-4444-4444-4444-444444444444")
_ARTICLE_ID = UUID("55555555-5555-5555-5555-555555555555")


def _make_app(monkeypatch):
    """Mount only the failures router on a bare app, bypassing auth —
    mirrors tests/test_jobs_route.py's pattern but without booting the
    full backend.main app, since this router isn't registered there yet."""
    from backend.auth import AuthCtx, require_user
    from backend.routes import failures

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    app = FastAPI()
    app.include_router(failures.router, prefix="/api/v1/failures")
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _job_failure_row(user_id: str = _USER_ID) -> dict:
    return {
        "kind": "job",
        "id": _JOB_ID,
        "niche_id": _NICHE_ID,
        "niche_title": "Coffee Facts",
        "platform": "tiktok",
        "error": "render QA failed: black frames detected",
        "category": "render_qa",
        "created_at": datetime.now(timezone.utc),
    }


def _make_article(status: ArticleStatus = ArticleStatus.failed) -> Article:
    return Article(
        id=_ARTICLE_ID,
        user_id=_USER_ID,
        niche_id=_NICHE_ID,
        status=status,
        topic="best espresso machines",
        error="content QA failed: duplicate claim",
    )


def test_list_failures_returns_200_shape(monkeypatch):
    from marketer.repos import articles as articles_repo
    from marketer.repos import image_posts as image_posts_repo

    async def _job_failures(user_id: str, *, limit: int = 100):
        assert user_id == _USER_ID
        return [_job_failure_row()]

    async def _image_post_list(user_id: str, *, status=None, limit=50):
        assert user_id == _USER_ID
        return []

    async def _article_list(user_id: str, *, status=None, niche_id=None, limit=50):
        assert user_id == _USER_ID
        return []

    monkeypatch.setattr(jobs_repo, "failures_for_user", _job_failures)
    monkeypatch.setattr(image_posts_repo, "list_for_user", _image_post_list)
    monkeypatch.setattr(articles_repo, "list_for_user", _article_list)

    client = _make_app(monkeypatch)
    resp = client.get("/api/v1/failures")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert len(body["failures"]) == 1
    item = body["failures"][0]
    assert item["kind"] == "job"
    assert item["id"] == str(_JOB_ID)
    assert item["category"] == "render_qa"
    assert item["niche_title"] == "Coffee Facts"
    # every declared category present in counts, even at zero
    assert set(body["counts"]) == set(jobs_repo.FAILURE_CATEGORIES)
    assert body["counts"]["render_qa"] == 1
    assert body["counts"]["content_qa"] == 0


def test_list_failures_merges_all_three_sources(monkeypatch):
    from marketer.repos import articles as articles_repo
    from marketer.repos import image_posts as image_posts_repo

    async def _job_failures(user_id: str, *, limit: int = 100):
        return [_job_failure_row()]

    async def _image_post_list(user_id: str, *, status=None, limit=50):
        return [
            {
                "id": _IMAGE_POST_ID,
                "niche_id": _NICHE_ID,
                "kind": "carousel",
                "error": "openai: insufficient_quota",
                "created_at": datetime.now(timezone.utc),
            }
        ]

    async def _article_list(user_id: str, *, status=None, niche_id=None, limit=50):
        return [_make_article()]

    monkeypatch.setattr(jobs_repo, "failures_for_user", _job_failures)
    monkeypatch.setattr(image_posts_repo, "list_for_user", _image_post_list)
    monkeypatch.setattr(articles_repo, "list_for_user", _article_list)

    client = _make_app(monkeypatch)
    resp = client.get("/api/v1/failures")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    kinds = {f["kind"] for f in body["failures"]}
    assert kinds == {"job", "image_post", "article"}
    by_kind = {f["kind"]: f for f in body["failures"]}
    assert by_kind["image_post"]["category"] == "provider_error"
    assert by_kind["article"]["category"] == "content_qa"


def test_list_failures_is_user_scoped(monkeypatch):
    """The route must forward ctx.user_id to every repo call — it must
    never be possible for one user's failures to leak into another's
    inbox response."""
    from marketer.repos import articles as articles_repo
    from marketer.repos import image_posts as image_posts_repo

    seen_users: list[str] = []

    async def _job_failures(user_id: str, *, limit: int = 100):
        seen_users.append(user_id)
        # Simulate a repo that is itself correctly scoped: only returns
        # rows for the exact user_id passed in.
        if user_id != _USER_ID:
            return []
        return [_job_failure_row(user_id=user_id)]

    async def _image_post_list(user_id: str, *, status=None, limit=50):
        seen_users.append(user_id)
        return []

    async def _article_list(user_id: str, *, status=None, niche_id=None, limit=50):
        seen_users.append(user_id)
        return []

    monkeypatch.setattr(jobs_repo, "failures_for_user", _job_failures)
    monkeypatch.setattr(image_posts_repo, "list_for_user", _image_post_list)
    monkeypatch.setattr(articles_repo, "list_for_user", _article_list)

    client = _make_app(monkeypatch)
    resp = client.get("/api/v1/failures")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert all(u == _USER_ID for u in seen_users)
    assert all(f["kind"] != "job" or f["id"] == str(_JOB_ID) for f in body["failures"])


def test_list_failures_without_auth_returns_401():
    """No dependency override on require_user, no bearer header at all ->
    fails closed with 401 before any repo is ever touched."""
    from backend.routes import failures

    app = FastAPI()
    app.include_router(failures.router, prefix="/api/v1/failures")
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/failures")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Route: POST /api/v1/failures/replay/{kind}/{id} — delegates to existing
# retry mechanisms per kind.
# ---------------------------------------------------------------------------


def test_replay_job_delegates_to_reset_for_retry(monkeypatch):
    from marketer.models import Job, JobStatus

    calls: list[UUID] = []

    async def _reset(job_id: UUID, *, user_id: str):
        calls.append(job_id)
        assert user_id == _USER_ID
        return Job(
            id=job_id,
            user_id=user_id,
            niche_id=_NICHE_ID,
            platform="tiktok",
            status=JobStatus.queued,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)

    class _FakeFn:
        spawned: list[tuple] = []

        def spawn(self, *args):
            _FakeFn.spawned.append(args)

    class _FakeModal:
        Function = type("F", (), {"from_name": staticmethod(lambda *a, **k: _FakeFn())})

    monkeypatch.setitem(__import__("sys").modules, "modal", _FakeModal())

    client = _make_app(monkeypatch)
    resp = client.post(f"/api/v1/failures/replay/job/{_JOB_ID}")
    assert resp.status_code == 202
    assert calls == [_JOB_ID]
    assert resp.json()["status"] == "queued"


def test_replay_job_conflict_when_not_failed(monkeypatch):
    async def _reset(job_id: UUID, *, user_id: str):
        return None

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)

    client = _make_app(monkeypatch)
    resp = client.post(f"/api/v1/failures/replay/job/{_JOB_ID}")
    assert resp.status_code == 409


def test_replay_image_post_delegates_to_claim_for_retry(monkeypatch):
    from marketer.repos import image_posts as image_posts_repo

    async def _claim(image_post_id: UUID, *, user_id: str) -> bool:
        assert user_id == _USER_ID
        return True

    monkeypatch.setattr(image_posts_repo, "claim_for_retry", _claim)

    class _FakeFn:
        def spawn(self, *args):
            pass

    class _FakeModal:
        Function = type("F", (), {"from_name": staticmethod(lambda *a, **k: _FakeFn())})

    monkeypatch.setitem(__import__("sys").modules, "modal", _FakeModal())

    client = _make_app(monkeypatch)
    resp = client.post(f"/api/v1/failures/replay/image_post/{_IMAGE_POST_ID}")
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"


def test_replay_article_delegates_to_atomic_claim(monkeypatch):
    from marketer.repos import articles as articles_repo

    claims: list[tuple] = []

    async def _claim(article_id: UUID, *, user_id: str):
        assert user_id == _USER_ID  # user-scoped
        claims.append((article_id, user_id))
        art = _make_article()
        art.status = ArticleStatus.queued
        art.error = None
        return art

    monkeypatch.setattr(articles_repo, "claim_for_retry", _claim)

    class _FakeFn:
        def spawn(self, *args):
            pass

    class _FakeModal:
        Function = type("F", (), {"from_name": staticmethod(lambda *a, **k: _FakeFn())})

    monkeypatch.setitem(__import__("sys").modules, "modal", _FakeModal())

    client = _make_app(monkeypatch)
    resp = client.post(f"/api/v1/failures/replay/article/{_ARTICLE_ID}")
    assert resp.status_code == 202
    assert claims and claims[0][0] == _ARTICLE_ID
