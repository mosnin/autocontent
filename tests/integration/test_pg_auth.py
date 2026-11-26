"""Real-Postgres coverage for Better Auth identity (0030) and workspace roles
(0031): the identity query against real ``auth`` rows, the session JWT path
end to end through the app, personal tokens that die with their creator's
membership, agent delegation capped by a real member, the append-only
``security_audit_log``, and 0031's migration of existing tokens.

Requires MARKETER_DATABASE_URL pointed at a real Postgres with every migration
applied (``scripts/migrate.py up``)."""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest

from tests.auth_helpers import JwtKit

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


class World:
    """Real rows in ``auth`` (as web would write them) plus cleanup."""

    def __init__(self, pool) -> None:
        self.pool = pool
        self.people: list[str] = []
        self.orgs: list[str] = []
        self.tenants: list[str] = []

    async def person(self, *, role: str | None = None, banned: bool = False,
                     ban_expires: datetime | None = None, two_factor: bool = False,
                     verified: bool = True) -> str:
        pid = f"p_{uuid4().hex[:12]}"
        await self.pool.execute(
            '''insert into auth."user" (id, name, email, "emailVerified", role, banned,
                   "banExpires", "twoFactorEnabled")
               values ($1, 'P', $2, $3, $4, $5, $6, $7)''',
            pid, f"{pid}@t.com", verified, role, banned, ban_expires, two_factor,
        )
        self.people.append(pid)
        return pid

    async def workspace(self, *, tenant_id: str | None = None, require_2fa: bool = False) -> tuple[str, str]:
        oid = f"o_{uuid4().hex[:12]}"
        tid = tenant_id or oid
        await self.pool.execute(
            '''insert into auth.organization (id, name, slug, "createdAt", "tenantId", "requireTwoFactor")
               values ($1, 'W', $1, now(), $2, $3)''',
            oid, tid, require_2fa,
        )
        self.orgs.append(oid)
        self.tenants.append(tid)
        return oid, tid

    async def member(self, org: str, person: str, role: str) -> None:
        await self.pool.execute(
            '''insert into auth.member (id, "organizationId", "userId", role, "createdAt")
               values ($1, $2, $3, $4, now())''',
            f"m_{uuid4().hex[:12]}", org, person, role,
        )

    async def session(self, person: str, *, expires_in: timedelta = timedelta(days=7),
                      active_org: str | None = None) -> str:
        sid = f"s_{uuid4().hex[:12]}"
        await self.pool.execute(
            '''insert into auth.session (id, "expiresAt", token, "updatedAt", "userId", "activeOrganizationId")
               values ($1, $2, $3, now(), $4, $5)''',
            sid, datetime.now(timezone.utc) + expires_in, f"tok_{sid}", person, active_org,
        )
        return sid

    async def cleanup(self) -> None:
        for oid in self.orgs:
            await self.pool.execute("delete from auth.organization where id = $1", oid)
        for pid in self.people:
            await self.pool.execute('delete from auth."user" where id = $1', pid)
        for tid in self.tenants:
            await self.pool.execute("delete from users where id = $1", tid)


@pytest.fixture
async def world(pool):
    w = World(pool)
    yield w
    await w.cleanup()


# --------------------------------------------------------------------------- identity query


async def test_identity_query_reads_real_auth_rows(world):
    from marketer.repos import auth_identity

    p = await world.person(two_factor=True)
    org, tenant = await world.workspace(require_2fa=True)
    await world.member(org, p, "marketer")
    sid = await world.session(p, active_org=org)

    row = await auth_identity.session_identity(sid, p, org)
    assert row is not None
    assert (row.person_id, row.member_role, row.tenant_id) == (p, "marketer", tenant)
    assert row.require_two_factor is True and row.two_factor_enabled is True
    assert row.email == f"{p}@t.com" and row.email_verified is True
    assert row.banned is False


async def test_identity_query_refuses_expired_foreign_and_unknown_sessions(world):
    from marketer.repos import auth_identity

    p = await world.person()
    other = await world.person()
    org, _ = await world.workspace()
    await world.member(org, p, "owner")
    expired = await world.session(p, expires_in=timedelta(seconds=-5))
    live = await world.session(p)

    assert await auth_identity.session_identity(expired, p, org) is None
    assert await auth_identity.session_identity(live, other, org) is None  # not theirs
    assert await auth_identity.session_identity("s_nope", p, org) is None


