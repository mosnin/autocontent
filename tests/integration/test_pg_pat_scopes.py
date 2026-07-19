"""Real-Postgres tests for scoped PATs.

Covers:
  * migration 0026 apply/rollback/reapply (schema-level, via psql/yoyo,
    exercised once at module import so a broken migration fails loudly)
  * repo-level create/get/list round-tripping scopes end to end
  * backward compat: a token predating the scopes column still resolves
    with the {read,write} default
  * the DB-level CHECK constraint rejecting an unknown scope
  * auth.require_user resolving a real PAT row's scopes into AuthCtx, and
    enforce_method_scope / require_scope enforcing them end to end
"""
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


# ---------------------------------------------------------------------------
# Migration 0026: apply / rollback / reapply
# ---------------------------------------------------------------------------


class TestMigrationRoundtrip:
    def test_apply_rollback_reapply(self):
        """Runs the actual migration runner against the real DB configured
        via MARKETER_DATABASE_URL, rolling 0026 back and forward again to
        prove both directions are safe and idempotent."""
        import scripts.migrate as migrate_mod

        # Ensure we start fully up to date (harness runs migrations before
        # tests too, but be defensive).
        migrate_mod.up()

        status_before = migrate_mod.status()
        assert status_before["pending"] == 0

        migrate_mod.down(n=1)
        status_after_down = migrate_mod.status()
        assert status_after_down["pending"] == 1

        migrate_mod.up()
        status_after_up = migrate_mod.status()
        assert status_after_up["pending"] == 0


class TestScopesColumn:
    async def test_new_row_defaults_to_read_write(self, pool):
        uid = await _mkuser(pool)
        row = await pool.fetchrow(
            """
            insert into personal_access_tokens (user_id, name, token_hash, prefix)
            values ($1, 'legacy-style-insert', 'hash1', 'mkt_aaaa')
            returning scopes
            """,
            uid,
        )
        assert sorted(row["scopes"]) == ["read", "write"]

    async def test_check_constraint_rejects_unknown_scope(self, pool):
        import asyncpg

        uid = await _mkuser(pool)
        with pytest.raises(asyncpg.CheckViolationError):
            await pool.execute(
                """
                insert into personal_access_tokens
                    (user_id, name, token_hash, prefix, scopes)
                values ($1, 'bad', 'hash2', 'mkt_bbbb', array['superuser'])
                """,
                uid,
            )

    async def test_admin_scope_alone_is_accepted(self, pool):
        uid = await _mkuser(pool)
        row = await pool.fetchrow(
            """
            insert into personal_access_tokens (user_id, name, token_hash, prefix, scopes)
            values ($1, 'admin-tok', 'hash3', 'mkt_cccc', array['admin'])
            returning scopes
            """,
            uid,
        )
        assert row["scopes"] == ["admin"]


# ---------------------------------------------------------------------------
# marketer.repos.tokens — create/get/list round-tripping scopes
# ---------------------------------------------------------------------------


class TestTokensRepoScopes:
    async def test_create_default_scopes_read_write(self, pool):
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        info, plaintext = await tokens.create(user_id=uid, name="default")
        assert info.scopes == ["read", "write"]
        assert plaintext.startswith("mkt_")

    async def test_create_explicit_scopes_roundtrip(self, pool):
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        info, plaintext = await tokens.create(user_id=uid, name="ro", scopes=["read"])
        assert info.scopes == ["read"]

        fetched = await tokens.get_by_token(plaintext)
        assert fetched.scopes == ["read"]

    async def test_create_invalid_scopes_raises_before_insert(self, pool):
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        with pytest.raises(ValueError):
            await tokens.create(user_id=uid, name="bad", scopes=["nope"])
        # Nothing was inserted.
        listed = await tokens.list_for_user(uid)
        assert listed == []

    async def test_get_by_token_returns_scopes(self, pool):
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        info, plaintext = await tokens.create(user_id=uid, name="scoped", scopes=["write"])
        fetched = await tokens.get_by_token(plaintext)
        assert fetched is not None
        assert fetched.scopes == ["write"]
        assert fetched.id == info.id

    async def test_list_for_user_includes_scopes(self, pool):
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        await tokens.create(user_id=uid, name="a", scopes=["admin"])
        listed = await tokens.list_for_user(uid)
        assert len(listed) == 1
        assert listed[0].scopes == ["admin"]

    async def test_scopes_never_widened_on_existing_token(self, pool):
        """Creating never mutates an existing row — a second create() call
        for the same user makes an entirely new token/row; the original's
        scopes are untouched."""
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        first, _ = await tokens.create(user_id=uid, name="first", scopes=["read"])
        await tokens.create(user_id=uid, name="second", scopes=["read", "write", "admin"])

        listed = {t.id: t for t in await tokens.list_for_user(uid)}
        assert listed[first.id].scopes == ["read"]


# ---------------------------------------------------------------------------
# backend.auth — real PAT resolution end to end
# ---------------------------------------------------------------------------


class _FakeRequest:
    def __init__(self, authorization: str, method: str = "GET") -> None:
        self.headers = {"authorization": authorization}
        self.method = method
        self.client = None

        class _State:
            pass

        self.state = _State()


