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


def test_rejected_is_terminal_not_active_or_reapable():
    """Operator veto must not look like a live run. Folding `rejected`
    into the reaper or the overlapping-cron guard would fail a decided
    job as stale, or stall the next campaign window forever."""
    from marketer.models import JobStatus

    assert JobStatus.rejected.value == "rejected"
    assert "rejected" not in jobs_repo._REAPABLE_STATUSES
    assert "awaiting_approval" not in jobs_repo._REAPABLE_STATUSES


async def test_has_active_sql_does_not_treat_rejected_as_live(monkeypatch):
    captured: dict = {}

    class _Pool:
        async def fetchrow(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(jobs_repo, "get_pool", _pool)
    assert await jobs_repo.has_active_for_niche(uuid4()) is False
    sql = " ".join(captured["sql"].split())
    assert "rejected" not in sql
    assert "rejected" not in captured["args"][1]
    assert "awaiting_approval" in sql


async def test_campaign_counts_exclude_rejected_from_produced_and_pending(monkeypatch):
    """A vetoed video is not produced work (would suppress cadence) and
    not in-flight (would block the next spawn as unlanded spend)."""
    from marketer.repos import campaigns as campaigns_repo

    captured: list[str] = []

    class _Pool:
        async def fetch(self, sql, *args):
            captured.append(sql)
            return []

        async def fetchrow(self, sql, *args):
            captured.append(sql)
            return {"pending": 0}

    async def _pool():
        return _Pool()

    monkeypatch.setattr(campaigns_repo, "get_pool", _pool)
    campaign_id = uuid4()
    await campaigns_repo.work_counts(campaign_id, user_id="user_test")
    await campaigns_repo.pending_work_count(campaign_id, user_id="user_test")

    video_sql = " ".join(captured[0].split())
    pending_sql = " ".join(captured[-1].split())
    assert "status not in ('failed', 'skipped', 'rejected')" in video_sql
    assert "status not in ('done', 'failed', 'skipped', 'rejected')" in pending_sql
