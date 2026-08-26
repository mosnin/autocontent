"""Admin kill-switches: missing flag allows; explicit false denies."""
from __future__ import annotations

from marketer.repos import feature_flags as flags_repo
from backend.hosted_safety import refuse_if_flag_off

from fastapi import HTTPException


async def test_allowed_true_when_row_missing(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True


async def test_allowed_false_when_disabled(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return False

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("publish") is False


async def test_refuse_if_flag_off_403(monkeypatch):
    async def _allowed(key):
        return key != "billing"

    monkeypatch.setattr(flags_repo, "allowed", _allowed)
    await refuse_if_flag_off("generate")
    try:
        await refuse_if_flag_off("billing")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("expected 403")


async def test_allowed_true_when_explicitly_enabled(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return True

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True


async def test_allowed_fail_open_when_pool_raises(monkeypatch):
    """A missing table / unreachable DB must not freeze generate or publish."""

    async def _pool():
        raise RuntimeError("no pool")

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("publish") is True


async def test_allowed_fail_open_when_fetch_raises(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            raise RuntimeError("relation feature_flags does not exist")

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True