async def test_identity_query_non_member_and_bans(world):
    from marketer.repos import auth_identity

    p = await world.person(banned=True, ban_expires=datetime.now(timezone.utc) - timedelta(hours=1))
    org, _ = await world.workspace()
    sid = await world.session(p)
    row = await auth_identity.session_identity(sid, p, org)
    assert row is not None and row.member_role is None  # not a member
    assert row.banned is False  # the ban expired

    q = await world.person(banned=True)
    sid_q = await world.session(q)
    assert (await auth_identity.session_identity(sid_q, q, org)).banned is True


async def test_membership_for_tenant(world):
    from marketer.repos import auth_identity

    p = await world.person()
    org, tenant = await world.workspace(tenant_id=f"user_clerk_{uuid4().hex[:8]}")
    await world.member(org, p, "billing")
    m = await auth_identity.membership_for_tenant(tenant, p)
    assert (m.org_id, m.role) == (org, "billing")
    assert await auth_identity.membership_for_tenant(tenant, "p_nobody") is None
    assert await auth_identity.org_for_tenant(tenant) == org


# --------------------------------------------------------------------------- end to end


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_session_jwt_end_to_end(world, pool, monkeypatch):
    from backend.main import create_app

    kit = JwtKit.install(monkeypatch)
    owner = await world.person()
    analyst = await world.person()
    org, tenant = await world.workspace()
    await world.member(org, owner, "owner")
    await world.member(org, analyst, "analyst")
    s_owner = await world.session(owner)
    s_analyst = await world.session(analyst)

    app = create_app()
    async with _client(app) as c:
        r = await c.get("/api/v1/users/me", headers={"Authorization": f"Bearer {kit.mint(sub=owner, sid=s_owner, org=org)}"})
        assert r.status_code == 200, r.text
        assert r.json()["id"] == tenant
        # The tenant row was created with the first person's address and is not
        # overwritten by the next member.
        assert await pool.fetchval("select email from users where id = $1", tenant) == f"{owner}@t.com"

        h = {"Authorization": f"Bearer {kit.mint(sub=analyst, sid=s_analyst, org=org)}"}
        assert (await c.get("/api/v1/users/me", headers=h)).status_code == 200
        assert await pool.fetchval("select email from users where id = $1", tenant) == f"{owner}@t.com"

        r = await c.post("/api/v1/tokens", json={"name": "ci"}, headers=h)
        assert r.status_code == 403
        assert r.json() == {"detail": "forbidden", "permission": "api_token:create"}

    row = await pool.fetchrow(
        "select * from security_audit_log where org_id = $1 and action = 'permission.denied' order by id desc limit 1",
        org,
    )
    assert row is not None
    assert (row["actor_id"], row["tenant_id"], row["outcome"], row["actor_type"]) == (analyst, tenant, "denied", "user")


async def test_revoked_session_and_removed_member_stop_working(world, pool, monkeypatch):
    from backend import auth
    from backend.main import create_app

    kit = JwtKit.install(monkeypatch)
    p = await world.person()
    org, _ = await world.workspace()
    await world.member(org, p, "marketer")
    sid = await world.session(p)
    h = {"Authorization": f"Bearer {kit.mint(sub=p, sid=sid, org=org)}"}

    app = create_app()
    async with _client(app) as c:
        assert (await c.get("/api/v1/users/me", headers=h)).status_code == 200
        await pool.execute('delete from auth.member where "userId" = $1', p)
        auth.reset_caches()  # skip the 15 s window
        r = await c.get("/api/v1/users/me", headers=h)
        assert r.status_code == 403 and r.json()["detail"] == "not_a_member"
        await pool.execute("delete from auth.session where id = $1", sid)
        auth.reset_caches()
        assert (await c.get("/api/v1/users/me", headers=h)).status_code == 401


async def test_workspace_requiring_two_factor(world, monkeypatch):
    from backend.main import create_app

    kit = JwtKit.install(monkeypatch)
    p = await world.person(two_factor=False)
    org, _ = await world.workspace(require_2fa=True)
    await world.member(org, p, "owner")
    sid = await world.session(p)
    h = {"Authorization": f"Bearer {kit.mint(sub=p, sid=sid, org=org)}"}
    async with _client(create_app()) as c:
        assert (await c.get("/api/v1/users/me", headers=h)).status_code == 200
        r = await c.get("/api/v1/tokens", headers=h)
        assert r.status_code == 403 and r.json()["detail"] == "mfa_required"


