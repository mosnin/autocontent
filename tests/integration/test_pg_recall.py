"""Real-Postgres coverage for recall (0032): the purge queue and job on real
``auth`` rows and a real ``security_audit_log``, against a fake Supermemory.

- a removed member's personal namespace is deleted, nobody else's;
- the job is idempotent, retried until Supermemory confirms, fails closed when
  the auth schema can't answer, and audits ``memory.purge`` with counts only;
- account erasure keeps the queue (no FK) and queues every namespace;
- workspace deletion queues team + personal;
- governed sources read only confirmed facts and published content.

Requires MARKETER_DATABASE_URL with every migration applied."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest

from marketer.recall import purge
from marketer.recall import repo as recall_repo
from marketer.recall import service as recall_service
from marketer.recall.namespace import derive
from marketer.services.supermemory import Breaker, SupermemoryClient
from tests.integration.test_pg_auth import World
from tests.supermemory_fake import TEST_SECRET, FakeSupermemory, fake_config, set_env

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
async def world(pool):
    w = World(pool)
    yield w
    await w.cleanup()


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupermemory()
    set_env(monkeypatch)
    monkeypatch.setattr(recall_service, "client", lambda: SupermemoryClient(fake_config(), transport=f.transport(), breaker=Breaker()))
    return f


async def _start_cursor(pool) -> None:
    last = await pool.fetchval("select coalesce(max(id), 0) from security_audit_log")
    await pool.execute("insert into recall_audit_cursor (name, last_id) values ('security_audit_log', $1) "
                       "on conflict (name) do update set last_id = $1", last)


async def _audit(pool, action: str, **kw) -> int:
    return await pool.fetchval(
        "insert into security_audit_log (action, actor_type, outcome, org_id, tenant_id, actor_id, target_type, target_id) "
        "values ($1, 'user', 'success', $2, $3, $4, $5, $6) returning id",
        action, kw.get("org_id"), kw.get("tenant_id"), kw.get("actor_id"), kw.get("target_type"), kw.get("target_id"),
    )


async def _make_due(pool) -> None:
    await pool.execute("update recall_purge_queue set next_attempt_at = now() where status = 'pending'")


async def _cleanup_queue(pool, tenant: str) -> None:
    await pool.execute("delete from recall_purge_queue where tenant_id = $1", tenant)
    await pool.execute("delete from recall_subjects where tenant_id = $1", tenant)
    await pool.execute("delete from recall_mirror where tenant_id = $1", tenant)


async def test_member_removed_deletes_only_their_namespace(world, pool, fake):
    org, tenant = await world.workspace()
    await pool.execute("insert into users (id, email) values ($1, 'w@t.com') on conflict do nothing", tenant)
    alice, bob = await world.person(), await world.person()
    await world.member(org, alice, "owner")
    await world.member(org, bob, "marketer")
    try:
        await recall_repo.set_setting(tenant, True)
        await recall_repo.register_subject(tenant, alice, org)
        await recall_repo.register_subject(tenant, bob, org)
        ns_a, ns_b = derive("personal", tenant, alice, TEST_SECRET), derive("personal", tenant, bob, TEST_SECRET)
        fake.seed(ns_a, "Alice likes blue")
        fake.seed(ns_b, "Bob likes red")
        await _start_cursor(pool)

        # Web removes Bob: the member row goes, the audit row names the member id.
        member_id = await pool.fetchval('select id from auth.member where "userId" = $1', bob)
        await pool.execute('delete from auth.member where "userId" = $1', bob)
        await _audit(pool, "member.removed", org_id=org, actor_id=alice, target_type="member", target_id=member_id)

        assert (await purge.consume_audit())["queued"] == 1
        assert (await purge.consume_audit()) == {"events": 0, "queued": 0}  # cursor moved

        # First delete fails: stays pending, retried later (fail closed).
        fake.fail_next(503)
        assert (await purge.drain())["failed"] == 1
        row = await pool.fetchrow("select status, attempts, last_error, next_attempt_at > now() as later from recall_purge_queue where tenant_id = $1", tenant)
        assert (row["status"], row["attempts"], row["later"]) == ("pending", 1, True) and row["last_error"] == "server:503"
        assert await purge.drain() == {"done": 0, "failed": 0, "pending": await recall_repo.pending_count()}  # not due yet

        await _make_due(pool)
        assert (await purge.drain())["done"] == 1
        assert ns_b not in fake.ns and fake.texts(ns_a) == ["Alice likes blue"]
        assert await recall_repo.subjects_for_tenant(tenant) == [alice]
        audit = await pool.fetchrow("select actor_type, target_type, metadata from security_audit_log where action = 'memory.purge' and tenant_id = $1 order by id desc limit 1", tenant)
        meta = audit["metadata"] if isinstance(audit["metadata"], dict) else __import__("json").loads(audit["metadata"])
        assert audit["actor_type"] == "system" and audit["target_type"] == "recall_personal"
        assert meta == {"kind": "personal", "reason": "member.removed", "documents": 1, "memories": 1, "existed": True, "attempts": 2}
        assert bob not in str(audit) and "Bob likes" not in str(audit)

        # Idempotent: queueing again while pending is a no-op; again after done queues one more, which 404s → done.
        assert await recall_repo.enqueue("personal", tenant, bob, "member.removed") is True
        assert await recall_repo.enqueue("personal", tenant, bob, "member.removed") is False
        await _make_due(pool)
        assert (await purge.drain())["done"] == 1
    finally:
        await _cleanup_queue(pool, tenant)


async def test_auth_schema_down_stalls_without_losing_the_row(world, pool, fake, monkeypatch):
    org, tenant = await world.workspace()
    bob = await world.person()
    try:
        await recall_repo.register_subject(tenant, bob, org)
        await _start_cursor(pool)
        audit_id = await _audit(pool, "member.removed", org_id=org, target_type="member", target_id="m_x")

        async def down(*a, **k):
            raise ConnectionError("auth db down")

        monkeypatch.setattr(recall_repo, "is_member", down)
        assert await purge.consume_audit() == {"events": 0, "queued": 0}
        assert await recall_repo.get_cursor() < audit_id
        monkeypatch.undo()
        set_env(monkeypatch)
        monkeypatch.setattr(recall_service, "client", lambda: SupermemoryClient(fake_config(), transport=fake.transport(), breaker=Breaker()))
        assert (await purge.consume_audit())["queued"] == 1  # bob is not a member
        assert await recall_repo.get_cursor() >= audit_id
    finally:
        await _cleanup_queue(pool, tenant)


async def test_member_still_in_workspace_is_not_purged(world, pool, fake):
    org, tenant = await world.workspace()
    alice = await world.person()
    await world.member(org, alice, "owner")
    try:
        await recall_repo.register_subject(tenant, alice, org)
        await _start_cursor(pool)
        await _audit(pool, "member.removed", org_id=org, target_type="member", target_id="m_other")
        assert (await purge.consume_audit())["queued"] == 0
    finally:
        await _cleanup_queue(pool, tenant)


async def test_without_a_key_nothing_is_sent_and_rows_stay_pending(world, pool, fake, monkeypatch):
    org, tenant = await world.workspace()
    try:
        await recall_repo.enqueue("team", tenant, None, "recall.disabled")
        monkeypatch.delenv("SUPERMEMORY_API_KEY")
        res = await purge.drain()
        assert res["done"] == 0 and fake.requests == []
        assert await pool.fetchval("select status from recall_purge_queue where tenant_id = $1", tenant) == "pending"
    finally:
        await _cleanup_queue(pool, tenant)


async def test_erasure_keeps_the_queue_and_queues_everything(world, pool, fake):
    from marketer.repos import privacy

    org, tenant = await world.workspace()
    await pool.execute("insert into users (id, email) values ($1, 'w@t.com') on conflict do nothing", tenant)
    alice = await world.person()
    try:
        await recall_repo.register_subject(tenant, alice, org)
        assert await recall_service.enqueue_workspace(tenant, "workspace.erased") == 2
        assert await privacy.erase_user(tenant) is True
        rows = await pool.fetch("select kind, person_id, reason from recall_purge_queue where tenant_id = $1 order by kind", tenant)
        assert [(r["kind"], r["person_id"], r["reason"]) for r in rows] == [("personal", alice, "workspace.erased"), ("team", None, "workspace.erased")]
        # The export does not list recall tables (no user_id column).
        assert "recall_subjects" not in await privacy.export_user(tenant)
        fake.seed(derive("team", tenant, None, TEST_SECRET), "Brand kit")
        await _make_due(pool)
        assert (await purge.drain())["done"] == 2
        assert fake.ns == {}
    finally:
        await _cleanup_queue(pool, tenant)


async def test_workspace_deleted_and_account_deleted_events(world, pool, fake):
    org, tenant = await world.workspace()
    alice = await world.person()
    carol = await world.person()
    org2, tenant2 = await world.workspace()
    await world.member(org2, carol, "owner")
    try:
        await recall_repo.register_subject(tenant, alice, org)
        await recall_repo.register_subject(tenant2, carol, org2)
        await _start_cursor(pool)
        await pool.execute("delete from auth.organization where id = $1", org)
        world.orgs.remove(org)
        await _audit(pool, "workspace.deleted", org_id=org, actor_id=alice)
        await pool.execute('delete from auth."user" where id = $1', carol)
        world.people.remove(carol)
        await _audit(pool, "platform.user_removed", target_type="user", target_id=carol)
        assert (await purge.consume_audit())["queued"] == 3
        kinds = await pool.fetch("select kind, tenant_id, person_id, reason from recall_purge_queue where tenant_id = any($1::text[]) order by tenant_id, kind", [tenant, tenant2])
        got = {(r["kind"], r["tenant_id"], r["person_id"], r["reason"]) for r in kinds}
        assert got == {("personal", tenant, alice, "workspace.deleted"), ("team", tenant, None, "workspace.deleted"), ("personal", tenant2, carol, "account.deleted")}
    finally:
        await _cleanup_queue(pool, tenant)
        await _cleanup_queue(pool, tenant2)


async def test_governed_sources_are_confirmed_facts_and_published_content_only(pool):
    tenant = f"t_{uuid4().hex[:10]}"
    await pool.execute("insert into users (id, email) values ($1, 'g@t.com')", tenant)
    try:
        for trust, value in (("trusted", "warm"), ("unconfirmed", "loud")):
            await pool.execute(
                """insert into memory_facts (user_id, subject_type, subject_name, subject_key, predicate, kind, value,
                       value_hash, source_kind, source_ref, trust, confidence)
                   values ($1, 'brand', 'Pasta', 'pasta', 'voice', 'attribute', $2, md5($2), 'person', 'x', $3, 1)""",
                tenant, value, trust,
            )
        await pool.execute("insert into brand_kits (user_id, brand_name, tagline) values ($1, 'Pasta Club', 'Dinner in ten')", tenant)
        src = await recall_repo.governed_sources(tenant)
        texts = "\n".join(src.values())
        assert "warm" in texts and "loud" not in texts
        assert "Dinner in ten" in src["brand_kit"]
    finally:
        await pool.execute("delete from users where id = $1", tenant)
