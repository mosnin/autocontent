"""Durable idempotency store (see db/migrations/0024_idempotency.sql).

Exactly-once execution around Modal spawns comes down to one atomic
primitive: the first caller to INSERT a given key wins, everyone else's
INSERT is a no-op. ``claim`` is that primitive; everything else here
(`release`, `reap_expired`) is bookkeeping around it.

This module never raises "expected" errors for a lost race — that's just
``claim`` returning ``False``. It *can* raise on genuine DB failures
(connection refused, pool exhausted, etc.); the service layer
(``marketer.services.idempotency``) is what decides to fail open on that.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from ..db import get_pool

DEFAULT_TTL_SECONDS = 6 * 60 * 60  # 6h — comfortably longer than any single
# Modal function timeout in this app (the longest is run_niche_window at 3h),
# so a legitimate retry of genuinely new work never collides with a stale
# claim from a previous, unrelated attempt still "in window".


async def claim(key: str, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> bool:
    """Atomically claim *key*. Returns True iff this call is the first to
    claim it (or the first to reclaim it after the prior claim expired).

    Implemented as a single INSERT ... ON CONFLICT DO UPDATE ... WHERE so
    the fresh-claim and reclaim-after-expiry cases are both one round trip
    with no read-then-write race between them.
    """
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)
    row = await pool.fetchrow(
        """
        insert into idempotency_keys (key, created_at, expires_at, status)
        values ($1, $2, $3, 'claimed')
        on conflict (key) do update
           set created_at = excluded.created_at,
               expires_at = excluded.expires_at,
               status = 'claimed',
               result = null
         where idempotency_keys.expires_at < $2
        returning key
        """,
        key, now, expires_at,
    )
    return row is not None


async def mark_done(key: str, *, result: dict | None = None) -> None:
    """Best-effort breadcrumb that a claimed key finished. Never raises —
    losing this write only costs a debugging detail, not correctness."""
    try:
        pool = await get_pool()
        await pool.execute(
            "update idempotency_keys set status = 'done', result = $2::jsonb where key = $1",
            key, json.dumps(result) if result is not None else None,
        )
    except Exception:  # noqa: BLE001
        pass


async def release(key: str) -> None:
    """Delete a claim outright (e.g. the claimed work turned out to be a
    no-op and a fresh caller should be free to try again immediately
    rather than wait out the TTL). Used sparingly — most callers should
    let the TTL expire naturally so a crashed claimant doesn't leave the
    door open for an actual duplicate mid-flight."""
    pool = await get_pool()
    await pool.execute("delete from idempotency_keys where key = $1", key)


async def reap_expired(*, older_than_minutes: int = 0) -> int:
    """Delete claims whose expires_at has passed (plus an optional grace
    buffer). Keeps the table from growing unboundedly; safe to run
    frequently since it only ever removes rows that can no longer block
    a legitimate reclaim anyway (claim() already ignores unexpired rows
    it doesn't own, and treats expired rows as reclaimable — this just
    reclaims the disk)."""
    pool = await get_pool()
    result = await pool.execute(
        """
        delete from idempotency_keys
         where expires_at < now() - make_interval(mins => $1)
        """,
        older_than_minutes,
    )
    return int(result.split()[-1])
