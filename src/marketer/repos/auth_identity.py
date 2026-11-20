"""Reads of Better Auth's ``auth`` schema (migration 0030). Read only.

The backend reads exactly the columns listed in docs/auth/README.md
("Contract: the auth schema") and nothing else. Every function raises on a
database error; callers turn that into 503, never into an allow.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from ..db import get_auth_pool


@dataclass(frozen=True)
class SessionIdentity:
    """One answer to "who is this session, and what are they in ``org``"."""

    person_id: str
    email: str
    email_verified: bool
    platform_role: str  # auth."user".role, e.g. 'admin' or 'user'
    banned: bool  # already folded with banExpires: True only while the ban holds
    two_factor_enabled: bool
    org_id: str
    member_role: str | None  # None when the person is not a member of org
    tenant_id: str | None  # None when the org does not exist
    require_two_factor: bool


@dataclass(frozen=True)
class Membership:
    org_id: str
    role: str
    banned: bool
    two_factor_enabled: bool
    require_two_factor: bool
    email: str


def _ban_holds(banned: bool | None, ban_expires: datetime | None) -> bool:
    if not banned:
        return False
    if ban_expires is None:
        return True
    if ban_expires.tzinfo is None:
        ban_expires = ban_expires.replace(tzinfo=timezone.utc)
    return ban_expires > datetime.now(timezone.utc)


async def session_identity(session_id: str, person_id: str, org_id: str) -> SessionIdentity | None:
    """The session ``session_id`` if it exists, belongs to ``person_id`` and is
    unexpired, with the person's membership in ``org_id``. None when there is
    no such live session."""
    pool = await get_auth_pool()
    row = await pool.fetchrow(
        """
        select u.id                            as person_id,
               coalesce(u.email, '')           as email,
               coalesce(u."emailVerified", false) as email_verified,
               coalesce(u.role, '')            as platform_role,
               coalesce(u.banned, false)       as banned,
               u."banExpires"                  as ban_expires,
               coalesce(u."twoFactorEnabled", false) as two_factor_enabled,
               m.role                          as member_role,
               o."tenantId"                    as tenant_id,
               coalesce(o."requireTwoFactor", false) as require_two_factor
          from auth.session s
          join auth."user" u on u.id = s."userId"
          left join auth.organization o on o.id = $3
          left join auth.member m
                 on m."organizationId" = o.id and m."userId" = u.id
         where s.id = $1
           and s."userId" = $2
           and s."expiresAt" > now()
        """,
        session_id,
        person_id,
        org_id,
    )
    if row is None:
        return None
    return SessionIdentity(
        person_id=row["person_id"],
        email=row["email"],
        email_verified=bool(row["email_verified"]),
        platform_role=row["platform_role"] or "",
        banned=_ban_holds(row["banned"], row["ban_expires"]),
        two_factor_enabled=bool(row["two_factor_enabled"]),
        org_id=org_id,
        member_role=row["member_role"],
        tenant_id=row["tenant_id"],
        require_two_factor=bool(row["require_two_factor"]),
    )


async def membership_for_tenant(tenant_id: str, person_id: str) -> Membership | None:
    """The person's membership in the workspace whose ``tenantId`` is
    ``tenant_id`` (tenant id → organization → member). None when there is no
    such workspace or the person is not a member of it."""
    pool = await get_auth_pool()
    row = await pool.fetchrow(
        """
        select o.id                            as org_id,
               m.role                          as role,
               coalesce(u.banned, false)       as banned,
               u."banExpires"                  as ban_expires,
               coalesce(u."twoFactorEnabled", false) as two_factor_enabled,
               coalesce(o."requireTwoFactor", false) as require_two_factor,
               coalesce(u.email, '')           as email
          from auth.organization o
          join auth.member m on m."organizationId" = o.id
          join auth."user" u on u.id = m."userId"
         where o."tenantId" = $1
           and m."userId" = $2
        """,
        tenant_id,
        person_id,
    )
    if row is None:
        return None
    return Membership(
        org_id=row["org_id"],
        role=row["role"] or "",
        banned=_ban_holds(row["banned"], row["ban_expires"]),
        two_factor_enabled=bool(row["two_factor_enabled"]),
        require_two_factor=bool(row["require_two_factor"]),
        email=row["email"],
    )


async def org_for_tenant(tenant_id: str) -> str | None:
    """The workspace id for a tenant id, or None."""
    pool = await get_auth_pool()
    return await pool.fetchval(
        'select id from auth.organization where "tenantId" = $1', tenant_id
    )
