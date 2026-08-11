"""Tests for the boot-time config-health preflight (src/marketer/services/preflight.py)
and the FastAPI startup hook that runs it (backend/main.py)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.services import preflight


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clear_all(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset every gated field to its off/empty default so each test
    starts from a clean, all-disabled baseline."""
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "xai_api_key", "")
    monkeypatch.setattr(settings, "fal_api_key", "")
    monkeypatch.setattr(settings, "fal_price_overrides", "")
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "elevenlabs_api_key", "")
    monkeypatch.setattr(settings, "wasabi_enabled", False)
    monkeypatch.setattr(settings, "wasabi_bucket", "")
    monkeypatch.setattr(settings, "wasabi_access_key_id", "")
    monkeypatch.setattr(settings, "wasabi_secret_access_key", "")
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    monkeypatch.setattr(settings, "ads_enabled", False)
    monkeypatch.setattr(settings, "composio_api_key", "")
    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "")
    monkeypatch.setattr(settings, "composio_metaads_auth_config_id", "")
    monkeypatch.setattr(settings, "inngest_signing_key", "")
    monkeypatch.setattr(settings, "inngest_event_key", "")
    monkeypatch.setattr(settings, "inngest_dev", False)
    monkeypatch.setattr(settings, "x402_enabled", False)
    monkeypatch.setattr(settings, "x402_pay_to", "")
    monkeypatch.setattr(settings, "x402_asset", "")
    monkeypatch.setattr(settings, "preflight_strict", False)


def _find(report: preflight.PreflightReport, capability: str) -> preflight.CheckResult:
    for c in report.checks:
        if c.capability == capability:
            return c
    raise AssertionError(f"no check for capability {capability!r}")


# ---------------------------------------------------------------------------
# All-off baseline
# ---------------------------------------------------------------------------

def test_all_disabled_is_clean(monkeypatch):
    """With every pluggable feature off, nothing is a hard ERROR — only
    openai (always required) and xai (default video, warn) matter."""
    _clear_all(monkeypatch)
    report = preflight.run_preflight()

    assert report.overall_status == "error"  # openai key missing
    assert _find(report, "openai").status == "error"
    assert _find(report, "video.grok").status == "warn"
    assert _find(report, "video.fal").status == "warn"
    assert _find(report, "tts.elevenlabs").status == "warn"
    assert _find(report, "music.generated").status == "warn"
    assert _find(report, "script.openrouter").status == "warn"
    assert _find(report, "object_storage.wasabi").status == "ok"
    assert _find(report, "billing").status == "ok"
    assert _find(report, "ads").status == "ok"
    assert _find(report, "inngest").status == "ok"
    assert _find(report, "x402").status == "ok"
    assert _find(report, "fal_price_overrides").status == "ok"


def test_all_disabled_except_openai_is_fully_clean(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    report = preflight.run_preflight()

    assert report.overall_status == "warn"  # grok/fal/etc still warn, no errors
    assert not report.errors
    assert _find(report, "openai").status == "ok"


# ---------------------------------------------------------------------------
# Key present -> OK
# ---------------------------------------------------------------------------

def test_fal_key_present_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "fal_api_key", "fal-test-key")
    report = preflight.run_preflight()
    assert _find(report, "video.fal").status == "ok"


def test_elevenlabs_key_present_is_ok_for_voice_and_music(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "elevenlabs_api_key", "el-test-key")
    report = preflight.run_preflight()
    assert _find(report, "tts.elevenlabs").status == "ok"
    assert _find(report, "music.generated").status == "ok"


def test_openrouter_key_present_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "openrouter_api_key", "or-test-key")
    report = preflight.run_preflight()
    assert _find(report, "script.openrouter").status == "ok"


# ---------------------------------------------------------------------------
# Flag on + secret missing -> ERROR
# ---------------------------------------------------------------------------

def test_wasabi_enabled_without_creds_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "wasabi_enabled", True)
    report = preflight.run_preflight()
    result = _find(report, "object_storage.wasabi")
    assert result.status == "error"
    assert set(result.details["missing"]) == {
        "wasabi_bucket", "wasabi_access_key_id", "wasabi_secret_access_key",
    }


def test_wasabi_enabled_with_full_creds_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "wasabi_enabled", True)
    monkeypatch.setattr(settings, "wasabi_bucket", "media-bucket")
    monkeypatch.setattr(settings, "wasabi_access_key_id", "ak")
    monkeypatch.setattr(settings, "wasabi_secret_access_key", "sk")
    report = preflight.run_preflight()
    assert _find(report, "object_storage.wasabi").status == "ok"


def test_billing_enabled_without_stripe_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "billing_enabled", True)
    report = preflight.run_preflight()
    result = _find(report, "billing")
    assert result.status == "error"
    assert "stripe_secret_key" in result.details["missing"]
    assert "stripe_webhook_secret" in result.details["missing"]


def test_billing_enabled_with_stripe_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    report = preflight.run_preflight()
    assert _find(report, "billing").status == "ok"


def test_ads_enabled_without_composio_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "ads_enabled", True)
    report = preflight.run_preflight()
    assert _find(report, "ads").status == "error"


def test_ads_enabled_with_composio_but_missing_auth_configs_is_warn(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "co-test")
    report = preflight.run_preflight()
    result = _find(report, "ads")
    assert result.status == "warn"
    assert "composio_googleads_auth_config_id" in result.details["missing_auth_configs"]


def test_ads_enabled_without_inngest_keys_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "co-test")
    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "cfg1")
    monkeypatch.setattr(settings, "composio_metaads_auth_config_id", "cfg2")
    report = preflight.run_preflight()
    assert _find(report, "ads").status == "ok"
    assert _find(report, "inngest").status == "error"


