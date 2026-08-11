"""Per-user and per-niche concurrency caps via Postgres advisory locks.

Postgres advisory locks are session-scoped: they auto-release when the
asyncpg connection is returned to the pool or closed, making them safe
even if the process crashes mid-job.

Lock key scheme
---------------
Postgres advisory locks accept two int32 arguments (key1, key2).  We
partition by "namespace" in key1 and "identity hash" in key2:

  niche lock:  key1 = NICHE_NS (0x4e494348),  key2 = hash(niche_id) % 2**31
  user  slots: key1 = USER_NS  (0x55534552) | slot_index,
               key2 = hash(user_id) % 2**31

The slot-index trick lets us implement a semaphore with max_parallel > 1
using only advisory locks: we create N lock keys per user and take the
first free one.  If all N are taken we fall through and let the
pg_try_advisory_lock loop in _acquire_user_slot block (via asyncio.sleep)
until one frees — a short busy-wait is fine because jobs finish in
minutes, not microseconds.
"""
from __future__ import annotations

import asyncio
import zlib
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

from ..db import get_pool

# Namespace constants (arbitrary stable u16s packed into the high bits of key1).
_NICHE_NS = 0x4E494348  # "NICH" in ASCII hex
_USER_NS = 0x55535200   # "USR\x00" — slot index added at runtime

# How long to pause between retry attempts when all user slots are busy.
_SLOT_RETRY_INTERVAL = 0.5  # seconds


def _niche_key(niche_id: UUID) -> tuple[int, int]:
    """Return (key1, key2) for a per-niche advisory lock."""
    h = zlib.adler32(niche_id.bytes) & 0x7FFF_FFFF  # keep positive int32
    return _NICHE_NS, h


def _user_slot_key(user_id: str, slot: int) -> tuple[int, int]:
    """Return (key1, key2) for one of the N per-user advisory lock slots."""
    h = zlib.adler32(user_id.encode()) & 0x7FFF_FFFF  # keep positive int32
    # Embed the slot index in the low byte of key1 so different slots have
    # different key1 values, keeping key2 identical across slots.
    key1 = (_USER_NS & 0xFFFF_FF00) | (slot & 0xFF)
    return key1, h


@asynccontextmanager
async def niche_lock(niche_id: UUID) -> AsyncIterator[bool]:
    """Try to acquire the exclusive per-niche advisory lock.

    Yields ``True`` if the lock was acquired (caller should proceed).
    Yields ``False`` if another job for the same niche is already running
    (caller should skip / mark the job as skipped).

    The lock is released when the context exits (connection returned to pool).
    """
    pool = await get_pool()
    k1, k2 = _niche_key(niche_id)
    async with pool.acquire() as conn:
        locked: bool = await conn.fetchval(
            "select pg_try_advisory_lock($1, $2)", k1, k2
        )
        try:
            yield locked
        finally:
            if locked:
                await conn.fetchval(
                    "select pg_advisory_unlock($1, $2)", k1, k2
                )


@asynccontextmanager
async def user_lock(user_id: str, *, max_parallel: int) -> AsyncIterator[None]:
    """Acquire one of *max_parallel* advisory-lock slots for *user_id*.

    Blocks (via asyncio.sleep polling) until a slot is free, then holds
    that slot until the context exits (connection returned to pool).

    This is a cooperative advisory lock — no DB rows are created.
    The connection must stay checked-out for the full duration so the
    session-scoped advisory lock remains valid.
    """
    pool = await get_pool()
    acquired_slot: int | None = None

    async with pool.acquire() as conn:
        while acquired_slot is None:
            for slot in range(max_parallel):
                k1, k2 = _user_slot_key(user_id, slot)
                locked: bool = await conn.fetchval(
                    "select pg_try_advisory_lock($1, $2)", k1, k2
                )
                if locked:
                    acquired_slot = slot
                    break
            if acquired_slot is None:
                # All slots busy — yield to the event loop and retry.
                await asyncio.sleep(_SLOT_RETRY_INTERVAL)
        try:
            yield
        finally:
            if acquired_slot is not None:
                k1, k2 = _user_slot_key(user_id, acquired_slot)
                try:
                    await conn.fetchval(
                        "select pg_advisory_unlock($1, $2)", k1, k2
                    )
                except Exception:  # noqa: BLE001 — best-effort; connection close will release
                    pass
