"""Tenant predicates on leftover write SQL — a dropped user_id is a
cross-tenant write.

#83 pins collections / design / token revoke. These statements are the
remaining last-line-of-defense writes: retry claims (double GPU spend),
approve/reject claims (double social post), delete/archive (erasing
another tenant), and library composition status. Tests pin the
statement, not a live database.
"""
from __future__ import annotations

from uuid import uuid4

from marketer.repos import ad_creatives as ad_creatives_repo
from marketer.repos import articles as articles_repo
from marketer.repos import dramas as dramas_repo
from marketer.repos import headshots as headshots_repo
from marketer.repos import image_posts as image_posts_repo
from marketer.repos import jobs as jobs_repo
from marketer.repos import media as media_repo
from marketer.repos import motion_projects as motion_repo
from marketer.repos import niches as niches_repo
from marketer.repos import personas as personas_repo
from marketer.repos import scheduled_posts as scheduled_repo
from marketer.repos import seo_audits as seo_audits_repo
from marketer.repos import trend_reports as trend_repo
from marketer.repos import ugc_renders as ugc_repo


class _CapturePool:
    def __init__(self, *, execute_result: str = "UPDATE 1", fetchrow_result=None):
        self.execute_result = execute_result
        self.fetchrow_result = fetchrow_result
        self.fetch_result: list = []
        self.sql = ""
        self.args: tuple = ()

    async def execute(self, sql, *args):
        self.sql = sql
        self.args = args
        return self.execute_result

    async def fetchrow(self, sql, *args):
        self.sql = sql
        self.args = args
        return self.fetchrow_result

    async def fetch(self, sql, *args):
        self.sql = sql
        self.args = args
        return self.fetch_result


def _norm(sql: str) -> str:
    return " ".join(sql.split())


def _patch_pool(monkeypatch, module, pool: _CapturePool) -> None:
    async def _pool():
        return pool

    monkeypatch.setattr(module, "get_pool", _pool)


# --------------------------------------------------------------------------- retry / approve claims (money + double-post)


async def test_job_reject_and_approve_claims_are_tenant_and_awaiting(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, jobs_repo, pool)
    job_id = uuid4()

    assert await jobs_repo.claim_for_rejection(job_id, user_id="user_j") is None
    sql = _norm(pool.sql)
    assert "user_id = $2" in sql
    assert "status = 'awaiting_approval'" in sql
    assert "status = 'rejected'" in sql
    assert pool.args[:2] == (job_id, "user_j")

    assert await jobs_repo.claim_for_scheduling(job_id, user_id="user_j") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'awaiting_approval'" in sql
    assert "status = 'scheduling'" in sql
    assert pool.args == (job_id, "user_j")


async def test_image_post_retry_and_approve_claims_are_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, image_posts_repo, pool)
    post_id = uuid4()

    assert await image_posts_repo.claim_for_retry(post_id, user_id="user_i") is False
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'failed'" in sql
    assert pool.args == (post_id, "user_i")

    assert await image_posts_repo.claim_for_scheduling(post_id, user_id="user_i") is False
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'awaiting_approval'" in sql
    assert pool.args == (post_id, "user_i")


async def test_article_retry_claim_is_failed_and_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, articles_repo, pool)
    article_id = uuid4()
    assert await articles_repo.claim_for_retry(article_id, user_id="user_a") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'failed'" in sql
    assert pool.args == (article_id, "user_a")


async def test_ugc_retry_clears_stale_provider_id_and_binds_tenant(monkeypatch):
    """Leaving provider_request_id attached lets a late webhook complete
    the *new* retry. The claim must null it and stay tenant-scoped."""
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, ugc_repo, pool)
    render_id = uuid4()
    assert await ugc_repo.claim_for_retry(render_id, user_id="user_u") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'failed'" in sql
    assert "provider_request_id = null" in sql
    assert pool.args == (render_id, "user_u")