def test_ads_enabled_inngest_dev_missing_keys_is_warn_not_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "inngest_dev", True)
    report = preflight.run_preflight()
    assert _find(report, "inngest").status == "warn"


def test_x402_enabled_without_pay_to_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "x402_enabled", True)
    report = preflight.run_preflight()
    result = _find(report, "x402")
    assert result.status == "error"
    assert "x402_pay_to" in result.details["missing"]
    assert "x402_asset" in result.details["missing"]


def test_x402_enabled_with_required_fields_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "x402_enabled", True)
    monkeypatch.setattr(settings, "x402_pay_to", "0xabc")
    monkeypatch.setattr(settings, "x402_asset", "0xusdc")
    report = preflight.run_preflight()
    assert _find(report, "x402").status == "ok"


def test_openai_missing_is_error(monkeypatch):
    _clear_all(monkeypatch)
    report = preflight.run_preflight()
    assert _find(report, "openai").status == "error"


def test_xai_missing_is_warn(monkeypatch):
    _clear_all(monkeypatch)
    report = preflight.run_preflight()
    assert _find(report, "video.grok").status == "warn"


# ---------------------------------------------------------------------------
# fal price overrides: bad shape -> WARN/ERROR
# ---------------------------------------------------------------------------

def test_fal_price_overrides_malformed_json_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "fal_price_overrides", "{not valid json")
    report = preflight.run_preflight()
    result = _find(report, "fal_price_overrides")
    assert result.status == "error"
    assert "error" in result.details


def test_fal_price_overrides_not_an_object_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "fal_price_overrides", "[1, 2, 3]")
    report = preflight.run_preflight()
    assert _find(report, "fal_price_overrides").status == "error"


def test_fal_price_overrides_bad_value_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(
        settings,
        "fal_price_overrides",
        '{"fal-ai/veo3/image-to-video": "not-a-number"}',
    )
    report = preflight.run_preflight()
    result = _find(report, "fal_price_overrides")
    assert result.status == "error"
    assert "fal-ai/veo3/image-to-video" in result.details["bad_values"]


def test_fal_price_overrides_non_positive_value_is_error(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(
        settings,
        "fal_price_overrides",
        '{"fal-ai/veo3/image-to-video": "-1"}',
    )
    report = preflight.run_preflight()
    assert _find(report, "fal_price_overrides").status == "error"


def test_fal_price_overrides_unknown_model_id_is_warn(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(
        settings,
        "fal_price_overrides",
        '{"fal-ai/not-a-real-model": "0.10"}',
    )
    report = preflight.run_preflight()
    result = _find(report, "fal_price_overrides")
    assert result.status == "warn"
    assert "fal-ai/not-a-real-model" in result.details["unknown_keys"]


def test_fal_price_overrides_valid_is_ok(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(
        settings,
        "fal_price_overrides",
        '{"fal-ai/veo3/image-to-video": "0.45"}',
    )
    report = preflight.run_preflight()
    result = _find(report, "fal_price_overrides")
    assert result.status == "ok"
    assert result.details["valid_entries"] == 1


# ---------------------------------------------------------------------------
# Report-level helpers
# ---------------------------------------------------------------------------

def test_report_to_dict_is_json_serializable(monkeypatch):
    import json

    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "wasabi_enabled", True)
    report = preflight.run_preflight()
    payload = report.to_dict()
    json.dumps(payload)  # must not raise
    assert payload["overall_status"] in ("ok", "warn", "error")
    assert isinstance(payload["checks"], list)
    assert all({"capability", "status", "message", "details"} <= set(c) for c in payload["checks"])


def test_overall_status_is_worst_of_all_checks(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "wasabi_enabled", True)  # forces an error
    report = preflight.run_preflight()
    assert report.overall_status == "error"
    assert len(report.errors) >= 1


def test_run_preflight_never_raises_even_if_a_check_blows_up(monkeypatch):
    """A single check raising must not take down the whole report."""
    _clear_all(monkeypatch)

    def _boom():
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(preflight, "_CHECKS", (*preflight._CHECKS, _boom))
    report = preflight.run_preflight()
    assert any(c.status == "error" and "simulated failure" in c.message for c in report.checks)


# ---------------------------------------------------------------------------
# Startup hook (backend/main.py) — non-fatal by default, raises when strict
# ---------------------------------------------------------------------------

def _app_client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")

    import sys
    import types

    fake_migrate = types.ModuleType("scripts.migrate")
    fake_migrate.status = lambda **_: {"applied": 3, "pending": 0}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "scripts.migrate", fake_migrate)

    from backend.main import create_app

    return TestClient(create_app(), raise_server_exceptions=True)


def test_startup_hook_does_not_crash_app_when_misconfigured_non_strict(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "wasabi_enabled", True)  # guaranteed ERROR
    monkeypatch.setattr(settings, "preflight_strict", False)

    client = _app_client(monkeypatch)
    with client:  # __enter__ runs the startup event
        resp = client.get("/healthz")
        assert resp.status_code == 200


def test_startup_hook_raises_under_preflight_strict(monkeypatch):
    _clear_all(monkeypatch)
    monkeypatch.setattr(settings, "wasabi_enabled", True)  # guaranteed ERROR
    monkeypatch.setattr(settings, "preflight_strict", True)

    client = _app_client(monkeypatch)
    with pytest.raises(Exception):  # noqa: B017 — startup failure surfaces as an exception on __enter__
        with client:
            pass
