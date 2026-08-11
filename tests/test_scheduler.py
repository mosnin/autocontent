from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from marketer.services import scheduler


UPLOAD_URL = "https://images.ayrshare.com/abc/final.mp4"
POST_ID = "RhrbDtYh7hdSMc67zC8H"


@pytest.fixture(autouse=True)
def _ayrshare_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_api_key", "ayr-test")


@pytest.fixture
def patch_async_client(monkeypatch):
    """Force every httpx.AsyncClient(...) in scheduler.py to use a
    user-provided MockTransport. Returns a setter."""
    holder: dict = {}

    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        if "transport" not in kwargs and holder.get("transport") is not None:
            kwargs["transport"] = holder["transport"]
        return original(*args, **kwargs)

    monkeypatch.setattr(scheduler.httpx, "AsyncClient", _factory)

    def install(transport: httpx.MockTransport) -> None:
        holder["transport"] = transport

    return install


def _make_transport(*, captured: dict) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path.endswith("/media/upload"):
            captured["upload_request"] = request
            captured["upload_headers"] = dict(request.headers)
            return httpx.Response(200, json={
                "id": "upload-1",
                "url": UPLOAD_URL,
                "fileName": "final.mp4",
            })
        if request.method == "POST" and path.endswith("/post"):
            captured["post_request"] = request
            captured["post_headers"] = dict(request.headers)
            captured["post_body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "status": "scheduled",
                "scheduleDate": "2026-05-17T16:00:00Z",
                "id": POST_ID,
                "post": "...",
            })
        return httpx.Response(404, json={"error": f"unhandled {request.method} {path}"})

    return httpx.MockTransport(handler)


@pytest.fixture
def stub_user_lookup(monkeypatch):
    """Avoid hitting the database from users_repo.get."""
    from marketer.models import User

    async def _get(user_id: str):
        return User(id=user_id, email="x@y.z", ayrshare_profile_key="profile-key-xyz")
    monkeypatch.setattr(scheduler.users_repo, "get", _get)


async def test_schedule_post_uploads_then_schedules(
    tmp_path: Path, patch_async_client, stub_user_lookup
):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"\x00" * 1024)

    captured: dict = {}
    patch_async_client(_make_transport(captured=captured))

    post_id = await scheduler.schedule_post(
        video_path=video,
        caption="duck explains macro",
        hashtags=["econ", "fed"],
        platform="reels",
        scheduled_for=datetime(2026, 5, 17, 16, 0, tzinfo=timezone.utc),
        user_id="user_abc",
    )

    assert post_id == POST_ID
    # Profile-Key header on both calls
    assert captured["upload_headers"]["profile-key"] == "profile-key-xyz"
    assert captured["post_headers"]["profile-key"] == "profile-key-xyz"
    assert captured["upload_headers"]["authorization"] == "Bearer ayr-test"

    body = captured["post_body"]
    assert body["mediaUrls"] == [UPLOAD_URL]
    assert body["platforms"] == ["instagram"]  # "reels" -> "instagram"
    assert body["scheduleDate"] == "2026-05-17T16:00:00Z"
    assert "duck explains macro" in body["post"]
    assert "#econ" in body["post"] and "#fed" in body["post"]


async def test_platform_mapping(tmp_path, patch_async_client, stub_user_lookup):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"\x00" * 1024)

    for internal, ayr in [("tiktok", "tiktok"), ("reels", "instagram"), ("shorts", "youtube")]:
        captured: dict = {}
        patch_async_client(_make_transport(captured=captured))
        await scheduler.schedule_post(
            video_path=video, caption="x", hashtags=[], platform=internal,
            scheduled_for=datetime(2026, 5, 17, tzinfo=timezone.utc),
            user_id="user_abc",
        )
        assert captured["post_body"]["platforms"] == [ayr]


async def test_unknown_platform_raises(tmp_path, patch_async_client, stub_user_lookup):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"\x00")
    patch_async_client(_make_transport(captured={}))
    with pytest.raises(scheduler.AyrshareError):
        await scheduler.schedule_post(
            video_path=video, caption="x", hashtags=[], platform="threads",
            scheduled_for=datetime.now(timezone.utc), user_id="user_abc",
        )


async def test_missing_profile_key_raises(tmp_path, patch_async_client, monkeypatch):
    from marketer.models import User

    async def _get(_user_id: str):
        return User(id="user_abc", email="x@y.z", ayrshare_profile_key=None)
    monkeypatch.setattr(scheduler.users_repo, "get", _get)

    video = tmp_path / "final.mp4"
    video.write_bytes(b"\x00")
    patch_async_client(_make_transport(captured={}))

    with pytest.raises(scheduler.AyrshareError, match="ayrshare_profile_key"):
        await scheduler.schedule_post(
            video_path=video, caption="x", hashtags=[], platform="tiktok",
            scheduled_for=datetime.now(timezone.utc), user_id="user_abc",
        )


async def test_oversize_upload_rejected(tmp_path, patch_async_client, stub_user_lookup):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"\x00" * (scheduler.MAX_UPLOAD_BYTES + 1))
    patch_async_client(_make_transport(captured={}))

    with pytest.raises(scheduler.AyrshareError, match="upload limit"):
        await scheduler.schedule_post(
            video_path=video, caption="x", hashtags=[], platform="tiktok",
            scheduled_for=datetime.now(timezone.utc), user_id="user_abc",
        )


def test_iso_utc_handles_naive_and_aware():
    assert scheduler._iso_utc(datetime(2026, 5, 17, 16, 0)) == "2026-05-17T16:00:00Z"
    assert scheduler._iso_utc(
        datetime(2026, 5, 17, 9, 0, tzinfo=timezone.utc)
    ) == "2026-05-17T09:00:00Z"


def test_format_caption_appends_hashtags():
    out = scheduler._format_caption("hello", ["econ", "#fed"])
    assert "hello" in out
    assert "#econ" in out and "#fed" in out
    # Hashtag with leading # isn't double-prefixed
    assert "##fed" not in out
