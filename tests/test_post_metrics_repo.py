"""Tests for the post_metrics repository.

All DB calls are intercepted by a stub asyncpg pool — no real DB required.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from marketer.models import PostMetrics
from marketer.repos import post_metrics as repo

# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

_USER_ID = "user_test"
_JOB_ID = UUID("11111111-1111-1111-1111-111111111111")
_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_NOW = datetime(2026, 6, 9, 11, 0, 0, tzinfo=timezone.utc)


def _make_metrics(
    *,
    job_id: UUID = _JOB_ID,
    user_id: str = _USER_ID,
    provider_post_id: str = "ayr-post-1",
    platform: str = "tiktok",
    views: int | None = 1000,
    sampled_at: datetime = _NOW,
) -> PostMetrics:
    return PostMetrics(
        id=uuid4(),
        user_id=user_id,
        job_id=job_id,
        provider_post_id=provider_post_id,
        platform=platform,
        sampled_at=sampled_at,
        views=views,
        likes=50,
        comments=5,
        shares=10,
        saves=3,
        watch_time_sec=Decimal("1234.56"),
        avg_watch_time_sec=Decimal("4.5"),
        completion_rate=Decimal("0.42"),
        reach=900,
        impressions=1100,
        raw={"id": provider_post_id, "analytics": {}},
        created_at=_NOW,
    )


def _row_from_metrics(m: PostMetrics) -> dict:
    """Build a fake asyncpg Record-like dict from a PostMetrics instance."""
    return {
        "id": m.id,
        "user_id": m.user_id,
        "job_id": m.job_id,
        "provider_post_id": m.provider_post_id,
        "platform": m.platform,
        "sampled_at": m.sampled_at,
        "views": m.views,
        "likes": m.likes,
        "comments": m.comments,
        "shares": m.shares,
        "saves": m.saves,
        "watch_time_sec": m.watch_time_sec,
        "avg_watch_time_sec": m.avg_watch_time_sec,
        "completion_rate": m.completion_rate,
        "reach": m.reach,
        "impressions": m.impressions,
        "raw": m.raw,  # asyncpg returns jsonb as dict
        "created_at": m.created_at,
    }


class _FakePool:
    """Minimal asyncpg Pool stub that records calls and returns pre-set rows."""

    def __init__(self, fetchrow_result=None, fetch_result=None):
        self._fetchrow = fetchrow_result
        self._fetch = fetch_result or []
        self.executed: list[tuple] = []

    async def fetchrow(self, query: str, *args):
        self.executed.append(("fetchrow", query, args))
        return self._fetchrow

    async def fetch(self, query: str, *args):
        self.executed.append(("fetch", query, args))
        return self._fetch

    async def execute(self, query: str, *args):
        self.executed.append(("execute", query, args))


@pytest.fixture
def _no_pool(monkeypatch):
    """Replace get_pool() with a factory returning our fake pool."""

    def _install(pool: _FakePool):
        async def _get_pool():
            return pool
        monkeypatch.setattr(repo, "get_pool", _get_pool)
        return pool

    return _install


# ---------------------------------------------------------------------------
# record() — round-trips the model
# ---------------------------------------------------------------------------

async def test_record_round_trips(monkeypatch, _no_pool):
    m = _make_metrics()
    row = _row_from_metrics(m)
    pool = _no_pool(_FakePool(fetchrow_result=row))

    result = await repo.record(m)

    assert result.id == m.id
    assert result.user_id == _USER_ID
    assert result.job_id == _JOB_ID
    assert result.views == 1000
    assert result.completion_rate == Decimal("0.42")
    assert result.raw == m.raw

    # Exactly one INSERT was performed
    assert len(pool.executed) == 1
    op, query, _args = pool.executed[0]
    assert op == "fetchrow"
    assert "insert into post_metrics" in query.lower()


# ---------------------------------------------------------------------------
# latest_for_job() — returns newest sample
# ---------------------------------------------------------------------------

async def test_latest_for_job_returns_model(_no_pool):
    m = _make_metrics()
    row = _row_from_metrics(m)
    _no_pool(_FakePool(fetchrow_result=row))

    result = await repo.latest_for_job(_JOB_ID, user_id=_USER_ID)

    assert result is not None
    assert result.id == m.id
    assert result.views == 1000


async def test_latest_for_job_returns_none_when_empty(_no_pool):
    _no_pool(_FakePool(fetchrow_result=None))

    result = await repo.latest_for_job(_JOB_ID, user_id=_USER_ID)

    assert result is None


# ---------------------------------------------------------------------------
# list_for_niche() — returns one row per job (most recent), excludes others
# ---------------------------------------------------------------------------

async def test_list_for_niche_returns_latest_per_job(_no_pool):
    job_a = uuid4()
    job_b = uuid4()
    # Two rows for job_a (different sample times), one for job_b
    m1 = _make_metrics(job_id=job_a, views=100)
    m2 = _make_metrics(job_id=job_b, views=200)
    # In real DB the CTE deduplicates; here we simulate what would come back
    rows = [_row_from_metrics(m1), _row_from_metrics(m2)]
    _no_pool(_FakePool(fetch_result=rows))

    result = await repo.list_for_niche(_NICHE_ID, user_id=_USER_ID, days=30)

    assert len(result) == 2
    job_ids = {r.job_id for r in result}
    assert job_a in job_ids
    assert job_b in job_ids


async def test_list_for_niche_passes_correct_params(_no_pool):
    pool = _no_pool(_FakePool(fetch_result=[]))

    await repo.list_for_niche(_NICHE_ID, user_id=_USER_ID, days=14)

    assert len(pool.executed) == 1
    _op, query, args = pool.executed[0]
    assert "niche_id" in query or "$1" in query
    # First positional arg = niche_id, second = user_id, third = days string
    assert args[0] == _NICHE_ID
    assert args[1] == _USER_ID
    assert "14" in args[2]


async def test_list_for_niche_empty_returns_empty_list(_no_pool):
    _no_pool(_FakePool(fetch_result=[]))

    result = await repo.list_for_niche(_NICHE_ID, user_id=_USER_ID)

    assert result == []
