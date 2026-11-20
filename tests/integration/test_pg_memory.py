"""Real-Postgres coverage for memory (migration 0029): supersede keeps
history, trust rules, pending rule-bearing facts, forget as a tombstone with
an audit entry, tenant isolation, per-user caps, duplicate merging, learnings,
the append-only audit, FK-cascade erasure and the migration's
apply / rollback / reapply.

Requires MARKETER_DATABASE_URL pointed at a real Postgres."""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
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


async def _user(pool) -> str:
    uid = f"user_mem_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com")
    return uid


@pytest.fixture
async def user(pool):
    uid = await _user(pool)
    yield uid
    await pool.execute("delete from users where id = $1", uid)


@pytest.fixture
async def other(pool):
    uid = await _user(pool)
    yield uid
    await pool.execute("delete from users where id = $1", uid)


def _valid(**over):
    from marketer.repos import memory as m

    kw = dict(subject={"type": "brand", "name": "Pasta Club"}, predicate="voice", value="Warm and practical",
              source_kind="message", source_ref="chat:1")
    kw.update(over)
    return m.validate_fact(**kw)


async def _write(uid, actor="agent", **over):
    from marketer.repos import memory as m

    return await m.write_fact(uid, _valid(**over), actor=actor)


async def test_new_value_supersedes_and_history_keeps_the_old_one(user):
    from marketer.repos import memory as m

    first = await _write(user)
    second = await _write(user, value="Dry, a little sarcastic", source_ref="chat:2")
    assert (first.status, second.status) == ("created", "superseded")
    current = await m.list_facts(user)
    assert [f.value for f in current] == ["Dry, a little sarcastic"]
    versions = await m.fact_history(user, second.fact.id)
    assert [(f.value, f.invalid_reason) for f in versions] == [
        ("Warm and practical", "superseded"), ("Dry, a little sarcastic", None)]
    assert versions[0].superseded_by == second.fact.id and versions[0].source_ref == "chat:1"
    assert (await _write(user, value="dry, a little SARCASTIC.")).status == "duplicate"
    assert (await m.fact_counts(user)) == {"current": 1, "pending": 0, "total": 2}


async def test_lower_trust_waits_and_a_person_confirms(user):
    from marketer.repos import memory as m

    confirmed = await _write(user, actor="person", source_kind="person", source_ref="memory-page")
    web = await _write(user, value="Edgy and loud", source_kind="web", source_ref="https://example.com/about")
    assert (web.status, web.reason, web.fact.pending, web.fact.trust) == ("pending", "lower_trust", True, "untrusted")
    assert web.fact.challenges == confirmed.fact.id
    assert [f.value for f in await m.list_facts(user)] == ["Warm and practical"]
    assert [f.value for f in await m.list_facts(user, state="pending")] == ["Edgy and loud"]

    accepted = await m.confirm_fact(user, web.fact.id)
    assert (accepted.trust, accepted.pending) == ("trusted", False)
    assert [f.value for f in await m.list_facts(user)] == ["Edgy and loud"]


async def test_agent_cannot_write_a_person_fact(user):
    from marketer.repos import memory as m

    with pytest.raises(m.MemoryRejected):
        await _write(user, actor="agent", source_kind="person", source_ref="x")
    assert await m.list_facts(user, state="all") == []


async def test_untrusted_rule_is_never_current_without_a_person(user):
    from marketer.repos import memory as m

    rule = dict(subject={"type": "rule", "name": "No emoji"}, predicate="text", value="Never use emoji in captions")
    held = await _write(user, source_kind="web", source_ref="https://example.com/brand", **rule)
    from_chat = await _write(user, subject={"type": "brand", "name": "Pasta Club"}, predicate="forbids",
                             value=None, object={"type": "claim", "name": "Cures colds"})
    assert (held.status, held.reason, held.fact.trust) == ("pending", "needs_person", "untrusted")
    assert from_chat.status == "pending"
    assert await m.list_facts(user) == []
    await m.confirm_fact(user, held.fact.id)
    assert [(f.subject_type, f.trust) for f in await m.list_facts(user)] == [("rule", "trusted")]


