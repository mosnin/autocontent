"""Real-Postgres: GDPR export covers every per-user table and scrubs secrets."""
from __future__ import annotations

import os
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


async def test_export_covers_dynamic_tables_and_scrubs(pool):
    from marketer.repos import privacy, tokens as tokens_repo

    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute("insert into users (id, email) values ($1,$2)", uid, "e@e.com")
    # A niche + an image post + a PAT: all per-user tables that the OLD static
    # export missed (image_posts) or had to hand-redact (PAT hash).
    await pool.execute(
        """
        insert into niches (user_id, title, description, target_audience,
            visual_style, voice, target_duration_sec, scene_count,
            posting_windows, platforms, daily_spend_cap_usd)
        values ($1,'t','d','a','v','onyx',30,2,'[]'::jsonb,'{tiktok}',5.0)
        """,
        uid,
    )
    await tokens_repo.create(user_id=uid, name="cli", expires_at=None)

    export = await privacy.export_user(uid)

    # Dynamically discovered per-user tables are present.
    assert "niches" in export and len(export["niches"]) == 1
    assert "personal_access_tokens" in export
    # Every table with a user_id column is covered (image_posts exists in schema).
    assert "image_posts" in export
    # Secrets are scrubbed: the PAT hash never appears in the export.
    pat_rows = export["personal_access_tokens"]
    assert pat_rows and all("token_hash" not in row for row in pat_rows)
    # No sensitive column leaked anywhere in the whole export.
    import json

    blob = json.dumps(export)
    assert "token_hash" not in blob


async def test_export_absent_user_returns_empty(pool):
    from marketer.repos import privacy

    assert await privacy.export_user("nobody") == {}
