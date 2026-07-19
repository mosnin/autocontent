from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import CreativeBrief, Niche, PostingWindow


def _row_to_niche(row) -> Niche:
    d = dict(row)
    d["posting_windows"] = [PostingWindow(**w) for w in json.loads(d["posting_windows"])]
    raw_brief = d.get("creative_brief")
    if isinstance(raw_brief, str):
        d["creative_brief"] = CreativeBrief.model_validate_json(raw_brief or "{}")
    elif raw_brief is None:
        d["creative_brief"] = CreativeBrief()
    return Niche(**d)


async def create(
    user_id: str,
    *,
    title: str,
    description: str,
    target_audience: str,
    hashtags: list[str],
    visual_style: str,
    voice: str,
    target_duration_sec: int,
    scene_count: int,
    posting_windows: list[PostingWindow],
    platforms: list[str],
    daily_spend_cap_usd: Decimal,
    image_quality: str = "medium",
    video_resolution: str = "480p",
    scene_max_duration_sec: int = 5,
    tts_style_directions: str | None = None,
    approve_before_post: bool = False,
    character_description: str | None = None,
    creative_brief: CreativeBrief | None = None,
    video_provider: str = "grok",
    fal_model: str = "",
    script_model: str = "",
    design_kit_id=None,
    writing_kit_id=None,
) -> Niche:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into niches (
            user_id, title, description, target_audience, hashtags,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd,
            image_quality, video_resolution, scene_max_duration_sec,
            tts_style_directions, approve_before_post, character_description,
            creative_brief, video_provider, fal_model, script_model,
            design_kit_id, writing_kit_id
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24)
        returning *
        """,
        user_id, title, description, target_audience, hashtags,
        visual_style, voice, target_duration_sec, scene_count,
        json.dumps([w.model_dump() for w in posting_windows]),
        platforms, daily_spend_cap_usd,
        image_quality, video_resolution, scene_max_duration_sec,
        tts_style_directions, approve_before_post, character_description,
        (
            creative_brief
            if isinstance(creative_brief, CreativeBrief)
            # Route handlers pass model_dump() dicts; coerce + validate.
            else CreativeBrief.model_validate(creative_brief or {})
        ).model_dump_json(),
        video_provider, fal_model, script_model, design_kit_id, writing_kit_id,
    )
    return _row_to_niche(row)


async def list_for_user(user_id: str) -> list[Niche]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select * from niches where user_id = $1 and archived_at is null order by created_at",
        user_id,
    )
    return [_row_to_niche(r) for r in rows]


async def get(niche_id: UUID, *, user_id: str) -> Niche | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from niches where id = $1 and user_id = $2",
        niche_id, user_id,
    )
    return _row_to_niche(row) if row else None


async def update(
    niche_id: UUID,
    *,
    user_id: str,
    **fields,
) -> Niche | None:
    """Partial UPDATE on a single niche row.

    Accepts the same fields as :func:`create` but every one is
    optional; unspecified keys are left alone. ``posting_windows`` is
    re-serialized to JSONB on the way in. Returns the refreshed row
    or ``None`` if the niche isn't owned by ``user_id``.
    """
    if not fields:
        return await get(niche_id, user_id=user_id)

    # Map python attribute -> column name (1:1 today, kept explicit so
    # the columns we accept here are obvious at a glance).
    allowed = {
        "title", "description", "target_audience", "hashtags",
        "visual_style", "voice", "target_duration_sec", "scene_count",
        "posting_windows", "platforms", "daily_spend_cap_usd",
        "image_quality", "video_resolution", "scene_max_duration_sec",
        "tts_style_directions", "approve_before_post", "character_description",
        "creative_brief", "video_provider", "fal_model", "script_model",
        "design_kit_id", "writing_kit_id",
    }

    sets: list[str] = []
    values: list = []
    i = 1
    for key, val in fields.items():
        if key not in allowed:
            continue
        if val is None and key not in {"tts_style_directions", "character_description", "design_kit_id", "writing_kit_id"}:
            # Treat None on non-nullable columns as "don't touch".
            continue
        if key == "posting_windows":
            sets.append(f"posting_windows = ${i}::jsonb")
            values.append(json.dumps([w.model_dump() for w in val]))
        elif key == "creative_brief":
            brief = val if isinstance(val, CreativeBrief) else CreativeBrief.model_validate(val)
            sets.append(f"creative_brief = ${i}::jsonb")
            values.append(brief.model_dump_json())
        else:
            sets.append(f"{key} = ${i}")
            values.append(val)
        i += 1

    if not sets:
        return await get(niche_id, user_id=user_id)

    values.append(niche_id)
    values.append(user_id)
    sql = (
        "update niches set "
        + ", ".join(sets)
        + f" where id = ${i} and user_id = ${i + 1}"
        + " returning *"
    )
    pool = await get_pool()
    row = await pool.fetchrow(sql, *values)
    return _row_to_niche(row) if row else None


async def archive(niche_id: UUID, *, user_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "update niches set archived_at = now() where id = $1 and user_id = $2",
        niche_id, user_id,
    )
