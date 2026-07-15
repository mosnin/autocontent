"""Append-only audit log for ads actions. Rows are inserted and read, never
updated or deleted — the evidence trail for every spend-affecting action, by
agents and humans alike."""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from ..db import get_pool


class AdActionEntry(BaseModel):
    id: int
    user_id: str
    actor: str
    actor_email: str
    action: str
    platform: str
    target_type: str
    target_id: str
    dollar_delta_usd: Decimal
    before_json: dict | None = None
    after_json: dict | None = None
    ip: str | None = None
    user_agent: str | None = None
    created_at: datetime


_COLS = (
    "id, user_id, actor, actor_email, action, platform, target_type, target_id, "
    "dollar_delta_usd, before_json, after_json, ip, user_agent, created_at"
)


def _row(r) -> AdActionEntry:
    d = dict(r)
    for k in ("before_json", "after_json"):
        v = d.get(k)
        if isinstance(v, str):
            d[k] = json.loads(v)
    return AdActionEntry(**d)


async def record(
    *,
    user_id: str,
    action: str,
    actor: str = "agent",
    actor_email: str = "",
    platform: str = "",
    target_type: str = "",
    target_id: str = "",
    dollar_delta_usd: Decimal = Decimal("0"),
    before: dict | None = None,
    after: dict | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AdActionEntry:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_actions_log
            (user_id, actor, actor_email, action, platform, target_type,
             target_id, dollar_delta_usd, before_json, after_json, ip, user_agent)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        returning {_COLS}
        """,
        user_id, actor, actor_email, action, platform, target_type, target_id,
        dollar_delta_usd,
        json.dumps(before) if before is not None else None,
        json.dumps(after) if after is not None else None,
        ip, user_agent,
    )
    return _row(row)


async def list_(
    *,
    user_id: str,
    target_type: str | None = None,
    target_id: str | None = None,
    limit: int = 100,
) -> list[AdActionEntry]:
    pool = await get_pool()
    clauses = ["user_id = $1"]
    args: list[object] = [user_id]
    if target_type is not None:
        args.append(target_type)
        clauses.append(f"target_type = ${len(args)}")
    if target_id is not None:
        args.append(target_id)
        clauses.append(f"target_id = ${len(args)}")
    args.append(limit)
    rows = await pool.fetch(
        f"select {_COLS} from ad_actions_log where {' and '.join(clauses)} "
        f"order by id desc limit ${len(args)}",
        *args,
    )
    return [_row(r) for r in rows]
