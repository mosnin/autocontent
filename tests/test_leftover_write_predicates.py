"""Tenant and status predicates on leftover write SQL.

#83 pins collections / design / token revoke. #85 pins job/image/article
retry-approve claims and most deletes. These statements are the remaining
last-line-of-defense writes:

- Headshot run/retry claims (double GPU spend on portraits)
- Headshot batch delete (PII portraits)
- Gatekeeper apply claim (double ad-platform call)
- Scheduled-post cron claims (double social post)
- Calendar UNION (cross-tenant feed leak)
- Ad approval decide/execute (replay spend)
- Ads campaign read/update (cross-tenant ad control)

Tests pin the statement, not a live database.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

from marketer.repos import ad_actions as ad_actions_repo
from marketer.repos import ad_approvals as ad_approvals_repo
from marketer.repos import ads as ads_repo
from marketer.repos import calendar as calendar_repo
from marketer.repos import gatekeeper as gatekeeper_repo
from marketer.repos import headshots as headshots_repo
from marketer.repos import scheduled_posts as scheduled_repo


class _CapturePool:
    def __init__(self, *, execute_result: str = "UPDATE 1", fetchrow_result=None):
        self.execute_result = execute_result
        self.fetchrow_result = fetchrow_result
        self.fetchval_result = None
        self.fetch_result: list = []
        self.sql = ""
        self.args: tuple = ()
        self.statements: list[tuple[str, tuple]] = []

    def _record(self, sql, args):
        self.sql = sql
        self.args = args
        self.statements.append((sql, args))

    async def execute(self, sql, *args):
        self._record(sql, args)
        return self.execute_result

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        return self.fetchrow_result

    async def fetchval(self, sql, *args):
        self._record(sql, args)
        return self.fetchval_result

    async def fetch(self, sql, *args):
        self._record(sql, args)
        return self.fetch_result

    @asynccontextmanager
    async def acquire(self):
        yield self

    @asynccontextmanager
    async def transaction(self):
        yield


def _norm(sql: str) -> str:
    return " ".join(sql.split())


def _patch_pool(monkeypatch, module, pool: _CapturePool) -> None:
    async def _pool():
        return pool

    monkeypatch.setattr(module, "get_pool", _pool)


# --------------------------------------------------------------------------- headshots (money + PII)


async def test_headshot_run_claim_is_queued_and_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, headshots_repo, pool)
    batch_id = uuid4()

    assert await headshots_repo.claim_for_run(batch_id, user_id="user_h") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'queued'" in sql
    assert "status = 'running'" in sql
    assert pool.args == (batch_id, "user_h")


async def test_headshot_retry_claim_resets_only_failed_cancelled_variants(monkeypatch):
    pool = _CapturePool(fetchrow_result={"id": uuid4(), "source_image_ids": []})
    _patch_pool(monkeypatch, headshots_repo, pool)
    batch_id = uuid4()

    claimed = await headshots_repo.claim_for_retry(batch_id, user_id="user_h")
    assert claimed is not None

    batch_sql = _norm(pool.statements[0][0])
    assert "id = $1 and user_id = $2 and status in ('failed','partial')" in batch_sql
    assert pool.statements[0][1] == (batch_id, "user_h")

    variant_sql = _norm(pool.statements[1][0])
    assert "batch_id = $1 and status in ('failed','cancelled')" in variant_sql
    assert "status = 'queued'" in variant_sql
    assert "done" not in variant_sql
    assert pool.statements[1][1] == (batch_id,)


async def test_headshot_delete_batch_binds_owner_on_lookup_and_delete(monkeypatch):
    pool = _CapturePool()
    pool.fetchval_result = 1
    pool.fetch_result = [{"image_path": "/tmp/a.png"}]
    _patch_pool(monkeypatch, headshots_repo, pool)
    batch_id = uuid4()

    paths = await headshots_repo.delete_batch(batch_id, user_id="user_h")
    assert paths == ["/tmp/a.png"]

    lookup = _norm(pool.statements[0][0])
    assert "from headshot_batches where id = $1 and user_id = $2" in lookup
    assert pool.statements[0][1] == (batch_id, "user_h")

    delete = _norm(pool.statements[-1][0])
    assert "delete from headshot_batches where id = $1 and user_id = $2" in delete
    assert pool.statements[-1][1] == (batch_id, "user_h")


async def test_headshot_delete_batch_foreign_is_empty_and_does_not_delete(monkeypatch):
    pool = _CapturePool()
    pool.fetchval_result = None
    _patch_pool(monkeypatch, headshots_repo, pool)

    assert await headshots_repo.delete_batch(uuid4(), user_id="user_h") == []
    assert len(pool.statements) == 1
    assert "delete from" not in _norm(pool.statements[0][0])


# --------------------------------------------------------------------------- gatekeeper / scheduled dispatch (double spend / double post)


async def test_gatekeeper_apply_claim_is_approved_only(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, gatekeeper_repo, pool)
    intent_id = uuid4()

    assert await gatekeeper_repo.claim_for_apply(intent_id) is None
    sql = _norm(pool.sql)
    assert "id = $1 and status = 'approved'" in sql
    assert "status = 'applied'" in sql
    assert pool.args == (intent_id,)


async def test_scheduled_claim_due_only_moves_due_scheduled_rows(monkeypatch):
    pool = _CapturePool()
    _patch_pool(monkeypatch, scheduled_repo, pool)
    now = datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)

    assert await scheduled_repo.claim_due(now=now, limit=25) == []
    sql = _norm(pool.sql)
    assert "status = 'scheduled' and scheduled_at <= $1" in sql
    assert "for update skip locked" in sql
    assert "set status = 'dispatching'" in sql
    assert pool.args == (now, 25)


async def test_scheduled_claim_variant_is_pending_only(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, scheduled_repo, pool)
    variant_id = uuid4()

    assert await scheduled_repo.claim_variant(variant_id) is False
    sql = _norm(pool.sql)
    assert "id = $1 and status = 'pending'" in sql
    assert "status = 'dispatching'" in sql
    assert pool.args == (variant_id,)


# --------------------------------------------------------------------------- calendar / ads tenancy


async def test_calendar_union_binds_user_on_every_lane(monkeypatch):
    pool = _CapturePool()
    _patch_pool(monkeypatch, calendar_repo, pool)
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    end = datetime(2026, 9, 30, tzinfo=timezone.utc)

    assert await calendar_repo.items_for_user("user_c", start=start, end=end) == []
    sql = _norm(pool.sql)
    assert sql.count("user_id = $1") == 4
    assert "from jobs" in sql
    assert "from articles" in sql
    assert "from ad_campaigns" in sql
    assert "from scheduled_posts" in sql
    assert pool.args[0] == "user_c"
    assert pool.args[1:] == (start, end)


async def test_ad_approval_decide_and_execute_are_pending_then_approved(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, ad_approvals_repo, pool)
    approval_id = uuid4()

    assert await ad_approvals_repo.decide(
        approval_id, user_id="user_a", status="approved", decided_by="a@t.com"
    ) is None
    decide_sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'pending'" in decide_sql
    assert pool.args[:2] == (approval_id, "user_a")

    await ad_approvals_repo.mark_executed(approval_id, user_id="user_a")
    exec_sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'approved'" in exec_sql
    assert pool.args == (approval_id, "user_a")


async def test_ads_campaign_read_and_update_bind_owner(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, ads_repo, pool)
    campaign_id = uuid4()

    assert await ads_repo.get_campaign(campaign_id, user_id="user_a") is None
    assert "id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (campaign_id, "user_a")

    assert await ads_repo.campaign_metrics(campaign_id, user_id="user_a") == []
    metrics_sql = _norm(pool.sql)
    assert "campaign_id = $1 and user_id = $2" in metrics_sql
    assert pool.args[0] == campaign_id
    assert pool.args[1] == "user_a"

    assert await ads_repo.update_campaign(
        campaign_id, user_id="user_a", status="paused"
    ) is None
    assert "id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args[:2] == (campaign_id, "user_a")


async def test_ad_actions_list_always_binds_user(monkeypatch):
    pool = _CapturePool()
    _patch_pool(monkeypatch, ad_actions_repo, pool)

    assert await ad_actions_repo.list_(user_id="user_a", limit=40) == []
    sql = _norm(pool.sql)
    assert "user_id = $1" in sql
    assert pool.args[0] == "user_a"
    assert pool.args[-1] == 40
