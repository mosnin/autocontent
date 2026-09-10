"""Run against an explicitly supplied, migrated disposable Postgres database."""

import asyncio
import json
import os
from uuid import uuid4

import asyncpg
import pytest
from marketer import db
from marketer.models.production import ProductionBrief, ProductionCommand
from marketer.repos import creative_library as library, production, media

pytestmark = pytest.mark.skipif(
    not os.getenv("MARKETER_PRODUCTION_TEST_DATABASE_URL"),
    reason="needs disposable production test database",
)


@pytest.fixture
async def account(monkeypatch):
    pool = await asyncpg.create_pool(
        os.environ["MARKETER_PRODUCTION_TEST_DATABASE_URL"], min_size=1, max_size=5
    )
    monkeypatch.setattr(db, "_pool", pool)
    user = "production_test_" + uuid4().hex
    await pool.execute("INSERT INTO users(id,email) VALUES ($1,$2)", user, user + "@example.test")
    yield pool, user
    await pool.execute("DELETE FROM users WHERE id=$1", user)
    await pool.close()


async def seed_all(pool, user):
    niche = await pool.fetchval(
        "INSERT INTO niches(user_id,title,description,target_audience,visual_style,voice,target_duration_sec,scene_count,posting_windows,platforms,daily_spend_cap_usd) VALUES ($1,'Test','Test','Test','Test','onyx',30,2,'[]','{tiktok}',5) RETURNING id",
        user,
    )
    account = await pool.fetchval(
        "INSERT INTO ad_accounts(user_id,platform) VALUES ($1,'meta') RETURNING id", user
    )
    run = await pool.fetchval(
        "INSERT INTO ad_creative_runs(user_id,domain) VALUES ($1,'example.test') RETURNING id", user
    )
    batch = await pool.fetchval(
        "INSERT INTO headshot_batches(user_id,style_key) VALUES ($1,'studio') RETURNING id", user
    )
    details = {
        "campaign": {"name": "Launch", "budget_usd": 100},
        "paid-campaign": {"ad_account_id": account},
        "video": {
            "niche_id": niche,
            "platform": "tiktok",
            "payload": json.dumps(
                {
                    "script": {"idea": {"topic": "A better morning"}},
                    "rendered": {"path": "/artifacts/test.mp4"},
                }
            ),
        },
        "article": {"niche_id": niche},
        "image-post": {"niche_id": niche},
        "ad": {"headline": "A useful text ad", "kind": "text"},
        "ad-slot": {
            "run_id": run,
            "position": 0,
            "direction_key": "proof",
            "image_model_id": "test",
            "subject_kind": "company",
        },
        "ugc": {"model_id": "test"},
        "drama": {"niche_id": niche},
        "design": {"niche_id": niche},
        "motion": {"niche_id": niche, "narration": "A useful explanation"},
        "headshot": {"batch_id": batch, "variant_index": 0},
        "composition": {"clip_asset_ids": "[]"},
        "asset": {"kind": "clip", "storage": "volume", "object_key": "/artifacts/test.mp4"},
    }
    ids = {}
    for kind, extra in details.items():
        values = {"user_id": user, **extra}
        cols = ",".join(values)
        slots = ",".join(f"${i+1}" for i in range(len(values)))
        ids[kind] = await pool.fetchval(
            f"INSERT INTO {library.FAMILIES[kind][0]}({cols}) VALUES ({slots}) RETURNING id",
            *values.values(),
        )
    return ids


async def test_inventory_covers_every_family_and_more_than_1000(account):
    pool, user = account
    ids = await seed_all(pool, user)
    await pool.execute(
        "INSERT INTO media_assets(user_id,kind,storage,object_key,title) SELECT $1,'clip','volume','/artifacts/test-'||g,'Archive '||g FROM generate_series(1,1005) g",
        user,
    )
    seen = []
    cursor = None
    while True:
        page = await library.list_items(user, "creatives", limit=50, cursor=cursor)
        seen.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            break
    assert len(seen) == 1017
    assert len({i["id"] for i in seen}) == len(seen)
    assert {i["kind"] for i in seen} == set(library.FAMILIES) - library.CAMPAIGNS
    assert next(i for i in seen if i["kind"] == "video")["title"] == "A better morning"
    assert len((await library.list_items(user, "campaigns"))["items"]) == 2
    assert (await library.list_items("another_user", "creatives"))["items"] == []
    assert await library.source("another_user", "ad", ids["ad"]) is None
    assert await production.get("another_user", "ad", ids["ad"]) is None
    first = await library.list_items(user, "creatives", limit=1)
    with pytest.raises(ValueError):
        await library.list_items("another_user", "creatives", cursor=first["nextCursor"])


def command(record, action, **extra):
    return ProductionCommand(
        action=action,
        expected_version=record["version"],
        source_fingerprint=record["source"]["fingerprint"],
        **extra,
    )


