"""Tests for top_performers_for_niche and bottom_performers_for_niche.

asyncpg pool is mocked so no DB is required.
"""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest


_NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")
_USER_ID = "user_test"


def _fake_row(job_id: UUID, views: int) -> dict:
    return {"job_id": job_id, "views": views}


@pytest.mark.asyncio
async def test_top_performers_returns_descending_order(monkeypatch):
    """top_performers_for_niche returns rows ordered highest views first."""
    import marketer.repos.post_metrics as pm_repo

    job_ids = [uuid4() for _ in range(5)]
    rows = [
        _fake_row(job_ids[0], 100),
        _fake_row(job_ids[1], 500),
        _fake_row(job_ids[2], 250),
        _fake_row(job_ids[3], 750),
        _fake_row(job_ids[4], 50),
    ]
    # Simulate DB returning already-sorted DESC
    sorted_rows = sorted(rows, key=lambda r: r["views"], reverse=True)

    class _FakePool:
        async def fetch(self, query, *args):
            return sorted_rows

    monkeypatch.setattr("marketer.repos.post_metrics.get_pool", lambda: _async_return(_FakePool()))

    result = await pm_repo.top_performers_for_niche(_NICHE_ID, user_id=_USER_ID, limit=5)

    assert len(result) == 5
    # Verify descending order by views.
    views_seq = [v for _, v in result]
    assert views_seq == sorted(views_seq, reverse=True)
    # Highest should be first.
    assert result[0][1] == 750


@pytest.mark.asyncio
async def test_bottom_performers_returns_ascending_order(monkeypatch):
    """bottom_performers_for_niche returns rows ordered lowest views first."""
    import marketer.repos.post_metrics as pm_repo

    job_ids = [uuid4() for _ in range(5)]
    rows = [
        _fake_row(job_ids[0], 100),
        _fake_row(job_ids[1], 500),
        _fake_row(job_ids[2], 250),
        _fake_row(job_ids[3], 750),
        _fake_row(job_ids[4], 50),
    ]
    sorted_rows = sorted(rows, key=lambda r: r["views"])

    class _FakePool:
        async def fetch(self, query, *args):
            return sorted_rows

    monkeypatch.setattr("marketer.repos.post_metrics.get_pool", lambda: _async_return(_FakePool()))

    result = await pm_repo.bottom_performers_for_niche(_NICHE_ID, user_id=_USER_ID, limit=5)

    assert len(result) == 5
    views_seq = [v for _, v in result]
    assert views_seq == sorted(views_seq)
    assert result[0][1] == 50


@pytest.mark.asyncio
async def test_top_performers_respects_limit(monkeypatch):
    """limit param controls how many results come back."""
    import marketer.repos.post_metrics as pm_repo

    rows = [_fake_row(uuid4(), v) for v in [900, 800, 700, 600, 500]]

    class _FakePool:
        async def fetch(self, query, *args):
            # Return only as many as limit (last arg).
            limit = args[-1]
            return rows[:limit]

    monkeypatch.setattr("marketer.repos.post_metrics.get_pool", lambda: _async_return(_FakePool()))

    result = await pm_repo.top_performers_for_niche(_NICHE_ID, user_id=_USER_ID, limit=3)
    assert len(result) == 3


@pytest.mark.asyncio
async def test_top_performers_empty_result(monkeypatch):
    """No rows → empty list (not an error)."""
    import marketer.repos.post_metrics as pm_repo

    class _FakePool:
        async def fetch(self, query, *args):
            return []

    monkeypatch.setattr("marketer.repos.post_metrics.get_pool", lambda: _async_return(_FakePool()))

    result = await pm_repo.top_performers_for_niche(_NICHE_ID, user_id=_USER_ID)
    assert result == []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _async_return(value):
    return value
