"""Unit tests for composio_client's typed platform ops: tool-slug resolution
(empty slug => AdsDisabled, fail-closed), tolerant response parsing, and
fetch_metrics row shaping. execute_tool is monkeypatched throughout — no
Composio package needed, no network calls."""
from __future__ import annotations

from datetime import date

import pytest

from marketer.services import composio_client as cc


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "sk_test")


# --------------------------------------------------------------------------- fail-closed slugs


def test_empty_slug_raises_ads_disabled(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "composio_googleads_create_campaign_tool", "")
    with pytest.raises(cc.AdsDisabled):
        cc.create_campaign(
            user_id="u1", connected_account_id="conn", platform="google_ads", payload={},
        )


def test_unknown_platform_raises_ads_disabled(monkeypatch):
    with pytest.raises(cc.AdsDisabled):
        cc.set_budget(
            user_id="u1", connected_account_id="conn", platform="linkedin_ads",
            external_campaign_id="x", daily_budget_usd=10,
        )


def test_disabled_feature_raises_before_slug_check(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", False)
    with pytest.raises(cc.AdsDisabled):
        cc.create_campaign(
            user_id="u1", connected_account_id="conn", platform="google_ads", payload={},
        )


# --------------------------------------------------------------------------- create_campaign


def test_create_campaign_parses_external_id(monkeypatch):
    calls = []

    def _execute(*, user_id, slug, arguments):
        calls.append((slug, arguments))
        return {"successful": True, "data": {"id": "cmp-123"}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    out = cc.create_campaign(
        user_id="u1", connected_account_id="conn-1", platform="google_ads",
        payload={"name": "Launch"},
    )
    assert out == {"external_campaign_id": "cmp-123", "raw": {"id": "cmp-123"}}
    slug, args = calls[0]
    assert slug == "GOOGLEADS_CREATE_CAMPAIGN"
    assert args["connected_account_id"] == "conn-1"
    assert args["name"] == "Launch"


def test_create_campaign_tolerates_resource_name_field(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {"successful": True, "data": {"resource_name": "customers/1/campaigns/2"}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    out = cc.create_campaign(
        user_id="u1", connected_account_id="conn-1", platform="google_ads", payload={},
    )
    assert out["external_campaign_id"] == "customers/1/campaigns/2"


def test_create_campaign_raises_on_platform_failure(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {"successful": False, "error": "quota exceeded"}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    with pytest.raises(cc.ComposioCallError, match="quota exceeded"):
        cc.create_campaign(
            user_id="u1", connected_account_id="conn-1", platform="google_ads", payload={},
        )


def test_create_campaign_raises_when_no_id_in_response(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {"successful": True, "data": {}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    with pytest.raises(cc.ComposioCallError):
        cc.create_campaign(
            user_id="u1", connected_account_id="conn-1", platform="google_ads", payload={},
        )


# --------------------------------------------------------------------------- set_status / set_budget


def test_set_campaign_status_uses_platform_slug(monkeypatch):
    calls = []

    def _execute(*, user_id, slug, arguments):
        calls.append((slug, arguments))
        return {"successful": True, "data": {"ok": True}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    out = cc.set_campaign_status(
        user_id="u1", connected_account_id="conn-1", platform="meta_ads",
        external_campaign_id="mc-1", status="paused",
    )
    assert out == {"ok": True}
    slug, args = calls[0]
    assert slug == "METAADS_UPDATE_CAMPAIGN"
    assert args["status"] == "paused"


def test_set_budget_stringifies_amount(monkeypatch):
    calls = []

    def _execute(*, user_id, slug, arguments):
        calls.append(arguments)
        return {"successful": True, "data": {}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    cc.set_budget(
        user_id="u1", connected_account_id="conn-1", platform="google_ads",
        external_campaign_id="c-1", daily_budget_usd=25,
    )
    assert calls[0]["daily_budget"] == "25"


# --------------------------------------------------------------------------- fetch_metrics


def test_fetch_metrics_parses_rows_tolerantly(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {
            "successful": True,
            "data": {
                "rows": [
                    {"campaign_id": "ext-1", "date": "2026-07-15", "impressions": 100,
                     "clicks": 5, "cost": 12.5, "conversions": 2, "revenue": 40},
                    {"campaignId": "ext-2", "impressions": 10, "clicks": 1,
                     "spend": "3.00"},
                ]
            },
        }

    monkeypatch.setattr(cc, "execute_tool", _execute)
    rows = cc.fetch_metrics(
        user_id="u1", connected_account_id="conn-1", platform="google_ads",
        date_from=date(2026, 7, 14), date_to=date(2026, 7, 15),
    )
    assert len(rows) == 2
    assert rows[0]["campaign_id"] == "ext-1"
    assert rows[0]["date"] == "2026-07-15"
    assert rows[0]["spend_usd"] == 12.5
    assert rows[0]["revenue_usd"] == 40
    # Second row has no date -> defaults to the window's end date.
    assert rows[1]["campaign_id"] == "ext-2"
    assert rows[1]["date"] == "2026-07-15"
    assert rows[1]["spend_usd"] == "3.00"


def test_fetch_metrics_drops_rows_with_no_campaign_id(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {"successful": True, "data": {"rows": [{"impressions": 5}]}}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    rows = cc.fetch_metrics(
        user_id="u1", connected_account_id="conn-1", platform="google_ads",
        date_from=date(2026, 7, 14), date_to=date(2026, 7, 15),
    )
    assert rows == []


def test_fetch_metrics_empty_on_platform_failure(monkeypatch):
    def _execute(*, user_id, slug, arguments):
        return {"successful": False, "error": "auth expired"}

    monkeypatch.setattr(cc, "execute_tool", _execute)
    with pytest.raises(cc.ComposioCallError):
        cc.fetch_metrics(
            user_id="u1", connected_account_id="conn-1", platform="google_ads",
            date_from=date(2026, 7, 14), date_to=date(2026, 7, 15),
        )