async def test_review_conflicts_versions_and_historical_outcomes(account):
    pool, user = account
    ids = await seed_all(pool, user)
    record = await production.get(user, "ad", ids["ad"])
    brief = ProductionBrief(
        objective="Demonstrate the product",
        audience="New customers",
        owner="Ada",
        deliverable="A plain text ad with one call to action",
    )
    cmd = command(record, "save", brief=brief)
    results = await asyncio.gather(
        production.apply(user, "ad", ids["ad"], cmd),
        production.apply(user, "ad", ids["ad"], cmd),
        return_exceptions=True,
    )
    assert sum(isinstance(r, production.Conflict) for r in results) == 1
    record = await production.get(user, "ad", ids["ad"])
    assert record["readiness"] == []  # A legitimate text ad needs no image.
    record = await production.apply(
        user, "ad", ids["ad"], command(record, "note", text="Clarify the offer")
    )
    with pytest.raises(ValueError, match="Resolve review note"):
        await production.apply(user, "ad", ids["ad"], command(record, "approve"))
    record = await production.apply(
        user,
        "ad",
        ids["ad"],
        command(
            record, "resolve", note_id=record["state"]["notes"][0]["id"], text="Offer clarified"
        ),
    )
    record = await production.apply(user, "ad", ids["ad"], command(record, "approve"))
    assert record["approved"]
    original = record["source"]["fingerprint"]
    record = await production.apply(
        user,
        "ad",
        ids["ad"],
        command(
            record,
            "handoff",
            text="Delivered to the launch folder",
            evidence_url="https://example.test/launch",
        ),
    )
    handoff = record["state"]["handoffs"][0]["version"]
    await pool.execute(
        "UPDATE ad_creatives SET headline='A new opening',updated_at=now() WHERE id=$1", ids["ad"]
    )
    with pytest.raises(production.Conflict):
        await production.apply(user, "ad", ids["ad"], command(record, "approve"))
    record = await production.get(user, "ad", ids["ad"])
    assert not record["approved"]
    record = await production.apply(
        user,
        "ad",
        ids["ad"],
        command(
            record,
            "outcome",
            text="Launch week: 12 leads. Test a clearer offer next.",
            evidence_url="https://example.test/report",
            handoff_version=handoff,
        ),
    )
    assert record["state"]["outcomes"][0]["source_fingerprint"] == original
    assert record["state"]["outcomes"][0]["handoff_version"] == handoff
    assert (
        await production.apply("another_user", "ad", ids["ad"], command(record, "approve")) is None
    )


async def test_same_path_asset_refresh_invalidates_revision(account):
    pool, user = account
    asset = await media.record_asset(
        user_id=user,
        kind="clip",
        storage="volume",
        object_key="/artifacts/reused.mp4",
        size_bytes=10,
    )
    before = await library.source(user, "asset", asset.id)
    await media.record_asset(
        user_id=user,
        kind="clip",
        storage="volume",
        object_key="/artifacts/reused.mp4",
        size_bytes=10,
    )
    after = await library.source(user, "asset", asset.id)
    assert before["fingerprint"] != after["fingerprint"]


async def test_campaign_filters_do_not_infer_links(account):
    pool, user = account
    ids = await seed_all(pool, user)
    await pool.execute(
        "UPDATE articles SET campaign_id=$1 WHERE id=$2", ids["campaign"], ids["article"]
    )
    filtered = await library.list_items(
        user, "creatives", campaign_id=f"campaign:{ids['campaign']}"
    )
    assert [i["id"] for i in filtered["items"]] == [f"article:{ids['article']}"]
    unassigned = await library.list_items(user, "creatives", campaign_id="unassigned")
    assert f"design:{ids['design']}" in [i["id"] for i in unassigned["items"]]
    assert f"article:{ids['article']}" not in [i["id"] for i in unassigned["items"]]


async def test_orchestration_campaign_includes_explicit_paid_campaign_creatives(account):
    pool, user = account
    ids = await seed_all(pool, user)
    await pool.execute(
        "UPDATE ad_creatives SET campaign_id=$1 WHERE id=$2", ids["paid-campaign"], ids["ad"]
    )
    await pool.execute(
        "INSERT INTO campaign_items(campaign_id,kind,ref_id,user_id) VALUES ($1,'ad',$2,$3)",
        ids["campaign"],
        ids["paid-campaign"],
        user,
    )
    page = await library.list_items(user, "creatives", campaign_id=f"campaign:{ids['campaign']}")
    assert [i["id"] for i in page["items"]] == [f"ad:{ids['ad']}"]


async def test_video_audio_and_same_path_rerender_change_review_identity(account):
    pool, user = account
    ids = await seed_all(pool, user)
    before = await library.source(user, "video", ids["video"])
    await pool.execute(
        "UPDATE jobs SET payload=jsonb_set(payload,'{audio}','{\"voiceover_path\":\"/artifacts/new.wav\"}'::jsonb), updated_at=now() WHERE id=$1",
        ids["video"],
    )
    after = await library.source(user, "video", ids["video"])
    assert before["fingerprint"] != after["fingerprint"]
    await pool.execute("UPDATE jobs SET updated_at=now() WHERE id=$1", ids["video"])
    rerendered = await library.source(user, "video", ids["video"])
    assert rerendered["fingerprint"] != after["fingerprint"]
