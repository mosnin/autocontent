"""Real-Postgres coverage for the idempotency store: concurrent claim
races to exactly one winner, expired claims are reclaimable and reaped,
and migration 0024 applies/rolls back/reapplies cleanly.

Requires MARKETER_DATABASE_URL pointed at a real Postgres (see
tests/integration/test_pg_*.py for the pattern this follows)."""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

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
    async with p.acquire() as conn:
        await conn.execute("delete from idempotency_keys")


def _key() -> str:
    return f"test:{uuid4().hex}"


# ---------------------------------------------------------------------------
# Repo-level claim semantics
# ---------------------------------------------------------------------------

async def test_claim_first_caller_wins(pool):
    from marketer.repos import idempotency as repo

    key = _key()
    assert await repo.claim(key) is True
    assert await repo.claim(key) is False


async def test_concurrent_claims_exactly_one_true(pool):
    """The whole point of the table: N callers racing the same key must
    produce exactly one True — this is the double-click / cron-overlap
    scenario for real, under actual Postgres concurrency (not asyncio
    cooperative scheduling alone)."""
    from marketer.repos import idempotency as repo
    from marketer import db

    key = _key()

    async def _try_claim() -> bool:
        # Each racer gets its own pool-acquired connection implicitly via
        # repo.claim -> get_pool(); the shared pool is fine since asyncpg
        # pools are safe for concurrent use across coroutines.
        return await repo.claim(key)

    results = await asyncio.gather(*[_try_claim() for _ in range(25)])
    assert results.count(True) == 1
    assert results.count(False) == 24
    # sanity: pool is actually the real one, not accidentally mocked
    assert db._pool is not None


async def test_claim_reclaimable_after_expiry(pool):
    from marketer.repos import idempotency as repo

    key = _key()
    assert await repo.claim(key, ttl_seconds=0) is True
    # ttl_seconds=0 means expires_at is effectively "now" — a claim
    # attempted shortly after should see it as expired and reclaim it.
    await asyncio.sleep(0.05)
    assert await repo.claim(key, ttl_seconds=60) is True


async def test_claim_not_reclaimable_before_expiry(pool):
    from marketer.repos import idempotency as repo

    key = _key()
    assert await repo.claim(key, ttl_seconds=3600) is True
    assert await repo.claim(key, ttl_seconds=3600) is False


async def test_mark_done_and_release(pool):
    from marketer.repos import idempotency as repo

    key = _key()
    assert await repo.claim(key) is True
    await repo.mark_done(key, result={"ok": True})

    row = await pool.fetchrow("select status, result from idempotency_keys where key = $1", key)
    assert row["status"] == "done"

    await repo.release(key)
    assert await repo.claim(key) is True  # released -> immediately reclaimable


# ---------------------------------------------------------------------------
# Reaper
# ---------------------------------------------------------------------------

async def test_reap_expired_deletes_only_expired(pool):
    from marketer.repos import idempotency as repo

    fresh_key = _key()
    stale_key = _key()

    await repo.claim(fresh_key, ttl_seconds=3600)
    # Force an already-expired row directly (simulating a claim made long ago).
    await pool.execute(
        """
        insert into idempotency_keys (key, created_at, expires_at, status)
        values ($1, now() - interval '2 hours', now() - interval '1 hour', 'claimed')
        """,
        stale_key,
    )

    reaped = await repo.reap_expired()
    assert reaped >= 1

    remaining = {r["key"] for r in await pool.fetch("select key from idempotency_keys")}
    assert stale_key not in remaining
    assert fresh_key in remaining


async def test_reap_expired_with_grace_buffer(pool):
    from marketer.repos import idempotency as repo

    key = _key()
    # Expired 5 minutes ago.
    await pool.execute(
        """
        insert into idempotency_keys (key, created_at, expires_at, status)
        values ($1, now() - interval '10 minutes', now() - interval '5 minutes', 'claimed')
        """,
        key,
    )
    # A 30-minute grace buffer should NOT reap it yet.
    reaped = await repo.reap_expired(older_than_minutes=30)
    assert reaped == 0
    remaining = {r["key"] for r in await pool.fetch("select key from idempotency_keys")}
    assert key in remaining

    # No buffer reaps it.
    reaped = await repo.reap_expired(older_than_minutes=0)
    assert reaped == 1


# ---------------------------------------------------------------------------
# Service-level claim_spawn against the real store
# ---------------------------------------------------------------------------

async def test_service_claim_spawn_against_real_db(pool):
    from marketer.services import idempotency

    key = _key()
    assert await idempotency.claim_spawn(key) is True
    assert await idempotency.claim_spawn(key) is False


async def test_service_claim_spawn_fails_open_when_pool_broken(pool, monkeypatch):
    """Point get_pool at a DSN that will fail to connect, and confirm the
    service still returns True (proceed) rather than raising."""
    from marketer import db
    from marketer.services import idempotency

    async def _broken_pool():
        raise ConnectionError("simulated outage")

    monkeypatch.setattr(db, "get_pool", _broken_pool)
    # Also patch the repo module's get_pool reference since it imported it directly.
    from marketer.repos import idempotency as repo
    monkeypatch.setattr(repo, "get_pool", _broken_pool)

    result = await idempotency.claim_spawn(_key())
    assert result is True


# ---------------------------------------------------------------------------
# Migration 0024 apply / rollback / reapply
# ---------------------------------------------------------------------------

def _run_migrate(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "scripts/migrate.py", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ},
    )


async def test_migration_0024_apply_rollback_reapply(pool):
    async def _table_exists() -> bool:
        row = await pool.fetchrow(
            "select to_regclass('public.idempotency_keys') is not null as exists"
        )
        return row["exists"]

    # Apply everything (idempotent — yoyo skips already-applied migrations).
    up1 = _run_migrate("up")
    assert up1.returncode == 0, up1.stderr
    assert await _table_exists()

    # Roll back one migration (0024, assuming it's the latest applied).
    down = _run_migrate("down", "1")
    assert down.returncode == 0, down.stderr
    assert not await _table_exists()

    # Reapply.
    up2 = _run_migrate("up")
    assert up2.returncode == 0, up2.stderr
    assert await _table_exists()