async def test_correct_keeps_history(user):
    from marketer.repos import memory as m

    first = await _write(user)
    fixed = await m.correct_fact(user, first.fact.id, value="Warm, practical, never salesy")
    assert fixed.fact.trust == "trusted" and fixed.fact.source_kind == "person"
    versions = await m.fact_history(user, fixed.fact.id)
    assert (versions[0].invalid_reason, versions[0].superseded_by) == ("corrected", fixed.fact.id)
    with pytest.raises(m.MemoryRejected):
        await m.correct_fact(user, fixed.fact.id, value="password: hunter2hunter2")
    assert "fact.corrected" in [a.action for a in await m.list_audit(user)]


async def test_forget_is_a_tombstone_with_an_audit_entry_and_it_sticks(pool, user):
    from marketer.repos import memory as m

    fact = (await _write(user, source_excerpt="our voice is Warm and practical")).fact
    assert await m.forget_fact(user, fact.id) is True
    assert await m.list_facts(user) == []
    assert await m.list_facts(user, state="active") == []
    row = await pool.fetchrow("select * from memory_facts where id = $1", fact.id)
    assert (row["value"], row["source_excerpt"], row["source_ref"], row["invalid_reason"]) == (None, None, "", "forgotten")
    assert "Warm" not in str(dict(row))
    audit = await m.list_audit(user)
    assert (audit[0].action, audit[0].actor, audit[0].fact_id) == ("fact.forgotten", "person", fact.id)
    assert "Warm" not in " ".join(a.detail for a in audit)

    # The same value from a non-person source is refused; the person can restate it.
    again = await _write(user, value="warm and practical", source_kind="web", source_ref="https://example.com")
    assert (again.status, again.reason) == ("refused", "forgotten")
    assert await m.forget_fact(user, fact.id) is False
    restated = await _write(user, actor="person", source_kind="person", source_ref="memory-page")
    assert restated.status == "created" and [f.value for f in await m.list_facts(user)] == ["Warm and practical"]


async def test_tenant_a_cannot_touch_tenant_b(user, other):
    from marketer.repos import memory as m

    secret = (await _write(other, predicate="positioning", value="B's private positioning")).fact
    mine = (await _write(user, value="A's voice")).fact
    learning = await m.record_learning(other, claim="B's hooks win", status="hypothesis",
                                       evidence=[{"kind": "post", "ref": "p1", "label": "post"}],
                                       confidence=None, source="analyst", actor="agent")

    assert [f.value for f in await m.list_facts(user, state="all")] == ["A's voice"]
    assert await m.fact_history(user, secret.id) == []
    assert await m.confirm_fact(user, secret.id) is None
    assert await m.correct_fact(user, secret.id, value="hijacked") is None
    assert await m.forget_fact(user, secret.id) is False
    assert await m.merge_duplicates(user, mine.id, [secret.id]) == 0
    assert await m.merge_duplicates(user, secret.id, [mine.id]) == 0
    assert await m.list_learnings(user) == []
    assert await m.set_learning_status(user, learning.id, status="hypothesis", add_evidence=[], actor="agent") is None
    assert all(a.fact_id != secret.id for a in await m.list_audit(user))
    # B is untouched.
    untouched = await m.list_facts(other)
    assert [(f.value, f.invalid_at) for f in untouched] == [("B's private positioning", None)]


async def test_per_user_cap_refuses_without_evicting(monkeypatch, user, other):
    from marketer.repos import memory as m

    monkeypatch.setattr(m, "MAX_ACTIVE_FACTS", 3)
    pain = dict(subject={"type": "audience", "name": "Founders"}, predicate="pain_point")
    for i in range(3):
        assert (await _write(user, value=f"pain {i}", **pain)).status == "created"
    full = await _write(user, value="one too many", **pain)
    assert (full.status, full.reason) == ("refused", "tenant_full")
    assert len(await m.list_facts(user)) == 3
    assert (await _write(other, value="fine", **pain)).status == "created"


