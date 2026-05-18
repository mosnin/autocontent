"""Tests for autocontent.services.concurrency.

All tests mock the asyncpg pool/connection layer so no live Postgres is
required in CI.  The mock faithfully implements try-lock / unlock
semantics using a plain Python set of held keys, making the concurrency
assertions meaningful.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest

from autocontent.services.concurrency import (
    _niche_key,
    _user_slot_key,
    niche_lock,
    user_lock,
)


# ---------------------------------------------------------------------------
# Shared fake-pool machinery
# ---------------------------------------------------------------------------

class FakeConn:
    """Minimal asyncpg connection that implements advisory lock semantics."""

    def __init__(self, held_keys: set[tuple[int, int]]) -> None:
        self._held = held_keys  # shared across all connections in the fake pool

    async def fetchval(self, query: str, *args):
        if "pg_try_advisory_lock" in query:
            key = (args[0], args[1])
            if key in self._held:
                return False
            self._held.add(key)
            return True
        if "pg_advisory_unlock" in query:
            key = (args[0], args[1])
            self._held.discard(key)
            return True
        raise AssertionError(f"unexpected query: {query}")


class FakePool:
    """Minimal asyncpg pool that hands out FakeConns sharing the same key set."""

    def __init__(self) -> None:
        self._held: set[tuple[int, int]] = set()

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[FakeConn]:
        yield FakeConn(self._held)

    async def release(self, conn: FakeConn) -> None:
        pass  # advisory locks stay on the shared _held set (simulating session lock behaviour)


def _make_pool_patch(pool: FakePool):
    """Return a context manager that patches get_pool to return *pool*."""
    return patch(
        "autocontent.services.concurrency.get_pool",
        new=AsyncMock(return_value=pool),
    )


# ---------------------------------------------------------------------------
# niche_lock tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_niche_lock_acquired_yields_true():
    pool = FakePool()
    niche_id = uuid4()
    with _make_pool_patch(pool):
        async with niche_lock(niche_id) as got:
            assert got is True


@pytest.mark.asyncio
async def test_niche_lock_second_same_niche_yields_false():
    """Two concurrent niche_lock calls for the same niche: second yields False."""
    pool = FakePool()
    niche_id = uuid4()
    results: list[bool] = []

    with _make_pool_patch(pool):
        async with niche_lock(niche_id) as got1:
            results.append(got1)
            # While the first lock is held, try the same niche.
            async with niche_lock(niche_id) as got2:
                results.append(got2)

    assert results == [True, False]


@pytest.mark.asyncio
async def test_niche_lock_different_niches_both_yield_true():
    """Different niche IDs do not block each other."""
    pool = FakePool()
    niche_a = uuid4()
    niche_b = uuid4()
    results: list[bool] = []

    with _make_pool_patch(pool):
        async with niche_lock(niche_a) as got_a:
            async with niche_lock(niche_b) as got_b:
                results.extend([got_a, got_b])

    assert results == [True, True]


@pytest.mark.asyncio
async def test_niche_lock_released_after_context_exit():
    """After context exits the lock key is removed so the next caller succeeds."""
    pool = FakePool()
    niche_id = uuid4()
    k1, k2 = _niche_key(niche_id)

    with _make_pool_patch(pool):
        async with niche_lock(niche_id) as got:
            assert got is True
            assert (k1, k2) in pool._held

        # Lock should be released now.
        assert (k1, k2) not in pool._held

        async with niche_lock(niche_id) as got2:
            assert got2 is True


@pytest.mark.asyncio
async def test_niche_lock_released_on_exception():
    """Lock must be released even if the body raises."""
    pool = FakePool()
    niche_id = uuid4()
    k1, k2 = _niche_key(niche_id)

    with _make_pool_patch(pool):
        with pytest.raises(RuntimeError):
            async with niche_lock(niche_id) as got:
                assert got is True
                raise RuntimeError("boom")

        assert (k1, k2) not in pool._held


# ---------------------------------------------------------------------------
# user_lock tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_lock_single_slot_acquired():
    pool = FakePool()
    with _make_pool_patch(pool):
        # user_lock does pool.acquire() directly (not via asynccontextmanager),
        # so we need the pool's release method too.
        async with user_lock("user_abc", max_parallel=1):
            pass  # just confirm no exception


@pytest.mark.asyncio
async def test_user_lock_two_of_two_slots_enter_immediately():
    """With max_parallel=2, two concurrent acquires both enter without waiting."""
    pool = FakePool()
    entered: list[int] = []
    barrier = asyncio.Event()

    async def task(idx: int) -> None:
        with _make_pool_patch(pool):
            async with user_lock("user_two", max_parallel=2):
                entered.append(idx)
                # Hold the lock until the barrier is released.
                await barrier.wait()

    t1 = asyncio.create_task(task(1))
    t2 = asyncio.create_task(task(2))
    # Give both tasks a chance to acquire their slots.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert len(entered) == 2, f"expected 2 entries, got {entered}"
    barrier.set()
    await asyncio.gather(t1, t2)


@pytest.mark.asyncio
async def test_user_lock_third_waits_then_enters():
    """With max_parallel=2, a third task blocks until one slot is released."""
    pool = FakePool()
    entered: list[int] = []
    released_slot = asyncio.Event()

    async def holder(idx: int, release_event: asyncio.Event | None = None) -> None:
        with _make_pool_patch(pool):
            async with user_lock("user_three", max_parallel=2):
                entered.append(idx)
                if release_event:
                    await release_event.wait()

    # Start two holders that block until released_slot is set.
    t1 = asyncio.create_task(holder(1, released_slot))
    t2 = asyncio.create_task(holder(2, released_slot))
    await asyncio.sleep(0.05)  # let them acquire
    assert len(entered) == 2

    # Third task should be blocked (no slot available).
    t3 = asyncio.create_task(holder(3))
    await asyncio.sleep(0.1)
    assert 3 not in entered, "third task should not have entered yet"

    # Release one slot — t3 should now enter.
    released_slot.set()
    await asyncio.gather(t1, t2, t3)
    assert 3 in entered


@pytest.mark.asyncio
async def test_user_lock_released_on_exception():
    """Slot is released even when the body raises."""
    pool = FakePool()
    user = "user_exc"
    slot_key = _user_slot_key(user, 0)

    with _make_pool_patch(pool):
        with pytest.raises(ValueError):
            async with user_lock(user, max_parallel=1):
                assert slot_key in pool._held
                raise ValueError("oops")

        assert slot_key not in pool._held


# ---------------------------------------------------------------------------
# Key-space sanity checks (pure functions, no I/O)
# ---------------------------------------------------------------------------

def test_niche_key_is_stable():
    nid = UUID("12345678-1234-5678-1234-567812345678")
    assert _niche_key(nid) == _niche_key(nid)


def test_user_slot_keys_differ_by_slot():
    k0 = _user_slot_key("user_x", 0)
    k1 = _user_slot_key("user_x", 1)
    assert k0 != k1
    # key2 (the user hash) should be the same across slots.
    assert k0[1] == k1[1]


def test_niche_and_user_namespaces_do_not_collide():
    # Even if niche_id bytes happen to produce the same hash as user_id,
    # key1 differs by namespace so the pairs cannot be equal.
    nid = uuid4()
    k_niche = _niche_key(nid)
    k_user = _user_slot_key(str(nid), 0)
    assert k_niche[0] != k_user[0]
