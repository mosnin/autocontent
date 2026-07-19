"""Kits: user-level reusable skills (design / ad / writing).

All queries are user-scoped. `set_default` is transactional: it clears
the previous default of that kind before setting the new one, keeping
the partial unique index happy.
"""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool
from ..models import Kit

MAX_CONTENT_CHARS = 20_000


def _row_to_kit(row) -> Kit:
    d = dict(row)
    if isinstance(d.get("rules"), str):
        d["rules"] = json.loads(d["rules"])
    return Kit(**d)


async def create(
    *,
    user_id: str,
    kind: str,
    name: str,
    description: str = "",
    content: str = "",
    rules: dict | None = None,
    is_default: bool = False,
) -> Kit:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if is_default:
                await conn.execute(
                    "update kits set is_default = false where user_id = $1 and kind = $2",
                    user_id, kind,
                )
            row = await conn.fetchrow(
                """
                insert into kits (user_id, kind, name, description, content, rules, is_default)
                values ($1, $2, $3, $4, $5, $6::jsonb, $7)
                returning *
                """,
                user_id, kind, name, description,
                content[:MAX_CONTENT_CHARS], json.dumps(rules or {}), is_default,
            )
    return _row_to_kit(row)


async def get(kit_id: UUID, *, user_id: str) -> Kit | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from kits where id = $1 and user_id = $2", kit_id, user_id
    )
    return _row_to_kit(row) if row else None


async def list_for_user(user_id: str, *, kind: str | None = None) -> list[Kit]:
    pool = await get_pool()
    if kind is None:
        rows = await pool.fetch(
            "select * from kits where user_id = $1 order by kind, created_at desc",
            user_id,
        )
    else:
        rows = await pool.fetch(
            "select * from kits where user_id = $1 and kind = $2 order by created_at desc",
            user_id, kind,
        )
    return [_row_to_kit(r) for r in rows]


async def update(kit_id: UUID, *, user_id: str, **fields) -> Kit | None:
    allowed = {"name", "description", "content", "rules", "is_default"}
    sets, values = [], []
    i = 1
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key == "rules":
            sets.append(f"rules = ${i}::jsonb")
            values.append(json.dumps(val))
        elif key == "content":
            sets.append(f"content = ${i}")
            values.append(str(val)[:MAX_CONTENT_CHARS])
        else:
            sets.append(f"{key} = ${i}")
            values.append(val)
        i += 1
    if not sets:
        return await get(kit_id, user_id=user_id)
    sets.append("updated_at = now()")
    values += [kit_id, user_id]

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if fields.get("is_default"):
                await conn.execute(
                    """
                    update kits set is_default = false
                    where user_id = $2 and is_default
                      and kind = (select kind from kits where id = $1 and user_id = $2)
                    """,
                    kit_id, user_id,
                )
            row = await conn.fetchrow(
                "update kits set " + ", ".join(sets)
                + f" where id = ${i} and user_id = ${i + 1} returning *",
                *values,
            )
    return _row_to_kit(row) if row else None


async def delete(kit_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from kits where id = $1 and user_id = $2", kit_id, user_id
    )
    return result.endswith("1")


async def resolve(
    *, user_id: str, kind: str, kit_id: UUID | None
) -> Kit | None:
    """The kit that applies right now: the pinned one when set, else the
    user's default of that kind, else None."""
    if kit_id is not None:
        kit = await get(kit_id, user_id=user_id)
        if kit is not None and kit.kind == kind:
            return kit
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from kits where user_id = $1 and kind = $2 and is_default",
        user_id, kind,
    )
    return _row_to_kit(row) if row else None
