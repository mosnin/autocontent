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