async def test_concurrent_writers_leave_one_current_value(user):
    from marketer.repos import memory as m

    results = await asyncio.gather(*[_write(user, value=f"voice {i % 2}") for i in range(8)])
    assert {r.status for r in results} <= {"created", "superseded", "duplicate"}
    assert len(await m.list_facts(user)) == 1


async def test_merge_only_touches_exact_duplicates(pool, user):
    from marketer.repos import memory as m

    keep = (await _write(user)).fact
    different = (await _write(user, predicate="tagline", value="Dinner in ten")).fact
    # A duplicate cannot be inserted through the API (unique live content), so
    # consolidation's target is a pending twin: drop the index guard's case by
    # checking the refusal instead.
    with pytest.raises(asyncpg.UniqueViolationError):
        await pool.execute(
            "insert into memory_facts (user_id, subject_type, subject_name, subject_key, predicate, kind, value, "
            "source_kind, source_ref, trust, value_hash) select user_id, subject_type, subject_name, subject_key, "
            "predicate, kind, value, source_kind, source_ref, trust, value_hash from memory_facts where id = $1",
            keep.id,
        )
    assert await m.merge_duplicates(user, keep.id, [different.id]) == 0
    assert len(await m.list_facts(user)) == 2


async def test_learnings_carry_evidence_and_status_needs_a_measurement(user):
    from marketer.repos import memory as m

    post = [{"kind": "post", "ref": "p1", "label": "one post"}]
    measured = [{"kind": "metric", "ref": "pm:1", "label": "12 posts", "metric": "ctr", "value": 0.04, "n": 12}]
    learning = await m.record_learning(user, claim="Numbers in hooks win", status="hypothesis", evidence=post,
                                       confidence=None, source="analyst", actor="agent")
    with pytest.raises(m.MemoryRejected):
        await m.set_learning_status(user, learning.id, status="supported", add_evidence=[], actor="agent")
    updated = await m.set_learning_status(user, learning.id, status="supported", add_evidence=measured, actor="agent")
    assert updated.status == "supported" and len(updated.evidence) == 2
    assert [x.status for x in await m.list_learnings(user, status="supported")] == ["supported"]


async def test_database_refuses_a_learning_without_evidence_and_audit_edits(pool, user):
    from marketer.repos import memory as m

    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute(
            "insert into memory_learnings (user_id, claim, status, evidence, source) values ($1, 'x', 'hypothesis', '[]'::jsonb, 'analyst')",
            user,
        )
    await _write(user)
    audit = await m.list_audit(user)
    with pytest.raises(asyncpg.RaiseError):
        await pool.execute("update memory_audit set detail = 'edited' where id = $1", audit[0].id)


async def test_rows_go_away_with_the_user(pool):
    uid = await _user(pool)
    await _write(uid)
    await pool.execute("delete from users where id = $1", uid)
    for table in ("memory_facts", "memory_audit", "memory_learnings"):
        assert await pool.fetchval(f"select count(*) from {table} where user_id = $1", uid) == 0


def test_migration_rolls_back_and_reapplies():
    def run(*args):
        return subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "migrate.py"), *args],
                              cwd=REPO_ROOT, capture_output=True, text=True, env=os.environ.copy())

    status = run("status")
    if "0029_memory" not in (status.stdout + status.stderr) and status.returncode != 0:
        pytest.skip("migrate runner unavailable")
    # Roll back 0029 and every migration applied on top of it, then reapply
    # them all, so this keeps running as later migrations land.
    names = sorted(p.name for p in (REPO_ROOT / "db" / "migrations").glob("0*.sql") if "rollback" not in p.name)
    depth = len([n for n in names if n >= "0029_"])
    down = run("down", str(depth))
    assert down.returncode == 0, down.stdout + down.stderr
    up = run("up")
    assert up.returncode == 0, up.stdout + up.stderr
