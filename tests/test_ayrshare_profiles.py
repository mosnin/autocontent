from __future__ import annotations

import json

import httpx
import pytest

from marketer.services import ayrshare_profiles


@pytest.fixture(autouse=True)
def _ayrshare_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_api_key", "ayr-test")


@pytest.fixture
def patch_async_client(monkeypatch):
    """Force every httpx.AsyncClient(...) in ayrshare_profiles.py to use a
    user-provided MockTransport. Returns a setter."""
    holder: dict = {}

    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        if "transport" not in kwargs and holder.get("transport") is not None:
            kwargs["transport"] = holder["transport"]
        return original(*args, **kwargs)

    monkeypatch.setattr(ayrshare_profiles.httpx, "AsyncClient", _factory)

    def install(transport: httpx.MockTransport) -> None:
        holder["transport"] = transport

    return install


def _profiles_transport(*, captured: dict, response: dict, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["headers"] = dict(request.headers)
        if request.content:
            try:
                captured["body"] = json.loads(request.content)
            except json.JSONDecodeError:
                captured["body"] = request.content
        captured["url"] = str(request.url)
        return httpx.Response(status, json=response)

    return httpx.MockTransport(handler)


async def test_create_profile_returns_key_and_ref(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"profileKey": "pk-abc", "refId": "ref-xyz", "title": "alice@example.com"},
    ))

    profile_key, ref_id = await ayrshare_profiles.create_profile(title="alice@example.com")

    assert profile_key == "pk-abc"
    assert ref_id == "ref-xyz"
    assert captured["headers"]["authorization"] == "Bearer ayr-test"
    assert captured["body"] == {"title": "alice@example.com"}
    assert captured["request"].method == "POST"
    assert captured["request"].url.path.endswith("/profiles")
    # The master-key calls must NOT pass a Profile-Key header.
    assert "profile-key" not in captured["headers"]


async def test_create_profile_4xx_raises(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"status": "error", "message": "invalid title"},
        status=400,
    ))

    with pytest.raises(ayrshare_profiles.AyrshareProfileError, match="400"):
        await ayrshare_profiles.create_profile(title="")


async def test_create_profile_missing_fields_raises(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"refId": "ref-only"},  # no profileKey
    ))

    with pytest.raises(ayrshare_profiles.AyrshareProfileError, match="missing"):
        await ayrshare_profiles.create_profile(title="x")


async def test_generate_login_jwt_returns_url(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"url": "https://app.ayrshare.com/connect/xyz?token=jwt", "token": "jwt"},
    ))

    url = await ayrshare_profiles.generate_login_jwt(profile_key="pk-abc")

    assert url == "https://app.ayrshare.com/connect/xyz?token=jwt"
    assert captured["headers"]["authorization"] == "Bearer ayr-test"
    assert captured["request"].method == "GET"
    assert captured["request"].url.path.endswith("/profiles/generateJWT")
    assert captured["request"].url.params.get("profileKey") == "pk-abc"


async def test_generate_login_jwt_4xx_raises(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"status": "error", "message": "unknown profileKey"},
        status=404,
    ))

    with pytest.raises(ayrshare_profiles.AyrshareProfileError, match="404"):
        await ayrshare_profiles.generate_login_jwt(profile_key="pk-missing")


async def test_generate_login_jwt_missing_url_raises(patch_async_client):
    captured: dict = {}
    patch_async_client(_profiles_transport(
        captured=captured,
        response={"token": "jwt-without-url"},
    ))

    with pytest.raises(ayrshare_profiles.AyrshareProfileError, match="missing"):
        await ayrshare_profiles.generate_login_jwt(profile_key="pk-abc")


async def test_missing_api_key_raises(monkeypatch, patch_async_client):
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_api_key", "")
    patch_async_client(_profiles_transport(captured={}, response={}))

    with pytest.raises(RuntimeError, match="MARKETER_AYRSHARE_API_KEY"):
        await ayrshare_profiles.create_profile(title="x")