class TestAuthResolutionWithRealPat:
    async def test_read_scoped_pat_refused_on_write(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        _, plaintext = await tokens.create(user_id=uid, name="ro", scopes=["read"])

        req = _FakeRequest(f"Bearer {plaintext}", method="POST")
        ctx = await auth.require_user(req)
        assert ctx.scopes == ["read"]
        with pytest.raises(Exception) as ei:
            await auth.enforce_method_scope(req, ctx=ctx)
        assert getattr(ei.value, "status_code", None) == 403

    async def test_read_scoped_pat_allowed_on_read(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        _, plaintext = await tokens.create(user_id=uid, name="ro", scopes=["read"])

        req = _FakeRequest(f"Bearer {plaintext}", method="GET")
        ctx = await auth.require_user(req)
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == uid

    async def test_write_scoped_pat_allowed_on_write(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        _, plaintext = await tokens.create(user_id=uid, name="rw", scopes=["write"])

        req = _FakeRequest(f"Bearer {plaintext}", method="POST")
        ctx = await auth.require_user(req)
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == uid

    async def test_admin_scope_gates_admin_route(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        await pool.execute("update users set role = 'admin' where id = $1", uid)

        _, no_admin_plaintext = await tokens.create(
            user_id=uid, name="rw", scopes=["read", "write"]
        )
        _, admin_plaintext = await tokens.create(user_id=uid, name="admin", scopes=["admin"])

        req_denied = _FakeRequest(f"Bearer {no_admin_plaintext}")
        with pytest.raises(Exception) as ei:
            await auth.require_admin(req_denied)
        assert getattr(ei.value, "status_code", None) == 403

        req_allowed = _FakeRequest(f"Bearer {admin_plaintext}")
        admin_ctx = await auth.require_admin(req_allowed)
        assert admin_ctx.user_id == uid

    async def test_backward_compat_token_without_explicit_scopes_gets_default(self, pool):
        """A token created via a raw insert that doesn't specify scopes
        (mirroring a pre-migration row) still resolves as read+write."""
        from backend import auth
        from marketer.repos import tokens as tokens_repo_module

        uid = await _mkuser(pool)
        plaintext = tokens_repo_module.generate_plaintext()
        token_hash = tokens_repo_module.hash_token(plaintext)
        prefix = tokens_repo_module.display_prefix(plaintext)
        await pool.execute(
            """
            insert into personal_access_tokens (user_id, name, token_hash, prefix)
            values ($1, 'pre-existing', $2, $3)
            """,
            uid,
            token_hash,
            prefix,
        )

        req = _FakeRequest(f"Bearer {plaintext}", method="POST")
        ctx = await auth.require_user(req)
        assert sorted(ctx.scopes) == ["read", "write"]
        # A mutating request succeeds — the old token keeps full behaviour.
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == uid

    async def test_jwt_context_has_no_scopes_and_full_access(self, monkeypatch):
        """Not PAT-related, but confirms the real (unmocked) require_user
        JWT branch still yields scopes=None end to end with the DB layer
        present (users_repo.upsert hits the real pool)."""
        from backend import auth
        from marketer.repos import users as users_repo

        def _signing_key(_token):
            class K:
                key = "fake"

            return K()

        import jwt as pyjwt

        class _FakeJWKS:
            def get_signing_key_from_jwt(self, token):
                return _signing_key(token)

        monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
        uid = f"user_jwt_{uuid4().hex[:8]}"
        monkeypatch.setattr(
            pyjwt, "decode", lambda *a, **kw: {"sub": uid, "email": "jwt@x.com"}
        )

        req = _FakeRequest("Bearer eyJ.some.jwt", method="DELETE")
        ctx = await auth.require_user(req)
        assert ctx.scopes is None
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == uid

        # cleanup the upserted user row
        await users_repo.get(uid)  # sanity: exists
        from marketer import db

        pool = await db.get_pool()
        await pool.execute("delete from users where id = $1", uid)


# ---------------------------------------------------------------------------
# Per-token rate-limit key: two different real tokens key differently
# ---------------------------------------------------------------------------


class TestPerTokenRateLimitKey:
    async def test_two_tokens_for_same_user_key_differently(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        _, plaintext_a = await tokens.create(user_id=uid, name="a")
        _, plaintext_b = await tokens.create(user_id=uid, name="b")

        req_a = _FakeRequest(f"Bearer {plaintext_a}")
        req_b = _FakeRequest(f"Bearer {plaintext_b}")
        await auth.require_user(req_a)
        await auth.require_user(req_b)

        key_a = auth.token_or_ip_key(req_a)
        key_b = auth.token_or_ip_key(req_b)
        assert key_a != key_b
        assert key_a.startswith("pat:")
        assert key_b.startswith("pat:")

    async def test_same_token_reused_keys_identically(self, pool):
        from backend import auth
        from marketer.repos import tokens

        uid = await _mkuser(pool)
        _, plaintext = await tokens.create(user_id=uid, name="repeat")

        req1 = _FakeRequest(f"Bearer {plaintext}")
        req2 = _FakeRequest(f"Bearer {plaintext}")
        await auth.require_user(req1)
        await auth.require_user(req2)

        assert auth.token_or_ip_key(req1) == auth.token_or_ip_key(req2)
