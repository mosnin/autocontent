"""Real-Postgres coverage for decision_log (migration 0026): insert and
read back, user scoping, keyset pagination, the append-only guard, outcome
and correction filled later, FK-cascade erasure, and the migration's
apply / rollback / reapply.

Requires MARKETER_DATABASE_URL pointed at a real Postgres."""
from __future__ import annotations

import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p


@pytest.fixture
async def user(pool):
    uid = f"user_dl_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    yield uid
    await pool.execute("delete from users where id = $1", uid)


async def _insert(uid: str, **over):
    from marketer.repos import decision_log as repo

    kw = dict(
        user_id=uid, point="hook_score", mode="shadow", model="typesafe/jev-1.13-20260917",
        questions_version="hook_score.v1", state_hash="ab" * 32,
        answers={"filler": {"type": "yesno", "probability": 0.2}}, fallback_used=False,
        reason=None, latency_ms=120, cost_usd=Decimal("0.00001234"),
        action_taken="proceed", rule_action="proceed", table_action="regenerate",
        subject_kind="job", subject_id="j1",
    )
    kw.update(over)
    return await repo.insert(**kw)


async def test_insert_and_read_back(pool, user):
    from marketer.repos import decision_log as repo

    new_id = await _insert(user)
    rows = await repo.list_for_user(user)
    assert [r.id for r in rows] == [new_id]
    r = rows[0]
    assert r.answers == {"filler": {"type": "yesno", "probability": 0.2}}
    assert r.cost_usd == Decimal("0.00001234")
    assert r.table_action == "regenerate" and r.outcome is None and r.correction is None


async def test_reads_are_user_scoped(pool, user):
    from marketer.repos import decision_log as repo

    other = f"user_dl_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", other, f"{other}@t.com")
    try:
        mine = await _insert(user)
        theirs = await _insert(other)
        assert [r.id for r in await repo.list_for_user(user)] == [mine]
        assert await repo.record_outcome(theirs, user_id=user, outcome={"x": 1}) is False
    finally:
        await pool.execute("delete from users where id = $1", other)


async def test_keyset_pagination_and_point_filter(pool, user):
    from marketer.repos import decision_log as repo

    ids = [await _insert(user, point="qa_video" if i % 2 else "hook_score") for i in range(5)]
    page1 = await repo.list_for_user(user, limit=2)
    page2 = await repo.list_for_user(user, limit=2, before=(page1[-1].created_at, page1[-1].id))
    page3 = await repo.list_for_user(user, limit=2, before=(page2[-1].created_at, page2[-1].id))
    seen = [r.id for r in page1 + page2 + page3]
    assert len(seen) == 5 and set(seen) == set(ids)
    assert len(set(seen)) == 5
    only = await repo.list_for_user(user, point="qa_video")
    assert {r.point for r in only} == {"qa_video"} and len(only) == 2


async def test_append_only_guard(pool, user):
    new_id = await _insert(user)
    with pytest.raises(asyncpg.RaiseError, match="append-only"):
        await pool.execute("update decision_log set action_taken = 'hold' where id = $1", new_id)
    with pytest.raises(asyncpg.RaiseError, match="append-only"):
        await pool.execute("update decision_log set answers = '{}'::jsonb where id = $1", new_id)


async def test_outcome_and_correction_fill_later(pool, user):
    from marketer.repos import decision_log as repo

    new_id = await _insert(user)
    assert await repo.record_outcome(new_id, user_id=user, outcome={"qa": "passed"})
    assert await repo.record_outcome(new_id, user_id=user, correction={"by": "person", "to": "hold"})
    r = (await repo.list_for_user(user))[0]
    assert r.outcome == {"qa": "passed"}
    assert r.correction == {"by": "person", "to": "hold"}
    assert r.outcome_at is not None


async def test_rows_follow_the_user_on_erasure(pool, user):
    await _insert(user)
    await pool.execute("delete from users where id = $1", user)
    n = await pool.fetchval("select count(*) from decision_log where user_id = $1", user)
    assert n == 0


async def test_mode_check_constraint(pool, user):
    with pytest.raises(asyncpg.CheckViolationError):
        await _insert(user, mode="maybe")


async def test_service_logs_through_the_repo(pool, user, monkeypatch):
    """End to end: a shadow decision written by services.decisions lands as
    a row, with the state hashed and never stored."""
    import httpx

    from marketer.decisions import questions as q
    from marketer.repos import decision_log as repo
    from marketer.services import decisions as svc

    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")
    svc.reset_flag_cache()

    async def handle(request):
        return httpx.Response(200, json={"answers": {"x": {"type": "noul", "noul": 0.7}}, "model": "m",
                                         "usage": {"cost": 0.00002}})

    client = svc.DecisionClient(key="k", transport=httpx.MockTransport(handle))
    state = {"hook": "secret plan for user@example.com"}
    d = await svc.decide(q.Point.QA_VIDEO, state, {"x": q.YesNo("x?")}, user_id=user,
                         client=client)
    await d.log(action="pass", rule_action="pass", table_action="pass")
    rows = await repo.list_for_user(user)
    assert len(rows) == 1 and rows[0].mode == "shadow" and rows[0].fallback_used is False
    raw = await pool.fetchrow("select * from decision_log where id = $1", rows[0].id)
    assert raw["state_hash"] == svc.state_hash(state)
    assert "user@example.com" not in str(dict(raw))


# ---------------------------------------------------------------------------
# Migration 0026 apply / rollback / reapply
# ---------------------------------------------------------------------------


def _run_migrate(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "scripts/migrate.py", *args],
        cwd=REPO_ROOT, capture_output=True, text=True, env={**os.environ},
    )


async def test_migration_0026_apply_rollback_reapply(pool):
    async def exists() -> bool:
        return await pool.fetchval("select to_regclass('public.decision_log') is not null")

    up1 = _run_migrate("up")
    assert up1.returncode == 0, up1.stderr
    assert await exists()

    for _ in range(30):
        down = _run_migrate("down", "1")
        assert down.returncode == 0, down.stderr
        if not await exists():
            break
    assert not await exists(), "decision_log survived rollback"
    assert not await pool.fetchval(
        "select exists(select 1 from pg_proc where proname = 'decision_log_append_only')"
    )

    up2 = _run_migrate("up")
    assert up2.returncode == 0, up2.stderr
    assert await exists()
