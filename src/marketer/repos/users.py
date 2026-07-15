from __future__ import annotations

from decimal import Decimal

from ..db import get_pool
from ..models import User

# Single source of truth for the User projection. credit_balance_usd, role,
# and suspension were previously omitted here — the API reported balance 0
# and no role regardless of the row (prior audit M14).
_COLS = (
    "id, email, ayrshare_profile_key, global_daily_cap_usd, "
    "credit_balance_usd, role, suspended_at, suspended_reason, created_at"
)


async def upsert(user_id: str, email: str) -> User:
    """Idempotent insert keyed on Clerk user_id. Called from auth middleware
    on first request so the FK from niches/jobs always resolves."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into users (id, email) values ($1, $2)
        -- Never let a token without an email claim (default Clerk session
        -- tokens) blank out a stored address on every request.
        on conflict (id) do update
            set email = case when excluded.email <> '' then excluded.email
                             else users.email end
        returning {_COLS}
        """,
        user_id,
        email,
    )
    return User(**dict(row))


async def get(user_id: str) -> User | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from users where id = $1",
        user_id,
    )
    return User(**dict(row)) if row else None


async def set_ayrshare_profile_key(user_id: str, key: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update users set ayrshare_profile_key = $2 where id = $1", user_id, key
    )


async def update_settings(
    user_id: str,
    *,
    global_daily_cap_usd: Decimal | None = ...,  # type: ignore[assignment]
) -> User:
    """Partial-update user settings. Only fields explicitly passed are updated.

    Pass ``global_daily_cap_usd=None`` to clear the cap; omit the keyword
    argument entirely to leave the current value unchanged.  Uses a
    sentinel default so callers can distinguish "not provided" from ``None``.
    """
    _UNSET = ...  # module-level sentinel for type-checker friendliness

    updates: dict[str, object] = {}
    if global_daily_cap_usd is not _UNSET:
        updates["global_daily_cap_usd"] = global_daily_cap_usd

    if not updates:
        # Nothing to update — just return current state.
        user = await get(user_id)
        if user is None:
            raise ValueError(f"user {user_id!r} not found")
        return user

    pool = await get_pool()
    # Build SET clause dynamically from the provided fields.
    set_clause = ", ".join(
        f"{col} = ${i + 2}" for i, col in enumerate(updates)
    )
    values = list(updates.values())
    row = await pool.fetchrow(
        f"""
        update users
           set {set_clause}
         where id = $1
        returning {_COLS}
        """,
        user_id,
        *values,
    )
    if row is None:
        raise ValueError(f"user {user_id!r} not found")
    return User(**dict(row))
