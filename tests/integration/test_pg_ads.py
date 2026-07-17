"""Real-Postgres integration tests for the Ads data layer, approvals, and the
append-only action log. Ads spend is real money, so these exercise the money-
relevant invariants (pacing sums, approval lifecycle, append-only audit)
against an actual database. Skip without MARKETER_DATABASE_URL."""
from __future__ import annotations

import os
from datetime import date
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
        await conn.execute("delete from ad_actions_log")


async def _mkuser(pool) -> str:
    uid = f"user_{uuid4().hex[:12]}"
    await pool.execute(
        "insert into users (id, email) values ($1, $2)", uid, f"{uid}@t.com"
    )
    return uid


# --------------------------------------------------------------------------- accounts

async def test_account_create_upsert_and_governance(pool):
    from marketer.repos import ads

    uid = await _mkuser(pool)
    acc = await ads.create_account(
        user_id=uid, platform="google_ads", external_account_id="123-456",
        name="Main", composio_connection_id="conn_1", status="active",
    )
    assert acc.platform == "google_ads"
    assert acc.killswitch is False

    # Upsert on the same (user, platform, external id) updates rather than dupes.
    again = await ads.create_account(
        user_id=uid, platform="google_ads", external_account_id="123-456",
        name="Renamed", status="active",
    )
    assert again.id == acc.id
    assert again.name == "Renamed"

    # Governance sentinel: set only killswitch, leave caps untouched.
    gov = await ads.set_account_governance(
        acc.id, user_id=uid, daily_cap_usd=Decimal("50"), killswitch=True
    )
    assert gov is not None
    assert gov.daily_cap_usd == Decimal("50.00")
    assert gov.killswitch is True

    # Cross-tenant guard: another user can't see or mutate it.
    other = await _mkuser(pool)
    assert await ads.get_account(acc.id, user_id=other) is None
    assert await ads.set_account_status(acc.id, user_id=other, status="paused") is None


async def test_list_user_ids_with_active_accounts(pool):
    """The hourly metrics-sync fan-out set: only users with an ACTIVE ad
    account, deduped, never a hardcoded/static list."""
    from marketer.repos import ads

    active_uid = await _mkuser(pool)
    pending_uid = await _mkuser(pool)
    await ads.create_account(user_id=active_uid, platform="google_ads", status="active")
    # A second active account for the same user must not duplicate them.
    await ads.create_account(
        user_id=active_uid, platform="meta_ads", external_account_id="act_2",
        status="active",
    )
    await ads.create_account(user_id=pending_uid, platform="google_ads", status="pending")

    ids = await ads.list_user_ids_with_active_accounts()
    assert ids.count(active_uid) == 1
    assert pending_uid not in ids


async def test_unknown_platform_rejected(pool):
    from marketer.repos import ads

    uid = await _mkuser(pool)
    with pytest.raises(ValueError):
        await ads.create_account(user_id=uid, platform="tiktok_ads")


# --------------------------------------------------------------------------- campaigns + metrics

async def test_campaign_lifecycle_and_pacing_sum(pool):
    from marketer.repos import ads

    uid = await _mkuser(pool)
    acc = await ads.create_account(
        user_id=uid, platform="meta_ads", external_account_id="act_1"
    )
    camp = await ads.create_campaign(
        user_id=uid, ad_account_id=acc.id, name="Launch",
        objective="conversions", daily_budget_usd=Decimal("20"),
    )
    assert camp.status == "draft"

    updated = await ads.update_campaign(
        camp.id, user_id=uid, status="active", external_campaign_id="ext_9"
    )
    assert updated is not None
    assert updated.status == "active"
    assert updated.external_campaign_id == "ext_9"

    today = date(2026, 7, 15)
    await ads.upsert_metrics(
        user_id=uid, ad_account_id=acc.id, campaign_id=camp.id, day=today,
        impressions=1000, clicks=50, spend_usd=Decimal("12.50"),
        conversions=Decimal("3"), revenue_usd=Decimal("90"),
    )
    # Upsert (same campaign+date) overwrites, not duplicates.
    await ads.upsert_metrics(
        user_id=uid, ad_account_id=acc.id, campaign_id=camp.id, day=today,
        spend_usd=Decimal("15.00"),
    )
    spent = await ads.account_spend_on(acc.id, user_id=uid, day=today)
    assert spent == Decimal("15.00")

    between = await ads.account_spend_between(
        acc.id, user_id=uid, start=date(2026, 7, 1), end=date(2026, 7, 31)
    )
    assert between == Decimal("15.00")

    rows = await ads.campaign_metrics(camp.id, user_id=uid)
    assert len(rows) == 1
    assert rows[0].spend_usd == Decimal("15.00")


