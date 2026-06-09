"""Tests for autocontent.repos.users.

All DB calls are intercepted via monkeypatching asyncpg pool calls, so
no real database is required.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from autocontent.models import User


# ---------------------------------------------------------------------------
# Helpers — fake asyncpg pool
# ---------------------------------------------------------------------------

class _FakePool:
    """Minimal asyncpg pool stand-in for users repo tests."""

    def __init__(self, row: dict) -> None:
        self._row = row
        self.last_query: str = ""
        self.last_args: tuple = ()

    async def fetchrow(self, query: str, *args) -> "_FakeRow":
        self.last_query = query
        self.last_args = args
        return _FakeRow(self._row)

    async def execute(self, query: str, *args) -> None:
        self.last_query = query
        self.last_args = args


class _FakeRow:
    def __init__(self, data: dict) -> None:
        self._data = data

    def __iter__(self):
        return iter(self._data.items())

    def __getitem__(self, key):
        return self._data[key]


def _make_user_row(
    user_id: str = "user_test",
    email: str = "t@t.com",
    global_daily_cap_usd: Decimal | None = None,
) -> dict:
    return {
        "id": user_id,
        "email": email,
        "ayrshare_profile_key": None,
        "global_daily_cap_usd": global_daily_cap_usd,
        "created_at": datetime.now(timezone.utc),
    }


@pytest.fixture
def fake_pool(monkeypatch):
    """Return a factory: `fake_pool(row_dict)` → patches get_pool."""
    import autocontent.repos.users as users_repo

    pools: dict[str, _FakePool] = {}

    def make(row: dict) -> _FakePool:
        pool = _FakePool(row)
        pools["active"] = pool
        return pool

    async def _get_pool():
        return pools["active"]

    monkeypatch.setattr(users_repo, "get_pool", _get_pool)
    return make


# ---------------------------------------------------------------------------
# get() tests
# ---------------------------------------------------------------------------

async def test_get_returns_user_with_global_cap(fake_pool):
    """get() populates global_daily_cap_usd from the DB row."""
    import autocontent.repos.users as users_repo

    fake_pool(_make_user_row(global_daily_cap_usd=Decimal("7.50")))

    user = await users_repo.get("user_test")

    assert user is not None
    assert user.global_daily_cap_usd == Decimal("7.50")


async def test_get_returns_user_with_null_global_cap(fake_pool):
    """get() returns None for global_daily_cap_usd when DB value is NULL."""
    import autocontent.repos.users as users_repo

    fake_pool(_make_user_row(global_daily_cap_usd=None))

    user = await users_repo.get("user_test")

    assert user is not None
    assert user.global_daily_cap_usd is None


# ---------------------------------------------------------------------------
# update_settings() tests
# ---------------------------------------------------------------------------

async def test_update_settings_sets_global_cap(fake_pool):
    """update_settings() updates global_daily_cap_usd and returns User."""
    import autocontent.repos.users as users_repo

    pool = fake_pool(_make_user_row(global_daily_cap_usd=Decimal("20.00")))

    user = await users_repo.update_settings("user_test", global_daily_cap_usd=Decimal("20.00"))

    assert isinstance(user, User)
    assert user.global_daily_cap_usd == Decimal("20.00")
    # The pool was actually called with an UPDATE.
    assert "update users" in pool.last_query.lower()


async def test_update_settings_clears_global_cap(fake_pool):
    """update_settings(global_daily_cap_usd=None) clears the cap."""
    import autocontent.repos.users as users_repo

    fake_pool(_make_user_row(global_daily_cap_usd=None))

    user = await users_repo.update_settings("user_test", global_daily_cap_usd=None)

    assert user.global_daily_cap_usd is None


async def test_update_settings_no_args_returns_current(monkeypatch):
    """Calling update_settings() with no keyword args returns current user."""
    import autocontent.repos.users as users_repo

    expected_user = User(
        id="user_test",
        email="t@t.com",
        global_daily_cap_usd=Decimal("3.00"),
        created_at=datetime.now(timezone.utc),
    )

    async def fake_get(uid: str):
        return expected_user

    monkeypatch.setattr(users_repo, "get", fake_get)

    user = await users_repo.update_settings("user_test")

    assert user.global_daily_cap_usd == Decimal("3.00")
