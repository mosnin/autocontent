"""Real-Postgres integration tests for the newsletters data layer
(migration 0023: newsletter_settings, newsletter_digests). Skip without
MARKETER_DATABASE_URL -- apply 0023 to that database first (see
db/migrations/0023_newsletters.sql). Local dev DSN:
postgresql://postgres@127.0.0.1:5599/marketer_test
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from marketer.repos import newsletters as newsletters_repo

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


# --------------------------------------------------------------------------- newsletter_settings


async def test_settings_default_missing_then_upsert_roundtrips(pool):
    uid = await _mkuser(pool)
    assert await newsletters_repo.get_settings(uid) is None

    created = await newsletters_repo.upsert_settings(
        uid, enabled=True, cadence="biweekly", send_to="reader@example.com"
    )
    assert created.enabled is True
    assert created.cadence == "biweekly"
    assert created.send_to == "reader@example.com"
    assert created.last_sent_at is None

    fetched = await newsletters_repo.get_settings(uid)
    assert fetched == created


async def test_upsert_settings_is_idempotent_update(pool):
    uid = await _mkuser(pool)
    await newsletters_repo.upsert_settings(uid, enabled=True, cadence="weekly", send_to="")
    updated = await newsletters_repo.upsert_settings(
        uid, enabled=False, cadence="monthly", send_to="new@example.com"
    )
    assert updated.enabled is False
    assert updated.cadence == "monthly"
    assert updated.send_to == "new@example.com"

    rows = await pool.fetch("select count(*) as n from newsletter_settings where user_id = $1", uid)
    assert rows[0]["n"] == 1


async def test_cadence_check_constraint_rejects_bad_value(pool):
    uid = await _mkuser(pool)
    with pytest.raises(Exception):
        await pool.execute(
            "insert into newsletter_settings (user_id, cadence) values ($1, 'daily')", uid
        )


async def test_list_enabled_settings_only_returns_enabled(pool):
    uid_on = await _mkuser(pool)
    uid_off = await _mkuser(pool)
    await newsletters_repo.upsert_settings(uid_on, enabled=True, cadence="weekly", send_to="")
    await newsletters_repo.upsert_settings(uid_off, enabled=False, cadence="weekly", send_to="")

    enabled = await newsletters_repo.list_enabled_settings()
    ids = {s.user_id for s in enabled}
    assert uid_on in ids
    assert uid_off not in ids


async def test_mark_sent_at_updates_last_sent_at(pool):
    uid = await _mkuser(pool)
    await newsletters_repo.upsert_settings(uid, enabled=True, cadence="weekly", send_to="")
    when = datetime.now(timezone.utc).replace(microsecond=0)
    await newsletters_repo.mark_sent_at(uid, when=when)

    fetched = await newsletters_repo.get_settings(uid)
    assert fetched.last_sent_at == when


# --------------------------------------------------------------------------- newsletter_digests


async def test_digest_create_get_list_roundtrip(pool):
    uid = await _mkuser(pool)
    aid1, aid2 = uuid4(), uuid4()

    digest = await newsletters_repo.create_digest(
        user_id=uid, subject="Weekly roundup", markdown="# md", html="<h1>md</h1>",
        article_ids=[aid1, aid2],
    )
    assert digest.status == "draft"
    assert digest.article_ids == [aid1, aid2]
    assert digest.sent_at is None

    fetched = await newsletters_repo.get_digest(digest.id, user_id=uid)
    assert fetched == digest

    listed = await newsletters_repo.list_digests(uid)
    assert len(listed) == 1 and listed[0].id == digest.id

    # Ownership-scoped: a foreign user gets nothing.
    other_uid = await _mkuser(pool)
    assert await newsletters_repo.get_digest(digest.id, user_id=other_uid) is None
    assert await newsletters_repo.list_digests(other_uid) == []


async def test_digest_status_check_constraint(pool):
    uid = await _mkuser(pool)
    with pytest.raises(Exception):
        await pool.execute(
            "insert into newsletter_digests (user_id, status) values ($1, 'bogus')", uid
        )


async def test_mark_sent_sets_status_and_sent_at(pool):
    uid = await _mkuser(pool)
    digest = await newsletters_repo.create_digest(
        user_id=uid, subject="s", markdown="m", html="h", article_ids=[]
    )
    when = datetime.now(timezone.utc).replace(microsecond=0)
    updated = await newsletters_repo.mark_sent(digest.id, sent_at=when)
    assert updated.status == "sent"
    assert updated.sent_at == when
    assert updated.error == ""


async def test_mark_failed_sets_status_and_error(pool):
    uid = await _mkuser(pool)
    digest = await newsletters_repo.create_digest(
        user_id=uid, subject="s", markdown="m", html="h", article_ids=[]
    )
    updated = await newsletters_repo.mark_failed(digest.id, error="resend rejected: 422")
    assert updated.status == "failed"
    assert updated.error == "resend rejected: 422"
    assert updated.sent_at is None


async def test_list_digests_orders_newest_first_and_respects_limit(pool):
    uid = await _mkuser(pool)
    first = await newsletters_repo.create_digest(
        user_id=uid, subject="first", markdown="m", html="h", article_ids=[]
    )
    second = await newsletters_repo.create_digest(
        user_id=uid, subject="second", markdown="m", html="h", article_ids=[]
    )
    listed = await newsletters_repo.list_digests(uid, limit=1)
    assert len(listed) == 1
    assert listed[0].id == second.id
    assert first.id != second.id


async def test_digests_cascade_deleted_with_user(pool):
    uid = await _mkuser(pool)
    await newsletters_repo.upsert_settings(uid, enabled=True, cadence="weekly", send_to="")
    await newsletters_repo.create_digest(
        user_id=uid, subject="s", markdown="m", html="h", article_ids=[]
    )
    await pool.execute("delete from users where id = $1", uid)

    assert await pool.fetchval(
        "select count(*) from newsletter_settings where user_id = $1", uid
    ) == 0
    assert await pool.fetchval(
        "select count(*) from newsletter_digests where user_id = $1", uid
    ) == 0