async def test_platform_admin_needs_two_factor(world, monkeypatch):
    from backend.main import create_app
    from marketer.repos import admin as admin_repo

    async def _overview():
        raise RuntimeError("reached")

    monkeypatch.setattr(admin_repo, "overview", _overview)
    kit = JwtKit.install(monkeypatch)
    staff = await world.person(role="admin", two_factor=False)
    org, _ = await world.workspace()
    sid = await world.session(staff)
    h = {"Authorization": f"Bearer {kit.mint(sub=staff, sid=sid, org=org)}"}
    async with _client(create_app()) as c:
        r = await c.get("/api/v1/admin/overview", headers=h)
        assert r.status_code == 403 and r.json()["detail"] == "admin_requires_two_factor"


# --------------------------------------------------------------------------- tokens and delegation


async def test_token_dies_with_its_creators_membership(world, pool):
    from backend import auth
    from marketer.repos import tokens as tokens_repo

    p = await world.person()
    org, tenant = await world.workspace()
    await world.member(org, p, "admin")
    await pool.execute("insert into users (id, email) values ($1, 'w@t.com')", tenant)
    _, plain = await tokens_repo.create(tenant, "ci", role="marketer", created_by=p)

    class Req:
        headers = {"authorization": f"Bearer {plain}"}

    ctx = await auth.require_user(Req())
    assert (ctx.user_id, ctx.actor_id, ctx.role, ctx.actor_type, ctx.org_id) == (tenant, p, "marketer", "token", org)
    assert "campaign:launch" in ctx.permissions and "spend:set_limits" not in ctx.permissions

    await pool.execute('delete from auth.member where "userId" = $1', p)
    with pytest.raises(Exception) as ei:
        await auth.require_user(Req())
    assert getattr(ei.value, "status_code", None) == 401


async def test_legacy_token_keeps_working(world, pool):
    from backend import auth
    from marketer.repos import tokens as tokens_repo

    tenant = f"user_legacy_{uuid4().hex[:8]}"
    world.tenants.append(tenant)
    await pool.execute("insert into users (id, email) values ($1, 'l@t.com')", tenant)
    _, plain = await tokens_repo.create(tenant, "old", role="admin", created_by=tenant)

    class Req:
        headers = {"authorization": f"Bearer {plain}"}

    ctx = await auth.require_user(Req())
    assert ctx.role == "admin" and ctx.actor_id == tenant


async def test_agent_capped_by_a_real_member(world, pool, monkeypatch):
    from backend import auth
    from backend import permissions as perms
    from marketer.config import settings

    monkeypatch.setattr(settings, "agent_service_token", "svc_" + "c" * 40)
    p = await world.person()
    stranger = await world.person()
    org, tenant = await world.workspace()
    await world.member(org, p, "analyst")
    await pool.execute("insert into users (id, email) values ($1, 'w@t.com')", tenant)

    class Req:
        def __init__(self, actor):
            self.headers = {"authorization": "Bearer svc_" + "c" * 40, "x-tenant-id": tenant, "x-actor-id": actor}

    ctx = await auth.require_user(Req(p))
    assert ctx.permissions == perms.agent_permissions("analyst")
    assert (ctx.actor_id, ctx.org_id) == (p, org)
    ctx = await auth.require_user(Req(stranger))
    assert ctx.permissions == perms.agent_permissions(None) and ctx.actor_id == ""


# --------------------------------------------------------------------------- security_audit_log


