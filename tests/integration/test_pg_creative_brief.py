"""Real-Postgres roundtrip for the creative brief: jsonb storage on the
niche row survives create -> read -> partial update. Skip without
MARKETER_DATABASE_URL."""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_DATABASE_URL"),
    reason="no MARKETER_DATABASE_URL; integration tests need a real Postgres",
)


@pytest.fixture
async def pool():
    from marketer import db

    db._pool = None
    p = await db.get_pool()
    yield p
    async with p.acquire() as conn:
        await conn.execute("delete from users")


async def test_brief_roundtrip_and_partial_update(pool):
    from marketer.models import CreativeBrief, PostingWindow
    from marketer.repos import niches as niches_repo

    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )

    brief = CreativeBrief.model_validate({
        "narrative": {"language": "Spanish", "pacing": "rapid-fire"},
        "audio": {"music_enabled": False,
                  "caption_style": {"uppercase": True, "text_hex": "FFE14D"}},
        "hooks": {"preferred_mechanisms": ["myth_bust"]},
    })

    niche = await niches_repo.create(
        uid, title="t", description="d", target_audience="a", hashtags=[],
        visual_style="v", voice="onyx", target_duration_sec=30, scene_count=2,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"], daily_spend_cap_usd=Decimal("5"),
        creative_brief=brief,
    )
    assert niche.creative_brief.narrative.language == "Spanish"
    assert niche.creative_brief.audio.caption_style.uppercase is True

    fetched = await niches_repo.get(niche.id, user_id=uid)
    assert fetched.creative_brief == brief

    new_brief = CreativeBrief.model_validate({"narrative": {"language": "German"}})
    updated = await niches_repo.update(
        niche.id, user_id=uid, creative_brief=new_brief.model_dump(),
    )
    assert updated.creative_brief.narrative.language == "German"
    assert updated.creative_brief.audio.music_enabled is True  # reset to default
    assert updated.title == "t"

    untouched = await niches_repo.update(niche.id, user_id=uid, title="t2")
    assert untouched.creative_brief.narrative.language == "German"


async def test_legacy_row_without_brief_parses_as_default(pool):
    from marketer.models import CreativeBrief
    from marketer.repos import niches as niches_repo

    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    row = await pool.fetchrow(
        """
        insert into niches (user_id, title, description, target_audience,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd)
        values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0)
        returning id
        """,
        uid,
    )
    fetched = await niches_repo.get(row["id"], user_id=uid)
    assert fetched.creative_brief == CreativeBrief()
