"""Template library repo. Admin-curated; users see published rows."""
from __future__ import annotations

import json
from uuid import UUID

from ..db import get_pool
from ..models import Template


def _row(row) -> Template:
    d = dict(row)
    if isinstance(d.get("config"), str):
        d["config"] = json.loads(d["config"])
    return Template(**d)


async def create(
    *,
    created_by: str,
    kind: str,
    name: str,
    prompt: str,
    description: str = "",
    reference_key: str = "",
    config: dict | None = None,
    is_published: bool = False,
) -> Template:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into templates (kind, name, description, prompt, reference_key,
                               config, is_published, created_by)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        returning *
        """,
        kind, name, description, prompt, reference_key,
        json.dumps(config or {}), is_published, created_by,
    )
    return _row(row)


async def get(template_id: UUID) -> Template | None:
    pool = await get_pool()
    row = await pool.fetchrow("select * from templates where id = $1", template_id)
    return _row(row) if row else None


async def list_templates(*, published_only: bool = True, kind: str | None = None) -> list[Template]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from templates
        where ($1::bool is false or is_published)
          and ($2::text is null or kind = $2)
        order by created_at desc
        """,
        published_only, kind,
    )
    return [_row(r) for r in rows]


async def update(template_id: UUID, **fields) -> Template | None:
    allowed = {"name", "description", "prompt", "reference_key", "config", "is_published"}
    sets, values = [], []
    i = 1
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key == "config":
            sets.append(f"config = ${i}::jsonb")
            values.append(json.dumps(val))
        else:
            sets.append(f"{key} = ${i}")
            values.append(val)
        i += 1
    if not sets:
        return await get(template_id)
    sets.append("updated_at = now()")
    values.append(template_id)
    pool = await get_pool()
    row = await pool.fetchrow(
        "update templates set " + ", ".join(sets) + f" where id = ${i} returning *",
        *values,
    )
    return _row(row) if row else None


async def delete(template_id: UUID) -> bool:
    pool = await get_pool()
    result = await pool.execute("delete from templates where id = $1", template_id)
    return result.endswith("1")