async def test_motion_drama_ads_trend_retry_claims_are_failed_and_tenant(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    project_id = uuid4()
    drama_id = uuid4()
    slot_id = uuid4()
    report_id = uuid4()

    _patch_pool(monkeypatch, motion_repo, pool)
    assert await motion_repo.claim_for_retry(project_id, user_id="user_m") is False
    assert "id = $1 and user_id = $2 and status = 'failed'" in _norm(pool.sql)
    assert pool.args == (project_id, "user_m")

    _patch_pool(monkeypatch, dramas_repo, pool)
    assert await dramas_repo.claim_for_retry(drama_id, user_id="user_d") is None
    assert "id = $1 and user_id = $2 and status = 'failed'" in _norm(pool.sql)
    assert pool.args == (drama_id, "user_d")

    _patch_pool(monkeypatch, ad_creatives_repo, pool)
    assert await ad_creatives_repo.claim_slot_for_retry(slot_id, user_id="user_c") is False
    assert "id = $1 and user_id = $2 and status = 'failed'" in _norm(pool.sql)
    assert pool.args == (slot_id, "user_c")

    _patch_pool(monkeypatch, trend_repo, pool)
    assert await trend_repo.claim_for_retry(report_id, user_id="user_t") is False
    assert "id = $1 and user_id = $2 and status = 'failed'" in _norm(pool.sql)
    assert pool.args == (report_id, "user_t")


async def test_scheduled_publish_now_and_delete_are_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result={"status": "scheduled", "deleted": 1})
    _patch_pool(monkeypatch, scheduled_repo, pool)
    post_id = uuid4()

    assert await scheduled_repo.delete(post_id, user_id="user_s") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2" in sql
    assert pool.args[0] == post_id
    assert pool.args[1] == "user_s"
    assert set(pool.args[2]) == {"scheduled", "failed"}
    assert "dispatching" not in pool.args[2]
    assert "posted" not in pool.args[2]

    pool.fetchrow_result = None
    assert await scheduled_repo.claim_for_publish_now(post_id, user_id="user_s") is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2 and status = 'scheduled'" in sql
    assert pool.args == (post_id, "user_s")

    slot_id = uuid4()
    assert await scheduled_repo.delete_slot(slot_id, user_id="user_s") is False
    assert "id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (slot_id, "user_s")


# --------------------------------------------------------------------------- delete / archive (tenancy + PII)


async def test_niche_archive_binds_owner(monkeypatch):
    pool = _CapturePool()
    _patch_pool(monkeypatch, niches_repo, pool)
    niche_id = uuid4()
    await niches_repo.archive(niche_id, user_id="user_n")
    sql = _norm(pool.sql)
    assert "archived_at = now()" in sql
    assert "id = $1 and user_id = $2" in sql
    assert pool.args == (niche_id, "user_n")


async def test_persona_and_seo_and_ugc_and_headshot_deletes_bind_owner(monkeypatch):
    pool = _CapturePool(execute_result="DELETE 1", fetchrow_result=None)
    persona_id = uuid4()
    audit_id = uuid4()
    render_id = uuid4()
    source_id = uuid4()

    _patch_pool(monkeypatch, personas_repo, pool)
    assert await personas_repo.delete(persona_id, user_id="user_p") is True
    assert "delete from brand_personas where id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (persona_id, "user_p")

    _patch_pool(monkeypatch, seo_audits_repo, pool)
    assert await seo_audits_repo.delete(audit_id, user_id="user_e") is False
    assert "delete from seo_audits where id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (audit_id, "user_e")

    _patch_pool(monkeypatch, ugc_repo, pool)
    assert await ugc_repo.delete(render_id, user_id="user_u") is True
    assert "delete from ugc_renders where id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (render_id, "user_u")

    _patch_pool(monkeypatch, headshots_repo, pool)
    assert await headshots_repo.delete_source(source_id, user_id="user_h") is None
    assert "delete from headshot_sources where id = $1 and user_id = $2" in _norm(pool.sql)
    assert pool.args == (source_id, "user_h")


# --------------------------------------------------------------------------- library compositions


async def test_library_bulk_and_composition_writes_are_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)
    _patch_pool(monkeypatch, media_repo, pool)
    asset_a = uuid4()
    asset_b = uuid4()
    comp_id = uuid4()

    assert await media_repo.get_assets_bulk([asset_a, asset_b], user_id="user_l") == []
    sql = _norm(pool.sql)
    assert "user_id = $1" in sql
    assert "id = any($2::uuid[])" in sql
    assert pool.args == ("user_l", [asset_a, asset_b])

    assert await media_repo.set_composition_status(
        comp_id, user_id="user_l", status="failed", error="spawn failed"
    ) is None
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2" in sql
    assert pool.args[0] == comp_id
    assert pool.args[1] == "user_l"
    assert pool.args[2] == "failed"

    assert await media_repo.claim_composition_for_render(
        comp_id, user_id="user_l"
    ) is False
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2" in sql
    assert "status = 'queued'" in sql
    assert "status = 'rendering'" in sql
    assert "20 minutes" in sql
    assert pool.args == (comp_id, "user_l")
