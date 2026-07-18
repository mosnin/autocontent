"""Real-Postgres integration tests for the keyword candidates repo
(migration 0020: keyword_candidates). Skip without MARKETER_DATABASE_URL —
apply 0020 to that database first (see db/migrations/0020_keywords.sql).
Same pattern as tests/test_press_repo_pg.py."""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.repos import keywords as keywords_repo
from marketer.repos import topic_proposals as proposals_repo

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
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


async def _mkniche(pool, user_id: str):
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, visual_style, voice,
            target_duration_sec, scene_count, posting_windows, platforms,
            daily_spend_cap_usd
        )
        values ($1, 'n', 'd', 'aud', 'style', 'voice', 30, 3, '[]'::jsonb,
                '{tiktok}', 5.00)
        returning id
        """,
        user_id,
    )
    return row["id"]


async def test_create_and_get_roundtrip(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    created = await keywords_repo.create(
        user_id=uid, niche_id=nid, keyword="best espresso grinders",
        intent="commercial", rationale="high intent",
    )
    assert created is not None
    assert created.status == "candidate"
    assert created.difficulty is None

    fetched = await keywords_repo.get(created.id, user_id=uid)
    assert fetched is not None
    assert fetched.keyword == "best espresso grinders"


async def test_create_upsert_skips_duplicate(pool):
    """The unique(user_id, niche_id, keyword) constraint is the real
    backstop behind harvest()'s best-effort dedupe prompt: a second
    create() for the same triple returns None instead of raising."""
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)

    first = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="espresso grinders")
    assert first is not None

    second = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="espresso grinders")
    assert second is None

    listed = await keywords_repo.list_for_user(uid, niche_id=nid)
    assert len(listed) == 1


async def test_create_same_keyword_different_niche_is_allowed(pool):
    uid = await _mkuser(pool)
    nid1 = await _mkniche(pool, uid)
    nid2 = await _mkniche(pool, uid)

    a = await keywords_repo.create(user_id=uid, niche_id=nid1, keyword="espresso grinders")
    b = await keywords_repo.create(user_id=uid, niche_id=nid2, keyword="espresso grinders")
    assert a is not None
    assert b is not None
    assert a.id != b.id


async def test_list_for_user_filters_by_niche_and_status(pool):
    uid = await _mkuser(pool)
    nid1 = await _mkniche(pool, uid)
    nid2 = await _mkniche(pool, uid)

    a = await keywords_repo.create(user_id=uid, niche_id=nid1, keyword="kw a")
    await keywords_repo.create(user_id=uid, niche_id=nid2, keyword="kw b")
    await keywords_repo.set_status(a.id, user_id=uid, status="tracked", from_statuses=("candidate",))

    only_nid1 = await keywords_repo.list_for_user(uid, niche_id=nid1)
    assert len(only_nid1) == 1 and only_nid1[0].keyword == "kw a"

    only_tracked = await keywords_repo.list_for_user(uid, status="tracked")
    assert len(only_tracked) == 1 and only_tracked[0].id == a.id

    only_candidate = await keywords_repo.list_for_user(uid, status="candidate")
    assert len(only_candidate) == 1 and only_candidate[0].keyword == "kw b"


async def test_list_for_user_is_scoped_to_owner(pool):
    uid1 = await _mkuser(pool)
    uid2 = await _mkuser(pool)
    nid1 = await _mkniche(pool, uid1)

    await keywords_repo.create(user_id=uid1, niche_id=nid1, keyword="kw")
    assert await keywords_repo.list_for_user(uid2) == []
    assert len(await keywords_repo.list_for_user(uid1)) == 1


async def test_set_status_transition_lifecycle(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    c = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="kw")

    tracked = await keywords_repo.set_status(
        c.id, user_id=uid, status="tracked", from_statuses=("candidate",)
    )
    assert tracked is not None and tracked.status == "tracked"

    # Guarded: a candidate already 'tracked' can't be re-"tracked" from
    # 'candidate' again (one-shot-per-transition, same as topic_proposals.decide).
    again = await keywords_repo.set_status(
        c.id, user_id=uid, status="tracked", from_statuses=("candidate",)
    )
    assert again is None

    promoted = await keywords_repo.set_status(
        c.id, user_id=uid, status="promoted", from_statuses=("candidate", "tracked")
    )
    assert promoted is not None and promoted.status == "promoted"

    # A promoted candidate can't be dismissed out from under whatever it spawned.
    dismiss_attempt = await keywords_repo.set_status(
        c.id, user_id=uid, status="dismissed", from_statuses=("candidate", "tracked")
    )
    assert dismiss_attempt is None


async def test_set_status_scoped_to_owner(pool):
    uid1 = await _mkuser(pool)
    uid2 = await _mkuser(pool)
    nid1 = await _mkniche(pool, uid1)
    c = await keywords_repo.create(user_id=uid1, niche_id=nid1, keyword="kw")

    foreign = await keywords_repo.set_status(
        c.id, user_id=uid2, status="tracked", from_statuses=("candidate",)
    )
    assert foreign is None


async def test_set_difficulty_roundtrip_and_clear(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    c = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="kw")

    scored = await keywords_repo.set_difficulty(c.id, user_id=uid, difficulty=Decimal("42.50"))
    assert scored is not None
    assert scored.difficulty == Decimal("42.50")

    cleared = await keywords_repo.set_difficulty(c.id, user_id=uid, difficulty=None)
    assert cleared is not None
    assert cleared.difficulty is None


async def test_difficulty_out_of_range_rejected_by_db_constraint(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    c = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="kw")

    import asyncpg

    with pytest.raises(asyncpg.CheckViolationError):
        await keywords_repo.set_difficulty(c.id, user_id=uid, difficulty=Decimal("150"))


# --------------------------------------------------------------------------- promote -> topic_proposals handoff (both repos, real DB)


async def test_promote_flow_creates_real_topic_proposal(pool):
    """End-to-end version of the promote route's two-repo handoff against
    real Postgres: guard the status transition, then create the proposal
    with the candidate's rationale carried over — the same sequence
    backend/routes/keywords.py's promote_keyword runs."""
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    c = await keywords_repo.create(
        user_id=uid, niche_id=nid, keyword="best pour-over kettles",
        intent="commercial", rationale="strong buyer intent, thin SERP",
    )

    promoted = await keywords_repo.set_status(
        c.id, user_id=uid, status="promoted", from_statuses=("candidate", "tracked")
    )
    assert promoted is not None and promoted.status == "promoted"

    proposal = await proposals_repo.create(
        user_id=uid, niche_id=promoted.niche_id, title=promoted.keyword,
        focus_keyword=promoted.keyword, rationale=promoted.rationale,
    )
    assert proposal.status == "pending"
    assert proposal.focus_keyword == "best pour-over kettles"
    assert proposal.rationale == "strong buyer intent, thin SERP"

    queue = await proposals_repo.list_for_user(uid, niche_id=nid, status="pending")
    assert len(queue) == 1 and queue[0].id == proposal.id

    fetched = await keywords_repo.get(c.id, user_id=uid)
    assert fetched.status == "promoted"


async def test_promote_twice_does_not_spawn_a_second_proposal(pool):
    uid = await _mkuser(pool)
    nid = await _mkniche(pool, uid)
    c = await keywords_repo.create(user_id=uid, niche_id=nid, keyword="kw")

    first = await keywords_repo.set_status(
        c.id, user_id=uid, status="promoted", from_statuses=("candidate", "tracked")
    )
    assert first is not None
    await proposals_repo.create(user_id=uid, niche_id=nid, title="kw", focus_keyword="kw")

    # Route logic: the guarded transition fails the second time, so the
    # caller never reaches the proposals_repo.create() call again.
    second = await keywords_repo.set_status(
        c.id, user_id=uid, status="promoted", from_statuses=("candidate", "tracked")
    )
    assert second is None

    queue = await proposals_repo.list_for_user(uid, niche_id=nid)
    assert len(queue) == 1
