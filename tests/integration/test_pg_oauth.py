"""Real-Postgres coverage for the OAuth 2.1 authorization server.

tests/test_oauth_provider.py drives the routes against an in-memory store,
which proves the protocol logic. What it cannot prove is the part that only
Postgres decides: that a code is claimable exactly once and a refresh token
rotatable exactly once under genuine concurrency, that revoking a grant
really does take every token and unspent code with it, and that a deleted
account takes its grants with it through the FK cascade.

Requires MARKETER_DATABASE_URL pointed at a real Postgres (see the other
tests/integration/test_pg_*.py for the pattern this follows).
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)

REPO_ROOT = Path(__file__).resolve().parents[2]

_REDIRECT_URI = "https://acme.example/oauth/callback"


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from oauth_clients where name = 'integration test client'")
        await conn.execute("delete from users where email = 'oauth-integration@example.test'")


@pytest.fixture
async def user_id(pool) -> str:
    uid = f"user_oauth_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, 'oauth-integration@example.test')", uid
    )
    return uid


@pytest.fixture
async def client_id(pool) -> str:
    from marketer.repos import oauth as repo

    cid = f"mkoc_{uuid4().hex[:12]}"
    await repo.create_client(
        client_id=cid,
        name="integration test client",
        redirect_uris=[_REDIRECT_URI],
        scopes=["openid", "offline_access"],
    )
    return cid


async def _grant(user_id: str, client_id: str):
    from marketer.repos import oauth as repo

    return await repo.create_grant(
        user_id=user_id,
        client_id=client_id,
        scopes=["openid", "offline_access"],
        resource="https://marketer.sh/api",
        redirect_uri=_REDIRECT_URI,
    )


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


async def test_client_round_trips_with_its_registration(pool, client_id: str) -> None:
    from marketer.repos import oauth as repo

    client = await repo.get_client(client_id)
    assert client is not None
    assert client.redirect_uris == [_REDIRECT_URI]
    assert client.is_active
    assert not client.is_confidential  # no secret stored -> public client

    assert await repo.disable_client(client_id) is True
    assert await repo.disable_client(client_id) is False  # already off
    disabled = await repo.get_client(client_id)
    assert disabled is not None and not disabled.is_active


# ---------------------------------------------------------------------------
# Single-use codes, under real concurrency
# ---------------------------------------------------------------------------


async def test_authorization_code_is_claimable_exactly_once(
    pool, user_id: str, client_id: str
) -> None:
    from marketer.repos import oauth as repo

    grant = await _grant(user_id, client_id)
    code_hash = uuid4().hex
    await repo.create_authorization_code(
        code_hash=code_hash,
        grant_id=grant.id,
        code_challenge="c" * 43,
        code_challenge_method="S256",
        redirect_uri=_REDIRECT_URI,
        resource="",
        expires_at=_now() + timedelta(minutes=10),
    )

    outcomes = await asyncio.gather(
        *[repo.consume_authorization_code(code_hash) for _ in range(20)]
    )
    statuses = [o.status for o in outcomes]
    assert statuses.count("consumed") == 1
    assert statuses.count("replayed") == 19


async def test_unknown_code_is_unknown_not_replayed(pool) -> None:
    from marketer.repos import oauth as repo

    outcome = await repo.consume_authorization_code(uuid4().hex)
    assert outcome.status == "unknown"
    assert outcome.code is None


# ---------------------------------------------------------------------------
# Refresh rotation, under real concurrency
# ---------------------------------------------------------------------------


async def test_refresh_token_rotates_exactly_once(pool, user_id: str, client_id: str) -> None:
    from marketer.repos import oauth as repo

    grant = await _grant(user_id, client_id)
    token_hash = uuid4().hex
    token = await repo.create_token(
        grant_id=grant.id,
        kind="refresh",
        token_hash=token_hash,
        scopes=["openid", "offline_access"],
        expires_at=_now() + timedelta(days=30),
    )

    results = await asyncio.gather(*[repo.rotate_refresh_token(token.id) for _ in range(20)])
    assert results.count(True) == 1
    assert results.count(False) == 19

    # The loser of the race sees a token that is both rotated and dead, which
    # is what the route reports as replay.
    spent = await repo.get_token_by_hash(token_hash)
    assert spent is not None
    assert spent.rotated_at is not None
    assert spent.revoked_at is not None


async def test_access_token_cannot_be_rotated(pool, user_id: str, client_id: str) -> None:
    from marketer.repos import oauth as repo

    grant = await _grant(user_id, client_id)
    token = await repo.create_token(
        grant_id=grant.id,
        kind="access",
        token_hash=uuid4().hex,
        scopes=["openid"],
        expires_at=_now() + timedelta(hours=1),
    )
    assert await repo.rotate_refresh_token(token.id) is False


# ---------------------------------------------------------------------------
# Revocation takes the whole family
# ---------------------------------------------------------------------------


async def test_revoking_a_grant_kills_tokens_and_unspent_codes(
    pool, user_id: str, client_id: str
) -> None:
    from marketer.repos import oauth as repo

    grant = await _grant(user_id, client_id)
    access_hash, refresh_hash, code_hash = uuid4().hex, uuid4().hex, uuid4().hex
    await repo.create_token(
        grant_id=grant.id,
        kind="access",
        token_hash=access_hash,
        scopes=["openid"],
        expires_at=_now() + timedelta(hours=1),
    )
    await repo.create_token(
        grant_id=grant.id,
        kind="refresh",
        token_hash=refresh_hash,
        scopes=["openid", "offline_access"],
        expires_at=_now() + timedelta(days=30),
    )
    await repo.create_authorization_code(
        code_hash=code_hash,
        grant_id=grant.id,
        code_challenge="c" * 43,
        code_challenge_method="S256",
        redirect_uri=_REDIRECT_URI,
        resource="",
        expires_at=_now() + timedelta(minutes=10),
    )

    await repo.revoke_grant(grant.id, "client_revocation")

    revoked = await repo.get_grant(grant.id)
    assert revoked is not None and not revoked.is_live
    assert revoked.revoked_reason == "client_revocation"
    for token_hash in (access_hash, refresh_hash):
        token = await repo.get_token_by_hash(token_hash)
        assert token is not None and token.revoked_at is not None
    # An unspent code cannot be exchanged after the grant dies.
    assert (await repo.consume_authorization_code(code_hash)).status == "replayed"


async def test_erasing_the_account_erases_its_grants(pool, user_id: str, client_id: str) -> None:
    """DELETE /users/me must not leave a live grant behind."""
    from marketer.repos import oauth as repo

    grant = await _grant(user_id, client_id)
    await repo.create_token(
        grant_id=grant.id,
        kind="access",
        token_hash=uuid4().hex,
        scopes=["openid"],
        expires_at=_now() + timedelta(hours=1),
    )

    await pool.execute("delete from users where id = $1", user_id)

    assert await repo.get_grant(grant.id) is None
    leftover = await pool.fetchval(
        "select count(*) from oauth_tokens where grant_id = $1", grant.id
    )
    assert leftover == 0


# ---------------------------------------------------------------------------
# Pending consent rows
# ---------------------------------------------------------------------------


async def test_consent_request_is_single_use_and_bound_to_its_user(
    pool, user_id: str, client_id: str
) -> None:
    from marketer.repos import oauth as repo

    pending = await repo.create_authorization_request(
        user_id=user_id,
        client_id=client_id,
        redirect_uri=_REDIRECT_URI,
        scopes=["openid"],
        state="xyz",
        code_challenge="c" * 43,
        code_challenge_method="S256",
        resource="",
        expires_at=_now() + timedelta(minutes=10),
    )

    # Somebody else's session cannot answer it.
    assert await repo.consume_authorization_request(pending.id, "user_someone_else") is None

    claimed = await repo.consume_authorization_request(pending.id, user_id)
    assert claimed is not None and claimed.state == "xyz"
    # And it cannot be answered twice.
    assert await repo.consume_authorization_request(pending.id, user_id) is None


async def test_expired_consent_request_cannot_be_claimed(
    pool, user_id: str, client_id: str
) -> None:
    from marketer.repos import oauth as repo

    pending = await repo.create_authorization_request(
        user_id=user_id,
        client_id=client_id,
        redirect_uri=_REDIRECT_URI,
        scopes=["openid"],
        state="",
        code_challenge="c" * 43,
        code_challenge_method="S256",
        resource="",
        expires_at=_now() - timedelta(seconds=1),
    )
    assert await repo.consume_authorization_request(pending.id, user_id) is None


# ---------------------------------------------------------------------------
# Migration 0041 apply / rollback / reapply
# ---------------------------------------------------------------------------


def _run_migrate(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "scripts/migrate.py", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ},
    )


async def test_migration_0041_apply_rollback_reapply(pool) -> None:
    async def _tables_exist() -> bool:
        row = await pool.fetchrow(
            """
            select to_regclass('public.oauth_clients') is not null
               and to_regclass('public.oauth_grants') is not null
               and to_regclass('public.oauth_authorization_codes') is not null
               and to_regclass('public.oauth_authorization_requests') is not null
               and to_regclass('public.oauth_tokens') is not null as exists
            """
        )
        return row["exists"]

    up1 = _run_migrate("up")
    assert up1.returncode == 0, up1.stderr
    assert await _tables_exist()

    # Roll back one at a time until the OAuth tables are gone, so this stays
    # correct once later migrations stack on top of 0041.
    later = sum(
        1
        for path in (REPO_ROOT / "db" / "migrations").glob("*.sql")
        if not path.name.endswith(".rollback.sql")
        and path.name[:4].isdigit()
        and int(path.name[:4]) > 41
    )
    for _ in range(later + 1):
        down = _run_migrate("down", "1")
        assert down.returncode == 0, down.stderr
        if not await _tables_exist():
            break
    assert not await _tables_exist(), "oauth tables survived rollback"

    up2 = _run_migrate("up")
    assert up2.returncode == 0, up2.stderr
    assert await _tables_exist()
