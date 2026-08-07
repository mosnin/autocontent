"""Saved cinematography selections (per user).

The catalog itself is code (`marketer.cinema`) — product content that
ships and versions with the app. This module holds only the stateful
half: the combinations a user chose to keep.

A saved row stores the *selection* (seven keys), not the rendered prompt
text. Prompt language is derived by `cinema.resolve()` at read time, so
improving a phrase in the catalog upgrades every saved selection instead
of leaving thousands of frozen strings behind.

All queries are user-scoped. Saving under an existing name overwrites it
(upsert), which makes the "save" button idempotent.
"""
from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..cinema.presets import CinemaSelection
from ..db import get_pool

MAX_NAME_CHARS = 120
MAX_SAVED_PER_USER = 200


class SavedCinemaPreset(BaseModel):
    id: UUID
    user_id: str
    name: str
    # The named preset this started from, when it did. Kept for
    # provenance: the UI shows "Classic anamorphic (edited)".
    preset_key: str | None = None
    selection: CinemaSelection
    created_at: datetime
    updated_at: datetime


def _row(row) -> SavedCinemaPreset:
    d = dict(row)
    selection = d.get("selection")
    if isinstance(selection, str):
        selection = json.loads(selection)
    d["selection"] = CinemaSelection(**(selection or {}))
    return SavedCinemaPreset(**d)


async def save(
    *,
    user_id: str,
    name: str,
    selection: CinemaSelection,
    preset_key: str | None = None,
) -> SavedCinemaPreset:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into cinema_presets (user_id, name, preset_key, selection)
        values ($1, $2, $3, $4::jsonb)
        on conflict (user_id, name) do update
           set preset_key = excluded.preset_key,
               selection  = excluded.selection,
               updated_at = now()
        returning *
        """,
        user_id,
        name[:MAX_NAME_CHARS],
        preset_key,
        json.dumps(selection.model_dump()),
    )
    return _row(row)


async def get(saved_id: UUID, *, user_id: str) -> SavedCinemaPreset | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from cinema_presets where id = $1 and user_id = $2",
        saved_id,
        user_id,
    )
    return _row(row) if row else None


async def list_for_user(user_id: str) -> list[SavedCinemaPreset]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from cinema_presets
        where user_id = $1
        order by updated_at desc
        limit $2
        """,
        user_id,
        MAX_SAVED_PER_USER,
    )
    return [_row(r) for r in rows]


async def delete(saved_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from cinema_presets where id = $1 and user_id = $2",
        saved_id,
        user_id,
    )
    return result.endswith("1")
