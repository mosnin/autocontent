"""Unit tests for the Wasabi object-storage service (boto3 mocked)."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from marketer.config import settings
from marketer.services import object_storage


@pytest.fixture
def wasabi_on(monkeypatch):
    monkeypatch.setattr(settings, "wasabi_enabled", True)
    monkeypatch.setattr(settings, "wasabi_bucket", "test-bucket")
    monkeypatch.setattr(settings, "wasabi_access_key_id", "ak")
    monkeypatch.setattr(settings, "wasabi_secret_access_key", "sk")
    client = MagicMock()
    monkeypatch.setattr(object_storage, "_client", lambda: client)
    return client


def test_disabled_by_default():
    assert not object_storage.enabled()


async def test_upload_raises_when_disabled(tmp_path: Path):
    f = tmp_path / "a.mp4"
    f.write_bytes(b"x")
    with pytest.raises(object_storage.ObjectStorageDisabled):
        await object_storage.upload_file(f, "k")


def test_enabled_requires_all_keys(monkeypatch):
    monkeypatch.setattr(settings, "wasabi_enabled", True)
    monkeypatch.setattr(settings, "wasabi_bucket", "b")
    monkeypatch.setattr(settings, "wasabi_access_key_id", "")
    assert not object_storage.enabled()


async def test_upload_sets_key_and_content_type(tmp_path: Path, wasabi_on):
    f = tmp_path / "scene_0.mp4"
    f.write_bytes(b"MP4")
    key = object_storage.job_key("user_1", "job_1", "clips/scene_0.mp4")
    assert key == "users/user_1/job_1/clips/scene_0.mp4"

    returned = await object_storage.upload_file(f, key)

    assert returned == key
    args = wasabi_on.upload_file.call_args
    assert args.args == (str(f), "test-bucket", key)
    assert args.kwargs["ExtraArgs"]["ContentType"] == "video/mp4"


async def test_presigned_url(wasabi_on):
    wasabi_on.generate_presigned_url.return_value = "https://signed"
    url = await object_storage.presigned_get_url("k", expires_sec=60)
    assert url == "https://signed"
    kwargs = wasabi_on.generate_presigned_url.call_args.kwargs
    assert kwargs["Params"] == {"Bucket": "test-bucket", "Key": "k"}
    assert kwargs["ExpiresIn"] == 60


async def test_download_creates_parent_dirs(tmp_path: Path, wasabi_on):
    target = tmp_path / "nested" / "dir" / "clip.mp4"
    out = await object_storage.download_file("k", target)
    assert out == target
    assert target.parent.is_dir()
    wasabi_on.download_file.assert_called_once_with("test-bucket", "k", str(target))
