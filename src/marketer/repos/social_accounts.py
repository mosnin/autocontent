"""Connected social accounts — who owns which Zernio account.

Every read here is scoped by ``user_id``. That is not defensive style: a
Zernio ``accountId`` is valid against the whole team, so an unscoped read
that leaked one user's account id into another user's publish call would
post to the wrong customer's socials, and Zernio would accept it. This
table is the only thing standing between those two users.

Rows arrive from the ``account.connected`` webhook and are reconciled
against ``GET /v1/accounts``; both paths go through :func:`upsert`, which
is idempotent on ``zernio_account_id``.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..db import get_pool
from ..models import SocialAccount

_COLUMNS = (
    "id, user_id, zernio_account_id, zernio_profile_id, platform, username, "
    "is_active, connected_at, disconnected_at, updated_at"
)


def _row(row) -> SocialAccount:
    return SocialAccount(**dict(row))


async def upsert(
    *,
    user_id: str,
    zernio_account_id: str,
    zernio_profile_id: str,
    platform: str,
    username: str = "",
    is_active: bool = True,
) -> SocialAccount:
    """Record (or refresh) one connected account.

    Idempotent on ``zernio_account_id`` so an at-least-once webhook
    redelivery updates rather than duplicating. A reconnect flips
    ``is_active`` back on and clears ``disconnected_at`` on the SAME row,
    keeping published posts' references intact.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into social_accounts
            (user_id, zernio_account_id, zernio_profile_id, platform,
             username, is_active, disconnected_at)
        values ($1, $2, $3, $4, $5, $6, null)
        on conflict (zernio_account_id) do update set
            user_id          = excluded.user_id,
            zernio_profile_id = excluded.zernio_profile_id,
            platform         = excluded.platform,
            username         = excluded.username,
            is_active        = excluded.is_active,
            disconnected_at  = case when excluded.is_active
                                    then null
                                    else social_accounts.disconnected_at end,
            updated_at       = now()
        returning {_COLUMNS}
        """,
        user_id, zernio_account_id, zernio_profile_id, platform,
        username, is_active,
    )
    return _row(row)


async def list_for_user(
    user_id: str, *, platform: str | None = None, active_only: bool = True
) -> list[SocialAccount]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLUMNS} from social_accounts
         where user_id = $1
           and ($2::text is null or platform = $2)
           and ($3::boolean is false or is_active)
         order by platform, connected_at
        """,
        user_id, platform, active_only,
    )
    return [_row(r) for r in rows]


async def publish_target(user_id: str, platform: str) -> SocialAccount | None:
    """The account a publish to ``platform`` should go to for this user.

    Returns the oldest active account for the platform — stable across
    calls, so a scheduled post and its retry target the same place. None
    when the user has not connected that platform (or its token died),
    which callers must surface as "reconnect", never as a silent skip.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        select {_COLUMNS} from social_accounts
         where user_id = $1 and platform = $2 and is_active
         order by connected_at
         limit 1
        """,
        user_id, platform,
    )
    return _row(row) if row else None


async def mark_disconnected(zernio_account_id: str) -> SocialAccount | None:
    """Flag an account dead (from the ``account.disconnected`` webhook).

    Deliberately keyed on the Zernio id alone: the webhook is our only
    input and it does not carry our user id. The row is not deleted — the
    user reconnects into it, and posts that referenced it stay explicable.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update social_accounts
           set is_active = false, disconnected_at = now(), updated_at = now()
         where zernio_account_id = $1
        returning {_COLUMNS}
        """,
        zernio_account_id,
    )
    return _row(row) if row else None


async def owner_of(zernio_account_id: str) -> str | None:
    """Which user owns this Zernio account — the webhook routing key."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "select user_id from social_accounts where zernio_account_id = $1",
        zernio_account_id,
    )
    return row["user_id"] if row else None


async def reconcile(
    *, user_id: str, zernio_profile_id: str, accounts: list[dict]
) -> list[SocialAccount]:
    """Make our rows match what Zernio reports for this profile.

    The safety net for missed webhooks. Accounts Zernio no longer lists are
    marked inactive rather than deleted, for the same reason as above.
    """
    from ..services.zernio import PLATFORM_MAP

    to_internal = {v: k for k, v in PLATFORM_MAP.items()}
    seen: set[str] = set()
    out: list[SocialAccount] = []

    for account in accounts:
        account_id = account.get("_id") or account.get("accountId")
        platform = to_internal.get(account.get("platform"))
        if not account_id or platform is None:
            # A platform we cannot publish to is not an account we track.
            continue
        seen.add(account_id)
        out.append(
            await upsert(
                user_id=user_id,
                zernio_account_id=account_id,
                zernio_profile_id=zernio_profile_id,
                platform=platform,
                username=str(account.get("username") or ""),
                is_active=bool(account.get("isActive", True)),
            )
        )

    pool = await get_pool()
    await pool.execute(
        """
        update social_accounts
           set is_active = false, disconnected_at = coalesce(disconnected_at, now()),
               updated_at = now()
         where user_id = $1 and is_active and not (zernio_account_id = any($2::text[]))
        """,
        user_id, list(seen),
    )
    return out


async def touch(zernio_account_id: str) -> None:
    """Bump updated_at without changing state (webhook liveness signal)."""
    pool = await get_pool()
    await pool.execute(
        "update social_accounts set updated_at = now() where zernio_account_id = $1",
        zernio_account_id,
    )


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
