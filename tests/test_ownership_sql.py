"""Tenant predicates on write SQL — a dropped user_id is a cross-tenant write.

These functions are the last line of defense after the HTTP layer. The
tests pin the statement, not a live database: a WHERE that loses
`user_id` or the collection `exists` subquery would silently file or
revoke another tenant's rows.
"""
from __future__ import annotations

from uuid import uuid4

from marketer.repos import collections as collections_repo
from marketer.repos import design_projects as design_repo
from marketer.repos import tokens as tokens_repo


class _CapturePool:
    def __init__(self, *, execute_result: str = "INSERT 0 1", fetchrow_result=None):
        self.execute_result = execute_result
        self.fetchrow_result = fetchrow_result
        self.sql = ""
        self.args: tuple = ()

    async def execute(self, sql, *args):
        self.sql = sql
        self.args = args
        return self.execute_result

    async def fetchrow(self, sql, *args):
        self.sql = sql
        self.args = args
        return self.fetchrow_result


def _norm(sql: str) -> str:
    return " ".join(sql.split())


async def test_collection_assign_binds_both_sides(monkeypatch):
    pool = _CapturePool(execute_result="INSERT 0 2")

    async def _pool():
        return pool

    monkeypatch.setattr(collections_repo, "get_pool", _pool)
    collection_id = uuid4()
    article_a = uuid4()
    article_b = uuid4()
    added = await collections_repo.assign(
        collection_id, user_id="user_a", article_ids=[article_a, article_b]
    )
    assert added == 2
    sql = _norm(pool.sql)
    assert "a.user_id = $2" in sql
    assert "exists" in sql
    assert "article_collections c" in sql
    assert "c.id = $1 and c.user_id = $2" in sql
    assert "on conflict (collection_id, article_id) do nothing" in sql
    assert pool.args[0] == collection_id
    assert pool.args[1] == "user_a"
    assert pool.args[2] == [article_a, article_b]


async def test_collection_assign_empty_list_skips_the_database(monkeypatch):
    async def _boom():
        raise AssertionError("empty assign must not touch the pool")

    monkeypatch.setattr(collections_repo, "get_pool", _boom)
    assert await collections_repo.assign(uuid4(), user_id="user_a", article_ids=[]) == 0


async def test_collection_unassign_and_delete_bind_user(monkeypatch):
    pool = _CapturePool(execute_result="DELETE 1")

    async def _pool():
        return pool

    monkeypatch.setattr(collections_repo, "get_pool", _pool)
    collection_id = uuid4()
    article_id = uuid4()

    removed = await collections_repo.unassign(
        collection_id, user_id="user_a", article_ids=[article_id]
    )
    assert removed == 1
    sql = _norm(pool.sql)
    assert "user_id = $2" in sql
    assert "article_id = any($3::uuid[])" in sql
    assert pool.args == (collection_id, "user_a", [article_id])

    assert await collections_repo.delete(collection_id, user_id="user_a") is True
    sql = _norm(pool.sql)
    assert "delete from article_collections" in sql
    assert "id = $1 and user_id = $2" in sql
    assert pool.args == (collection_id, "user_a")


async def test_design_retry_claims_are_terminal_and_tenant_scoped(monkeypatch):
    pool = _CapturePool(fetchrow_result={"id": uuid4()})

    async def _pool():
        return pool

    monkeypatch.setattr(design_repo, "get_pool", _pool)
    project_id = uuid4()

    assert await design_repo.claim_for_retry(project_id, user_id="user_d") is True
    sql = _norm(pool.sql)
    assert "user_id = $2" in sql
    assert "status = 'failed'" in sql
    assert "status in" not in sql
    assert pool.args[:2] == (project_id, "user_d")

    plan = {"steps": []}
    assert await design_repo.claim_step_retry(
        project_id, user_id="user_d", plan=plan
    ) is True
    sql = _norm(pool.sql)
    assert "user_id = $2" in sql
    assert "status in ('done', 'failed')" in sql
    assert pool.args[0] == project_id
    assert pool.args[1] == "user_d"


async def test_design_retry_claim_loser_is_false(monkeypatch):
    pool = _CapturePool(fetchrow_result=None)

    async def _pool():
        return pool

    monkeypatch.setattr(design_repo, "get_pool", _pool)
    assert await design_repo.claim_for_retry(uuid4(), user_id="user_d") is False
    assert await design_repo.claim_step_retry(
        uuid4(), user_id="user_d", plan={}
    ) is False


async def test_token_revoke_binds_owner_and_skips_already_revoked(monkeypatch):
    pool = _CapturePool(execute_result="UPDATE 1")

    async def _pool():
        return pool

    monkeypatch.setattr(tokens_repo, "get_pool", _pool)
    token_id = uuid4()
    assert await tokens_repo.revoke(token_id, "user_t") is True
    sql = _norm(pool.sql)
    assert "id = $1 and user_id = $2" in sql
    assert "revoked_at is null" in sql
    assert pool.args == (token_id, "user_t")

    pool.execute_result = "UPDATE 0"
    assert await tokens_repo.revoke(token_id, "user_other") is False
