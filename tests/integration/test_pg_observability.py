"""Real-Postgres coverage for the observability setting (0033): the default,
the check constraint, the repo, the span pipeline's lookup, and the route end
to end with the audit row.

Requires MARKETER_DATABASE_URL with every migration applied."""
from __future__ import annotations

import os
from uuid import uuid4

import asyncpg
import pytest

from marketer.observability import context as obs_context
from marketer.repos import observability as repo

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    db._auth_pool = None
    p = await db.get_pool()
    yield p


@pytest.fixture
async def tenant(pool):
    tid = f"t_obs_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", tid, f"{tid}@example.test")
    obs_context.forget_cache()
    yield tid
    await pool.execute("delete from users where id = $1", tid)
    obs_context.forget_cache()


async def test_default_is_redacted(tenant):
    s = await repo.get_setting(tenant)
    assert s.content == "redacted" and s.updated_at is None


async def test_set_and_read_back(tenant):
    s = await repo.set_setting(tenant, "metadata")
    assert s.content == "metadata" and s.updated_at is not None
    assert (await repo.get_setting(tenant)).content == "metadata"


async def test_check_constraint_refuses_other_values(pool, tenant):
    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute("update users set observability_content = 'full' where id = $1", tenant)
    with pytest.raises(ValueError):
        await repo.set_setting(tenant, "full")


async def test_unknown_tenant(pool):
    assert (await repo.get_setting("t_obs_missing")).content == "redacted"
    with pytest.raises(LookupError):
        await repo.set_setting("t_obs_missing", "metadata")


async def test_span_pipeline_reads_the_workspace_setting(tenant, monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "braintrust_content", "redacted")
    assert await obs_context.content_mode_for(tenant) == "redacted"
    await repo.set_setting(tenant, "metadata")
    obs_context.forget_cache()
    assert await obs_context.content_mode_for(tenant) == "metadata"
    # The deployment's metadata wins over a workspace's redacted.
    await repo.set_setting(tenant, "redacted")
    monkeypatch.setattr(settings, "braintrust_content", "metadata")
    assert await obs_context.content_mode_for(tenant) == "metadata"


async def test_route_writes_and_audits(pool, tenant, monkeypatch):
    import httpx

    from backend.main import create_app
    from backend.rate_limit import limiter
    from tests.auth_helpers import as_role

    monkeypatch.setattr(limiter, "enabled", False)
    app = create_app()
    actor = f"p_{uuid4().hex[:8]}"
    as_role(app, "owner", user_id=tenant, actor_id=actor)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.put("/api/v1/observability/settings", json={"content": "metadata"})
        assert r.status_code == 200, r.text
        g = await c.get("/api/v1/observability/settings")
    assert g.json()["content"] == "metadata"
    row = await pool.fetchrow(
        "select actor_id, outcome, metadata::text as md from security_audit_log "
        "where tenant_id = $1 and action = 'observability.settings_changed' order by id desc limit 1",
        tenant,
    )
    assert row is not None and row["actor_id"] == actor and row["outcome"] == "success"
    assert '"content": "metadata"' in row["md"]
