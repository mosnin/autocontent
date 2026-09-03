"""Cycle-1 production-hardening: deploy wiring, CORS, headers, hosted spend."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.cors import resolve_cors_origins
from marketer.services.spend_context import SpendContext


def test_modal_secrets_include_extra_and_providers():
    from modal_app import EXTRA_SECRET_NAMES, SECRET_NAMES

    assert "marketer-extra" in SECRET_NAMES
    assert "marketer-providers" in SECRET_NAMES
    assert SECRET_NAMES[:5] == (
        "marketer-openai",
        "marketer-xai",
        "marketer-ayrshare",
        "marketer-database",
        "marketer-clerk",
    )
    assert set(EXTRA_SECRET_NAMES) == {"marketer-extra", "marketer-providers"}


def test_cors_falls_back_to_app_url():
    origins, creds = resolve_cors_origins("", "https://autocontent-plum.vercel.app/")
    assert origins == ["https://autocontent-plum.vercel.app"]
    assert creds is True


def test_cors_web_origin_wins_over_app_url():
    origins, creds = resolve_cors_origins(
        "https://app.marketer.sh", "https://other.example"
    )
    assert origins == ["https://app.marketer.sh"]
    assert creds is True


def test_cors_empty_is_wildcard_without_credentials():
    origins, creds = resolve_cors_origins("", "")
    assert origins == ["*"]
    assert creds is False


def test_app_uses_app_url_for_cors_when_web_origin_unset(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "web_origin", "")
    monkeypatch.setattr(settings, "app_url", "https://autocontent-plum.vercel.app")
    from backend.main import create_app

    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get(
        "/healthz",
        headers={"Origin": "https://autocontent-plum.vercel.app"},
    )
    assert resp.status_code == 200
    assert (
        resp.headers.get("access-control-allow-origin")
        == "https://autocontent-plum.vercel.app"
    )


def test_security_headers_on_healthz(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "web_origin", "")
    from backend.main import create_app

    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/healthz")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def _spend_ctx() -> SpendContext:
    async def record(entry):
        return None

    return SpendContext(
        user_id="user_a", niche_id=uuid4(), job_id=uuid4(), record=record
    )


async def test_unbilled_usage_refused_when_flag_off(monkeypatch):
    from marketer.config import settings
    from marketer.repos.spend import SpendCapExceeded

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", False)

    with pytest.raises(SpendCapExceeded) as exc:
        await _spend_ctx().ensure_can_spend(Decimal("0.01"))
    assert exc.value.scope == "credits"


async def test_unbilled_usage_allowed_by_default(monkeypatch):
    from marketer.repos import billing as billing_repo
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "allow_unbilled_usage", True)

    async def explode(user_id):
        raise AssertionError("balance must not be read when billing is off")

    monkeypatch.setattr(billing_repo, "balance", explode)
    await _spend_ctx().ensure_can_spend(Decimal("100"))