async def test_audit_log_insert_list_and_paging(pool):
    from marketer.repos import security_audit

    org = f"o_{uuid4().hex[:10]}"
    tenant = f"t_{uuid4().hex[:10]}"
    ids = [
        await security_audit.insert(action="auth.sign_in", actor_type="user", outcome="success",
                                    org_id=org, tenant_id=tenant, actor_id="p1", user_agent="x" * 900,
                                    metadata={"n": i})
        for i in range(3)
    ]
    # A backend row written for an agent with no verified person knows only the tenant.
    agent_id = await security_audit.insert(action="permission.denied", actor_type="agent",
                                           outcome="denied", tenant_id=tenant)
    other = await security_audit.insert(action="auth.sign_in", actor_type="user", outcome="success",
                                        org_id="o_other", tenant_id="t_other")

    page = await security_audit.list_for_org(org, tenant, limit=2)
    assert [e.id for e in page] == [agent_id, ids[2]]
    page2 = await security_audit.list_for_org(org, tenant, limit=10, before_id=page[-1].id)
    assert [e.id for e in page2] == [ids[1], ids[0]]
    assert other not in [e.id for e in page + page2]
    assert len(page2[0].user_agent) == 512
    assert page2[0].metadata == {"n": 1}
    assert await security_audit.list_for_org(None, None) == []


async def test_audit_log_is_append_only(pool):
    from marketer.repos import security_audit

    rid = await security_audit.insert(action="auth.sign_out", actor_type="user", outcome="success")
    for sql in (
        "update security_audit_log set outcome = 'failure' where id = $1",
        "delete from security_audit_log where id = $1",
    ):
        with pytest.raises(asyncpg.PostgresError, match="append-only"):
            await pool.execute(sql, rid)
    with pytest.raises(asyncpg.PostgresError, match="append-only"):
        await pool.execute("truncate security_audit_log")
    assert await pool.fetchval("select count(*) from security_audit_log where id = $1", rid) == 1


async def test_audit_log_constraints(pool):
    for sql, args in (
        ("insert into security_audit_log (actor_type, action, outcome) values ($1, $2, $3)", ("robot", "a.b", "success")),
        ("insert into security_audit_log (actor_type, action, outcome) values ($1, $2, $3)", ("user", "a.b", "maybe")),
        ("insert into security_audit_log (actor_type, action, outcome) values ($1, $2, $3)", ("user", "nodots", "success")),
    ):
        with pytest.raises(asyncpg.CheckViolationError):
            await pool.execute(sql, *args)


async def test_token_role_constraint(pool):
    tenant = f"user_c_{uuid4().hex[:8]}"
    await pool.execute("insert into users (id, email) values ($1, '')", tenant)
    try:
        with pytest.raises(asyncpg.CheckViolationError):
            await pool.execute(
                """insert into personal_access_tokens (user_id, name, token_hash, prefix, role, created_by)
                   values ($1, 'x', $2, 'mkt_x', 'agent', $1)""",
                tenant, uuid4().hex,
            )
    finally:
        await pool.execute("delete from users where id = $1", tenant)


# --------------------------------------------------------------------------- migration


def test_0031_migrates_existing_tokens_and_rolls_back():
    """Roll 0031 back, add a token the old way, reapply: it becomes 'admin'
    with the tenant as creator."""
    import asyncio

    url = os.environ["MARKETER_DATABASE_URL"]

    def run(*args):
        return subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "migrate.py"), *args],
                              cwd=REPO_ROOT, capture_output=True, text=True, env=os.environ.copy())

    names = sorted(p.name for p in (REPO_ROOT / "db" / "migrations").glob("0*.sql") if "rollback" not in p.name)
    depth = len([n for n in names if n >= "0031_"])
    tenant = f"user_mig_{uuid4().hex[:8]}"

    async def q(sql, *args, fetch=False):
        conn = await asyncpg.connect(url)
        try:
            return await (conn.fetchrow(sql, *args) if fetch else conn.execute(sql, *args))
        finally:
            await conn.close()

    down = run("down", str(depth))
    assert down.returncode == 0, down.stdout + down.stderr
    try:
        assert asyncio.run(q(
            "select 1 from information_schema.columns where table_name = 'personal_access_tokens' and column_name = 'role'",
            fetch=True,
        )) is None
        asyncio.run(q("insert into users (id, email) values ($1, '')", tenant))
        asyncio.run(q(
            "insert into personal_access_tokens (user_id, name, token_hash, prefix) values ($1, 'old', $2, 'mkt_o')",
            tenant, uuid4().hex,
        ))
    finally:
        up = run("up")
        assert up.returncode == 0, up.stdout + up.stderr
    row = asyncio.run(q("select role, created_by from personal_access_tokens where user_id = $1", tenant, fetch=True))
    assert (row["role"], row["created_by"]) == ("admin", tenant)
    asyncio.run(q("delete from users where id = $1", tenant))
