"""Wasabi S3 object storage for produced media.

Wasabi is plain S3-compatible, so this is boto3 pointed at the Wasabi
endpoint. Config-gated like every other integration: without
`MARKETER_WASABI_ENABLED` + bucket + keys, `enabled()` is False and the
pipeline keeps its volume-only behavior — nothing raises, nothing uploads.

Key layout mirrors the artifacts volume so the two stay mentally
interchangeable:

    users/<user_id>/<job_id>/clips/scene_<i>.mp4
    users/<user_id>/<job_id>/keyframes/scene_<i>.png
    users/<user_id>/<job_id>/audio/voiceover.wav
    users/<user_id>/<job_id>/output/final.mp4
    users/<user_id>/compositions/<composition_id>.mp4

boto3 is synchronous; all entry points here are async and hop through
`asyncio.to_thread` so pipeline fan-out never blocks the event loop.
"""
from __future__ import annotations

import asyncio
import mimetypes
from functools import lru_cache
from pathlib import Path

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)


class ObjectStorageDisabled(RuntimeError):
    """Raised by call sites that *require* object storage (e.g. presigned
    playback of a wasabi-stored asset) when it isn't configured."""


def enabled() -> bool:
    return bool(
        settings.wasabi_enabled
        and settings.wasabi_bucket
        and settings.wasabi_access_key_id
        and settings.wasabi_secret_access_key
    )


@lru_cache(maxsize=1)
def _client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=settings.wasabi_endpoint_url,
        region_name=settings.wasabi_region,
        aws_access_key_id=settings.wasabi_access_key_id,
        aws_secret_access_key=settings.wasabi_secret_access_key,
    )


def reset_client_cache() -> None:
    """Tests flip settings at runtime; the lru_cache would pin the first."""
    _client.cache_clear()


def job_key(user_id: str, job_id: str, relative: str) -> str:
    return f"users/{user_id}/{job_id}/{relative}"


def composition_key(user_id: str, composition_id: str) -> str:
    return f"users/{user_id}/compositions/{composition_id}.mp4"


def _guess_content_type(path: Path) -> str:
    return mimetypes.guess_type(str(path))[0] or "application/octet-stream"


async def upload_file(local_path: Path, key: str) -> str:
    """Upload `local_path` to the configured bucket under `key`.

    Returns the key. Raises ObjectStorageDisabled when unconfigured —
    callers that mirror opportunistically should check `enabled()` first.
    """
    if not enabled():
        raise ObjectStorageDisabled("wasabi object storage is not configured")

    def _do() -> None:
        _client().upload_file(
            str(local_path),
            settings.wasabi_bucket,
            key,
            ExtraArgs={"ContentType": _guess_content_type(local_path)},
        )

    await asyncio.to_thread(_do)
    return key


async def download_file(key: str, local_path: Path) -> Path:
    if not enabled():
        raise ObjectStorageDisabled("wasabi object storage is not configured")
    local_path.parent.mkdir(parents=True, exist_ok=True)

    def _do() -> None:
        _client().download_file(settings.wasabi_bucket, key, str(local_path))

    await asyncio.to_thread(_do)
    return local_path


async def presigned_get_url(key: str, *, expires_sec: int | None = None) -> str:
    if not enabled():
        raise ObjectStorageDisabled("wasabi object storage is not configured")

    def _do() -> str:
        return _client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.wasabi_bucket, "Key": key},
            ExpiresIn=expires_sec or settings.wasabi_presign_expiry_sec,
        )

    return await asyncio.to_thread(_do)


async def delete_object(key: str) -> None:
    if not enabled():
        raise ObjectStorageDisabled("wasabi object storage is not configured")

    def _do() -> None:
        _client().delete_object(Bucket=settings.wasabi_bucket, Key=key)

    await asyncio.to_thread(_do)
