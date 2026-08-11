"""Real-Postgres tests for kits: CRUD, single-default invariant, resolve
precedence (pinned > default > none), tenant scoping."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from users")


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    return uid


async def test_crud_and_single_default(pool):
    from marketer.repos import kits

    uid = await _mkuser(pool)
    a = await kits.create(
        user_id=uid, kind="design", name="Kit A", content="rule A", is_default=True,
    )
    assert a.is_default

    # creating a second default flips the first
    b = await kits.create(
        user_id=uid, kind="design", name="Kit B", content="rule B", is_default=True,
    )
    a_after = await kits.get(a.id, user_id=uid)
    assert b.is_default and not a_after.is_default

    # promoting A back via update flips B
    await kits.update(a.id, user_id=uid, is_default=True)
    assert (await kits.get(b.id, user_id=uid)).is_default is False

    # defaults are per-kind: a writing default coexists
    w = await kits.create(
        user_id=uid, kind="writing", name="Voice", content="short sentences",
        is_default=True,
    )
    assert w.is_default and (await kits.get(a.id, user_id=uid)).is_default

    listed = await kits.list_for_user(uid, kind="design")
    assert {k.name for k in listed} == {"Kit A", "Kit B"}

    assert await kits.delete(b.id, user_id=uid)
    assert await kits.get(b.id, user_id=uid) is None


async def test_resolve_precedence_and_scoping(pool):
    from marketer.repos import kits

    uid, other = await _mkuser(pool), await _mkuser(pool)
    default = await kits.create(
        user_id=uid, kind="design", name="Default", content="d", is_default=True,
    )
    pinned = await kits.create(
        user_id=uid, kind="design", name="Pinned", content="p",
    )
    theirs = await kits.create(
        user_id=other, kind="design", name="Theirs", content="t",
    )

    # pinned wins
    r = await kits.resolve(user_id=uid, kind="design", kit_id=pinned.id)
    assert r.id == pinned.id
    # no pin -> default
    r = await kits.resolve(user_id=uid, kind="design", kit_id=None)
    assert r.id == default.id
    # someone else's kit id can't be pinned across tenants -> falls to default
    r = await kits.resolve(user_id=uid, kind="design", kit_id=theirs.id)
    assert r.id == default.id
    # kind mismatch falls through to default of the requested kind
    r = await kits.resolve(user_id=uid, kind="writing", kit_id=pinned.id)
    assert r is None  # no writing default exists

    # ad-kit rules roundtrip
    ad = await kits.create(
        user_id=uid, kind="ad", name="Scale", rules={"target_roas": 2.5},
    )
    assert (await kits.get(ad.id, user_id=uid)).rules == {"target_roas": 2.5}
