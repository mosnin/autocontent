"""SDK happy + error paths against a MockTransport."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from marketer.models import NicheCreatePayload, PostingWindow
from marketer.sdk import MarketerClient, MarketerError


def _client(handler) -> MarketerClient:
    transport = httpx.MockTransport(handler)
    return MarketerClient(
        base_url="https://api.test.local",
        token="mkt_testtoken12345",
        transport=transport,
    )


def _niche_row(*, niche_id=None) -> dict:
    return {
        "id": str(niche_id or uuid4()),
        "user_id": "user_abc",
        "title": "duck explains macro",
        "description": "d",
        "target_audience": "ta",
        "hashtags": ["econ"],
        "visual_style": "claymation",
        "voice": "onyx",
        "target_duration_sec": 60,
        "scene_count": 6,
        "image_quality": "medium",
        "video_resolution": "480p",
        "scene_max_duration_sec": 5,
        "tts_style_directions": None,
        "posting_windows": [{"hour": 9, "minute": 0, "tz": "America/Los_Angeles"}],
        "platforms": ["tiktok"],
        "daily_spend_cap_usd": "5.00",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "archived_at": None,
    }


def _job_row(*, job_id=None) -> dict:
    return {
        "id": str(job_id or uuid4()),
        "user_id": "user_abc",
        "niche_id": str(uuid4()),
        "platform": "tiktok",
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "clips": [],
        "script": None,
        "audio": None,
        "rendered": None,
        "scheduled_for": None,
        "provider_post_id": None,
        "error": None,
    }


async def test_env_var_fallback(monkeypatch):
    monkeypatch.setenv("MARKETER_API_BASE_URL", "https://from-env.local")
    monkeypatch.setenv("MARKETER_API_TOKEN", "mkt_envtoken12345")
    c = MarketerClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=[])))
    try:
        assert c._base_url == "https://from-env.local"
    finally:
        await c.aclose()


async def test_missing_env_raises(monkeypatch):
    monkeypatch.delenv("MARKETER_API_BASE_URL", raising=False)
    monkeypatch.delenv("MARKETER_API_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="MARKETER_API_BASE_URL"):
        MarketerClient()


async def test_list_niches_happy_path():
    captured: dict = {}
    row = _niche_row()

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["headers"] = dict(req.headers)
        return httpx.Response(200, json=[row])

    async with _client(handler) as c:
        out = await c.list_niches()
    assert len(out) == 1
    assert out[0].title == "duck explains macro"
    assert captured["headers"]["authorization"] == "Bearer mkt_testtoken12345"
    assert captured["url"].endswith("/api/v1/niches")


async def test_get_niche_404_raises():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "not found"})

    async with _client(handler) as c:
        with pytest.raises(MarketerError) as ei:
            await c.get_niche(uuid4())
    assert ei.value.status_code == 404


async def test_create_niche_sends_payload():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content)
        return httpx.Response(201, json=_niche_row())

    payload = NicheCreatePayload(
        title="t", description="d", target_audience="ta",
        hashtags=["a"], visual_style="vs", voice="onyx",
        target_duration_sec=60, scene_count=6,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"], daily_spend_cap_usd=Decimal("5.00"),
    )
    async with _client(handler) as c:
        await c.create_niche(payload)
    assert captured["body"]["title"] == "t"
    assert captured["body"]["platforms"] == ["tiktok"]


async def test_archive_niche_calls_delete():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["method"] = req.method
        captured["url"] = str(req.url)
        return httpx.Response(204)

    nid = uuid4()
    async with _client(handler) as c:
        await c.archive_niche(nid)
    assert captured["method"] == "DELETE"
    assert str(nid) in captured["url"]


async def test_list_jobs_filters_status():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["params"] = dict(req.url.params)
        return httpx.Response(200, json=[_job_row()])

    async with _client(handler) as c:
        await c.list_jobs(status="failed", limit=10)
    assert captured["params"]["status_filter"] == "failed"
    assert captured["params"]["limit"] == "10"


async def test_enqueue_job_posts_body():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content)
        return httpx.Response(202, json=_job_row())

    nid = uuid4()
    async with _client(handler) as c:
        await c.enqueue_job(niche_id=nid, platform="reels")
    assert captured["body"] == {"niche_id": str(nid), "platform": "reels"}


async def test_retry_job_posts_to_retry_path():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["method"] = req.method
        return httpx.Response(202, json=_job_row())

    jid = uuid4()
    async with _client(handler) as c:
        await c.retry_job(jid)
    assert captured["method"] == "POST"
    assert captured["url"].endswith(f"/api/v1/jobs/{jid}/retry")


async def test_today_spend_parses_decimals():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"by_niche": {"a": "1.50"}, "total_usd": "1.50"})

    async with _client(handler) as c:
        out = await c.today_spend()
    assert out.total_usd == Decimal("1.50")
    assert out.by_niche["a"] == Decimal("1.50")


async def test_connect_ayrshare_returns_url():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "profile_key": "pk-1",
            "login_url": "https://app.ayrshare.com/connect/xyz",
        })

    async with _client(handler) as c:
        res = await c.connect_ayrshare()
    assert res.login_url.startswith("https://")


async def test_ayrshare_status():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"connected": True, "profile_key": "pk-1"})

    async with _client(handler) as c:
        s = await c.ayrshare_status()
    assert s.connected is True


async def test_create_token_returns_plaintext_and_info():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={
            "token": "mkt_freshplaintext1234567",
            "info": {
                "id": str(uuid4()),
                "user_id": "user_abc",
                "name": "ci",
                "prefix": "mkt_fres",
                "last_used_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": None,
            },
        })

    async with _client(handler) as c:
        info, pt = await c.create_token(name="ci")
    assert pt.startswith("mkt_")
    assert info.prefix == "mkt_fres"


async def test_list_tokens_happy_path():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    async with _client(handler) as c:
        out = await c.list_tokens()
    assert out == []


async def test_revoke_token_204():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["method"] = req.method
        return httpx.Response(204)

    async with _client(handler) as c:
        await c.revoke_token(uuid4())
    assert captured["method"] == "DELETE"


async def test_server_error_surfaces_text_when_not_json():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    async with _client(handler) as c:
        with pytest.raises(MarketerError) as ei:
            await c.list_niches()
    assert ei.value.status_code == 500
    assert "boom" in ei.value.message


# --------------------------------------------------------------------------- ads

async def test_create_ad_campaign_posts_draft():
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["body"] = json.loads(req.content)
        return httpx.Response(201, json={"id": "c1", "status": "draft"})

    async with _client(handler) as c:
        out = await c.create_ad_campaign(
            ad_account_id="a1", name="Launch", daily_budget_usd="20"
        )
    assert out["status"] == "draft"
    assert captured["url"].endswith("/api/v1/ads/campaigns")
    assert captured["body"]["ad_account_id"] == "a1"


async def test_change_ad_budget_surfaces_402_deny():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"detail": "account kill-switch is engaged"})

    async with _client(handler) as c:
        with pytest.raises(MarketerError) as ei:
            await c.change_ad_budget("c1", "100")
    assert ei.value.status_code == 402
    assert "kill-switch" in ei.value.message


async def test_change_ad_budget_pending_approval_passthrough():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "pending_approval", "approval_id": "ap1"})

    async with _client(handler) as c:
        out = await c.change_ad_budget("c1", "100")
    assert out["status"] == "pending_approval"


async def test_connect_ad_account_returns_redirect():
    def handler(req: httpx.Request) -> httpx.Response:
        assert json.loads(req.content)["platform"] == "google_ads"
        return httpx.Response(200, json={"redirect_url": "https://auth/x", "account_id": "a1"})

    async with _client(handler) as c:
        out = await c.connect_ad_account("google_ads")
    assert out["redirect_url"].startswith("https://")


# --------------------------------------------------------------------------- x402

async def test_x402_buy_credits_returns_402_envelope():
    def handler(req: httpx.Request) -> httpx.Response:
        assert "x-payment" not in {k.lower() for k in req.headers}
        return httpx.Response(402, json={"x402Version": 1, "accepts": [{"scheme": "exact"}]})

    async with _client(handler) as c:
        out = await c.x402_buy_credits("10")
    assert out["status"] == "payment_required"
    assert out["requirements"]["accepts"][0]["scheme"] == "exact"


async def test_x402_buy_credits_credited_with_payment():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-payment") == "base64payload"
        return httpx.Response(
            200, json={"credited_usd": "10.00", "balance_usd": "10.00"},
            headers={"X-PAYMENT-RESPONSE": "resp64"},
        )

    async with _client(handler) as c:
        out = await c.x402_buy_credits("10", payment_header="base64payload")
    assert out["status"] == "credited"
    assert out["credited_usd"] == "10.00"
    assert out["payment_response"] == "resp64"
