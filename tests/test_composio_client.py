"""The Composio adapter must be inert unless explicitly enabled + keyed, and
must never raise a raw ImportError. Tests run without the composio package."""
from __future__ import annotations

import pytest

from marketer.services import composio_client as cc
from marketer.services.composio_client import AdsDisabled


def test_disabled_by_default(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", False)
    monkeypatch.setattr(settings, "composio_api_key", "")
    assert cc.is_enabled() is False


def test_enabled_requires_both_flag_and_key(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "")
    assert cc.is_enabled() is False
    monkeypatch.setattr(settings, "composio_api_key", "ck_test")
    assert cc.is_enabled() is True


def test_initiate_raises_when_disabled(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", False)
    with pytest.raises(AdsDisabled):
        cc.initiate_connection(user_id="u1", platform="google_ads")


def test_platform_auth_config_none_when_unset(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "")
    assert cc.platform_auth_config("google_ads") is None
    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "ac_1")
    assert cc.platform_auth_config("google_ads") == "ac_1"


def test_initiate_unknown_platform_raises(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "ck_test")
    with pytest.raises(AdsDisabled):
        cc.initiate_connection(user_id="u1", platform="tiktok_ads")


def test_initiate_missing_auth_config_raises(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "ck_test")
    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "")
    with pytest.raises(AdsDisabled):
        cc.initiate_connection(user_id="u1", platform="google_ads")


def test_enabled_without_package_raises_adsdisabled_not_importerror(monkeypatch):
    """With everything configured but the composio package absent, we get a
    clean AdsDisabled — never a raw ImportError bubbling to a 500."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "ads_enabled", True)
    monkeypatch.setattr(settings, "composio_api_key", "ck_test")
    monkeypatch.setattr(settings, "composio_googleads_auth_config_id", "ac_1")
    # composio is not installed in the test env, so _client() import fails
    # -> AdsDisabled.
    with pytest.raises(AdsDisabled):
        cc.initiate_connection(user_id="u1", platform="google_ads")
