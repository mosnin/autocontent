"""Batch-scheduler guard: awaiting_approval must block the next window."""
from __future__ import annotations

from uuid import uuid4

from marketer.repos import jobs as jobs_repo


def test_reaper_statuses_exclude_awaiting_approval():
    """Parking for a human is not staleness — reap_stale must not fail it."""
    assert "awaiting_approval" not in jobs_repo._REAPABLE_STATUSES
    assert "scheduling" in jobs_repo._REAPABLE_STATUSES


async def test_has_active_sql_blocks_awaiting_approval_without_age_window(monkeypatch):
    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return {"exists": 1}

    async def _pool():
        return _Pool()

    monkeypatch.setattr(jobs_repo, "get_pool", _pool)
    niche_id = uuid4()
    assert await jobs_repo.has_active_for_niche(niche_id, within_minutes=45) is True

    sql = " ".join(captured["sql"].split())
    assert "status = 'awaiting_approval'" in sql
    assert "or status = 'awaiting_approval'" in sql
    statuses = captured["args"][1]
    assert "awaiting_approval" not in statuses
    assert set(statuses) == set(jobs_repo._REAPABLE_STATUSES)
    assert captured["args"][0] == niche_id
    assert captured["args"][2] == 45


async def test_image_has_active_sql_blocks_non_terminal(monkeypatch):
    from marketer.repos import image_posts as image_posts_repo

    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return {"exists": 1}

    async def _pool():
        return _Pool()

    monkeypatch.setattr(image_posts_repo, "get_pool", _pool)
    niche_id = uuid4()
    assert await image_posts_repo.has_active_for_niche(niche_id) is True
    sql = " ".join(captured["sql"].split())
    assert "status not in ('done', 'failed')" in sql
    assert captured["args"][0] == niche_id
    assert "awaiting_approval" not in image_posts_repo._REAPABLE_STATUSES


async def test_article_has_active_sql_blocks_non_terminal(monkeypatch):
    from marketer.repos import articles as articles_repo

    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(articles_repo, "get_pool", _pool)
    assert await articles_repo.has_active_for_niche(uuid4()) is False
    sql = " ".join(captured["sql"].split())
    assert "status not in ('done', 'failed')" in sql


async def test_has_active_false_when_no_row(monkeypatch):
    class _Pool:
        async def fetchrow(self, sql, *args):
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(jobs_repo, "get_pool", _pool)
    assert await jobs_repo.has_active_for_niche(uuid4()) is False
