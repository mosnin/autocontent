"""First-admin bootstrap: only the configured email, only if no admin exists."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from marketer.models import User


class _Pool:
    def __init__(self, user_row: dict, *, promote: bool = True) -> None:
        self.user_row = user_row
        self.promote = promote
        self.queries: list[str] = []

    async def fetchrow(self, query: str, *args):
        self.queries.append(query)
        if "set role = 'admin'" in query:
            return {"id": args[0]} if self.promote else None
        return _Row(self.user_row)


class _Row:
    def __init__(self, data: dict) -> None:
        self._data = data

    def __iter__(self):
        return iter(self._data.items())

    def __getitem__(self, key):
        return self._data[key]


def _row(user_id: str = "user_1", email: str = "owner@t.com", role: str = "user") -> dict:
    return {
        "id": user_id,
        "email": email,
        "ayrshare_profile_key": None,
        "global_daily_cap_usd": None,
        "credit_balance_usd": Decimal("0"),
        "role": role,
        "suspended_at": None,
        "suspended_reason": None,
        "email_notifications": True,
        "created_at": datetime.now(timezone.utc),
    }


async def test_upsert_promotes_bootstrap_email(monkeypatch):
    from marketer.config import settings
    import marketer.repos.users as users_repo

    monkeypatch.setattr(settings, "bootstrap_admin_email", "owner@t.com")
    pool = _Pool(_row())
    promoted_row = _row(role="admin")

    async def _get_pool():
        return pool

    async def _get(user_id: str):
        return User(**promoted_row)

    monkeypatch.setattr(users_repo, "get_pool", _get_pool)
    monkeypatch.setattr(users_repo, "get", _get)

    user = await users_repo.upsert("user_1", "owner@t.com")
    assert user.role == "admin"
    assert any("set role = 'admin'" in q for q in pool.queries)


async def test_upsert_ignores_non_matching_email(monkeypatch):
    from marketer.config import settings
    import marketer.repos.users as users_repo

    monkeypatch.setattr(settings, "bootstrap_admin_email", "owner@t.com")
    pool = _Pool(_row(email="other@t.com"))

    async def _get_pool():
        return pool

    monkeypatch.setattr(users_repo, "get_pool", _get_pool)
    user = await users_repo.upsert("user_1", "other@t.com")
    assert user.role == "user"
    assert not any("set role = 'admin'" in q for q in pool.queries)


async def test_upsert_skips_when_bootstrap_unset(monkeypatch):
    from marketer.config import settings
    import marketer.repos.users as users_repo

    monkeypatch.setattr(settings, "bootstrap_admin_email", "")
    pool = _Pool(_row())

    async def _get_pool():
        return pool

    monkeypatch.setattr(users_repo, "get_pool", _get_pool)
    user = await users_repo.upsert("user_1", "owner@t.com")
    assert user.role == "user"
    assert not any("set role = 'admin'" in q for q in pool.queries)
