"""Tests for spend_repo.cost_by_job.

asyncpg pool is mocked so no DB is required.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest


_USER_ID = "user_test"


def _fake_row(job_id: UUID, total: str) -> dict:
    return {"job_id": job_id, "total": total}


@pytest.mark.asyncio
async def test_cost_by_job_aggregates_correctly(monkeypatch):
    """Returned rows are mapped to a UUID→Decimal dict."""
    import marketer.repos.spend as spend_repo

    job_ids = [uuid4(), uuid4(), uuid4()]
    db_rows = [
        _fake_row(job_ids[0], "1.50"),
        _fake_row(job_ids[1], "0.75"),
        _fake_row(job_ids[2], "2.00"),
    ]

    class _FakePool:
        async def fetch(self, query, *args):
            return db_rows

    monkeypatch.setattr("marketer.repos.spend.get_pool", lambda: _async_return(_FakePool()))

    result = await spend_repo.cost_by_job(job_ids, user_id=_USER_ID)

    assert result[job_ids[0]] == Decimal("1.50")
    assert result[job_ids[1]] == Decimal("0.75")
    assert result[job_ids[2]] == Decimal("2.00")


@pytest.mark.asyncio
async def test_cost_by_job_missing_ids_map_to_zero(monkeypatch):
    """Job IDs with no spend rows are returned as Decimal('0')."""
    import marketer.repos.spend as spend_repo

    job_ids = [uuid4(), uuid4(), uuid4()]
    # DB only returns rows for the first two jobs.
    db_rows = [
        _fake_row(job_ids[0], "3.00"),
        _fake_row(job_ids[1], "1.25"),
    ]

    class _FakePool:
        async def fetch(self, query, *args):
            return db_rows

    monkeypatch.setattr("marketer.repos.spend.get_pool", lambda: _async_return(_FakePool()))

    result = await spend_repo.cost_by_job(job_ids, user_id=_USER_ID)

    assert result[job_ids[0]] == Decimal("3.00")
    assert result[job_ids[1]] == Decimal("1.25")
    # Third job had no spend row → should default to 0.
    assert result[job_ids[2]] == Decimal("0")


@pytest.mark.asyncio
async def test_cost_by_job_empty_input_returns_empty_dict(monkeypatch):
    """Empty input list → empty dict, no DB call needed."""
    import marketer.repos.spend as spend_repo

    calls: list = []

    class _FakePool:
        async def fetch(self, query, *args):
            calls.append(True)
            return []

    monkeypatch.setattr("marketer.repos.spend.get_pool", lambda: _async_return(_FakePool()))

    result = await spend_repo.cost_by_job([], user_id=_USER_ID)

    assert result == {}
    # No DB call should have been made for an empty list.
    assert calls == []


@pytest.mark.asyncio
async def test_cost_by_job_single_job(monkeypatch):
    """Single job ID works correctly."""
    import marketer.repos.spend as spend_repo

    jid = uuid4()
    db_rows = [_fake_row(jid, "5.99")]

    class _FakePool:
        async def fetch(self, query, *args):
            return db_rows

    monkeypatch.setattr("marketer.repos.spend.get_pool", lambda: _async_return(_FakePool()))

    result = await spend_repo.cost_by_job([jid], user_id=_USER_ID)
    assert result[jid] == Decimal("5.99")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _async_return(value):
    return value
