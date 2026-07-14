"""Route-level tests for GET /api/v1/niches/{id}/performance.

No DB required.  Repos are monkeypatched per-test.
Auth is bypassed via FastAPI dependency_overrides.

D1 dependency note
------------------
``post_metrics_repo.latest_for_job`` is monkeypatched here because the
analytics-ingestion PR (D1) owns the real implementation.  When D1 lands an
integration smoke test should be run against a live DB to verify the join
works end-to-end.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID


from autocontent.models import (
    Job,
    JobStatus,
    Niche,
    PostingWindow,
    Script,
    Idea,
    Scene,
)

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_OTHER_USER_ID = "other_user"
_NICHE_ID = UUID("11111111-1111-1111-1111-111111111111")

_JOB_IDS = [
    UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
]


def _make_niche(user_id: str = _USER_ID) -> Niche:
    return Niche(
        id=_NICHE_ID,
        user_id=user_id,
        title="Cooking Tips",
        description="Short recipe ideas",
        target_audience="Home cooks",
        hashtags=["#food"],
        visual_style="Bright overhead",
        voice="Friendly",
        target_duration_sec=30,
        scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )


def _make_script() -> Script:
    return Script(
        idea=Idea(
            topic="Easy pasta",
            angle="Quick weeknight",
            hook="This 5-minute pasta changed my life",
            target_audience="Busy adults",
            why_it_works="Relatable pain point",
        ),
        scenes=[
            Scene(
                index=0,
                narration="Boil water.",
                visual_prompt="Pot on stove",
                motion_prompt="Zoom in on boiling water",
                duration_sec=5.0,
            ),
            Scene(
                index=1,
                narration="Add pasta.",
                visual_prompt="Pouring pasta",
                motion_prompt="Slow pour",
                duration_sec=5.0,
            ),
        ],
        total_duration_sec=10.0,
    )


def _make_jobs() -> list[Job]:
    now = datetime.now(timezone.utc)
    jobs = []
    for i, jid in enumerate(_JOB_IDS):
        job = Job(
            id=jid,
            user_id=_USER_ID,
            niche_id=_NICHE_ID,
            platform="tiktok",
            status=JobStatus.done if i < 2 else JobStatus.failed,
            created_at=now - timedelta(hours=i),
        )
        if i == 0:
            job.script = _make_script()
        jobs.append(job)
    return jobs


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch):
    from fastapi.testclient import TestClient
    from autocontent.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Fake metric object (stand-in for PostMetrics from D1)
# ---------------------------------------------------------------------------

class _FakeMetrics:
    def __init__(self, job_id: UUID, views: int, likes: int = 0):
        self.job_id = job_id
        self.views = views
        self.likes = likes
        self.watch_time_sec = None
        self.avg_watch_time_sec = None
        self.completion_rate = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_performance_returns_200_with_merged_data(monkeypatch):
    """3 jobs, 2 with metrics → summary aggregates correctly, all 3 in list."""
    _reset_limiter()

    import autocontent.repos.niches as niches_repo
    import autocontent.repos.jobs as jobs_repo
    import autocontent.repos.spend as spend_repo
    import autocontent.repos.post_metrics as post_metrics_repo

    fake_jobs = _make_jobs()
    fake_niche = _make_niche()
    fake_metrics = {
        _JOB_IDS[0]: _FakeMetrics(_JOB_IDS[0], views=1000, likes=50),
        _JOB_IDS[1]: _FakeMetrics(_JOB_IDS[1], views=200, likes=10),
        # JOB_IDS[2] has no metrics
    }
    fake_costs = {
        _JOB_IDS[0]: Decimal("1.50"),
        _JOB_IDS[1]: Decimal("0.80"),
        _JOB_IDS[2]: Decimal("0.20"),
    }

    async def _get_niche(niche_id: UUID, *, user_id: str):
        if niche_id == _NICHE_ID and user_id == _USER_ID:
            return fake_niche
        return None

    async def _list_jobs(user_id: str, *, niche_id=None, status=None, limit=50):
        return fake_jobs

    async def _cost_by_job(job_ids, *, user_id):
        return {jid: fake_costs.get(jid, Decimal("0")) for jid in job_ids}

    async def _latest_for_job(job_id: UUID, *, user_id: str):
        return fake_metrics.get(job_id)

    monkeypatch.setattr(niches_repo, "get", _get_niche)
    monkeypatch.setattr(jobs_repo, "list_for_user", _list_jobs)
    monkeypatch.setattr(spend_repo, "cost_by_job", _cost_by_job)
    monkeypatch.setattr(post_metrics_repo, "latest_for_job", _latest_for_job)

    client = _make_authed_client(monkeypatch)

    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance",
        headers={"Authorization": "Bearer act_tok"},
    )

    assert resp.status_code == 200
    data = resp.json()

    assert data["niche_id"] == str(_NICHE_ID)
    assert data["days"] == 30

    jobs_data = data["jobs"]
    assert len(jobs_data) == 3

    # Job with script should have hook / topic / scene_count populated.
    scripted = next(j for j in jobs_data if j["job_id"] == str(_JOB_IDS[0]))
    assert scripted["hook"] == "This 5-minute pasta changed my life"
    assert scripted["topic"] == "Easy pasta"
    assert scripted["scene_count"] == 2
    assert scripted["visual_style"] == "Bright overhead"
    assert scripted["views"] == 1000

    # Job without script has None fields.
    unscripted = next(j for j in jobs_data if j["job_id"] == str(_JOB_IDS[1]))
    assert unscripted["hook"] is None
    assert unscripted["views"] == 200

    # Job with no metrics has views=None.
    no_metrics = next(j for j in jobs_data if j["job_id"] == str(_JOB_IDS[2]))
    assert no_metrics["views"] is None

    # Summary checks.
    summary = data["summary"]
    # 2 done jobs
    assert summary["total_videos"] == 2
    # total spend: 1.50 + 0.80 + 0.20 = 2.50
    assert Decimal(summary["total_spend_usd"]) == Decimal("2.50")
    # total views: 1000 + 200 = 1200
    assert summary["total_views"] == 1200
    # avg: 1200 / 2 = 600.0
    assert abs(summary["avg_views_per_video"] - 600.0) < 0.01
    # best: job 0 (1000 views)
    assert summary["best_job_id"] == str(_JOB_IDS[0])
    # worst: job 1 (200 views)
    assert summary["worst_job_id"] == str(_JOB_IDS[1])


def test_performance_days_param_filters_window(monkeypatch):
    """days=1 excludes jobs older than 1 day."""
    _reset_limiter()

    import autocontent.repos.niches as niches_repo
    import autocontent.repos.jobs as jobs_repo
    import autocontent.repos.spend as spend_repo
    import autocontent.repos.post_metrics as post_metrics_repo

    now = datetime.now(timezone.utc)
    recent_job = Job(
        id=_JOB_IDS[0],
        user_id=_USER_ID,
        niche_id=_NICHE_ID,
        platform="tiktok",
        status=JobStatus.done,
        created_at=now - timedelta(hours=6),
    )
    old_job = Job(
        id=_JOB_IDS[1],
        user_id=_USER_ID,
        niche_id=_NICHE_ID,
        platform="tiktok",
        status=JobStatus.done,
        created_at=now - timedelta(days=5),
    )

    async def _get_niche(niche_id, *, user_id):
        return _make_niche()

    async def _list_jobs(user_id, *, niche_id=None, status=None, limit=50):
        return [recent_job, old_job]

    async def _cost_by_job(job_ids, *, user_id):
        return {jid: Decimal("0") for jid in job_ids}

    async def _latest_for_job(job_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _get_niche)
    monkeypatch.setattr(jobs_repo, "list_for_user", _list_jobs)
    monkeypatch.setattr(spend_repo, "cost_by_job", _cost_by_job)
    monkeypatch.setattr(post_metrics_repo, "latest_for_job", _latest_for_job)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance?days=1",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # Only the recent job should be in the result.
    assert len(data["jobs"]) == 1
    assert data["jobs"][0]["job_id"] == str(_JOB_IDS[0])


def test_performance_invalid_days_returns_422(monkeypatch):
    """days=0 → 422 Unprocessable Entity (Query ge=1 constraint)."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance?days=0",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 422