async def test_bad_campaign_status_rejected(pool):
    from marketer.repos import ads

    uid = await _mkuser(pool)
    acc = await ads.create_account(user_id=uid, platform="google_ads")
    with pytest.raises(ValueError):
        await ads.create_campaign(
            user_id=uid, ad_account_id=acc.id, name="x", status="bogus"
        )


# --------------------------------------------------------------------------- approvals

async def test_approval_lifecycle_is_single_use(pool):
    from marketer.repos import ad_approvals

    uid = await _mkuser(pool)
    ap = await ad_approvals.create(
        user_id=uid, action="budget.increase", summary="+$50/day",
        dollar_delta_usd=Decimal("50"), payload={"to": "70"},
    )
    assert ap.status == "pending"
    assert ap.payload == {"to": "70"}

    decided = await ad_approvals.decide(
        ap.id, user_id=uid, status="approved", decided_by="admin@t.com"
    )
    assert decided is not None and decided.status == "approved"

    # A second decide is a no-op (only transitions from pending).
    again = await ad_approvals.decide(
        ap.id, user_id=uid, status="rejected", decided_by="admin@t.com"
    )
    assert again is None

    await ad_approvals.mark_executed(ap.id, user_id=uid)
    fetched = await ad_approvals.get(ap.id, user_id=uid)
    assert fetched is not None and fetched.status == "executed"

    pending = await ad_approvals.list_(user_id=uid, status="pending")
    assert pending == []


# --------------------------------------------------------------------------- audit

async def test_action_log_is_append_and_scoped(pool):
    from marketer.repos import ad_actions

    uid = await _mkuser(pool)
    await ad_actions.record(
        user_id=uid, action="campaign.create", actor="agent",
        platform="google_ads", target_type="campaign", target_id="c1",
        dollar_delta_usd=Decimal("0"), after={"name": "Launch"},
    )
    await ad_actions.record(
        user_id=uid, action="budget.increase", actor="user",
        actor_email="a@t.com", platform="google_ads",
        target_type="campaign", target_id="c1",
        dollar_delta_usd=Decimal("50"), before={"budget": "20"},
        after={"budget": "70"},
    )
    entries = await ad_actions.list_(
        user_id=uid, target_type="campaign", target_id="c1"
    )
    assert len(entries) == 2
    # Newest first; JSON round-trips to dicts.
    assert entries[0].action == "budget.increase"
    assert entries[0].dollar_delta_usd == Decimal("50")
    assert entries[1].after_json == {"name": "Launch"}

    # Cross-tenant: another user sees nothing.
    other = await _mkuser(pool)
    assert await ad_actions.list_(user_id=other) == []


# --------------------------------------------------------------------------- calendar

async def test_campaign_appears_in_calendar(pool):
    from datetime import datetime, timedelta, timezone

    from marketer.repos import ads, calendar

    uid = await _mkuser(pool)
    acc = await ads.create_account(user_id=uid, platform="meta_ads")
    camp = await ads.create_campaign(
        user_id=uid, ad_account_id=acc.id, name="Spring Launch", status="active"
    )
    now = datetime.now(timezone.utc)
    items = await calendar.items_for_user(
        uid, start=now - timedelta(days=1), end=now + timedelta(days=1)
    )
    ad_items = [i for i in items if i.kind == "ad"]
    assert len(ad_items) == 1
    assert ad_items[0].id == str(camp.id)
    assert ad_items[0].title == "Spring Launch"
    assert ad_items[0].platform == "meta_ads"