def test_performance_negative_days_returns_422(monkeypatch):
    """days=-5 → 422."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance?days=-5",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 422


def test_performance_other_users_niche_returns_404(monkeypatch):
    """Niche owned by a different user → 404."""
    _reset_limiter()

    import autocontent.repos.niches as niches_repo

    async def _get_niche(niche_id, *, user_id):
        # Simulate ownership isolation — return None for any request.
        return None

    monkeypatch.setattr(niches_repo, "get", _get_niche)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 404


def test_performance_empty_niche_returns_empty_summary(monkeypatch):
    """Niche with no jobs in window → empty jobs list and zero summary."""
    _reset_limiter()

    import autocontent.repos.niches as niches_repo
    import autocontent.repos.jobs as jobs_repo

    async def _get_niche(niche_id, *, user_id):
        return _make_niche()

    async def _list_jobs(user_id, *, niche_id=None, status=None, limit=50):
        return []

    monkeypatch.setattr(niches_repo, "get", _get_niche)
    monkeypatch.setattr(jobs_repo, "list_for_user", _list_jobs)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/niches/{_NICHE_ID}/performance",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["jobs"] == []
    assert data["summary"]["total_videos"] == 0
    assert Decimal(data["summary"]["total_spend_usd"]) == Decimal("0")
    assert data["summary"]["best_job_id"] is None
    assert data["summary"]["worst_job_id"] is None
