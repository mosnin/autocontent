"""The person's own images and videos as footage.

Bytes never pass through the API (the web proxy caps bodies at 1 MB): the
browser PUTs straight to object storage with a short-lived presigned URL bound
to the declared content type, then asks us to check the object. The check:

1. the declared type and size are allowed (``validate_declared``);
2. the stored object's size matches what was declared and is under the limit;
3. the first bytes are really that format (``sniff``), not a renamed file;
4. ``ffprobe`` decodes it: one video stream (videos), sane dimensions and
   duration (``check_probe``).

Anything that fails is deleted from storage and marked rejected with the
reason. Footage is re-encoded when it is rendered, so container metadata never
reaches a finished video. There is no malware scanner in the stack: these are
structural checks (docs/short-video.md, open points).
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

ALLOWED: dict[str, tuple[str, int]] = {
    # content type: (kind, max bytes)
    "video/mp4": ("video", 200 * 1024 * 1024),
    "video/quicktime": ("video", 200 * 1024 * 1024),
    "video/webm": ("video", 200 * 1024 * 1024),
    "image/jpeg": ("image", 15 * 1024 * 1024),
    "image/png": ("image", 15 * 1024 * 1024),
    "image/webp": ("image", 15 * 1024 * 1024),
}
EXTENSIONS = {
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
}
MIN_SIDE = 360
MAX_SIDE = 8192
MAX_VIDEO_SEC = 180.0
MIN_VIDEO_SEC = 1.0
PRESIGN_SEC = 600


class UploadRejected(ValueError):
    pass


def validate_declared(content_type: str, size_bytes: int) -> str:
    """The upload's kind ('video' | 'image') or ``UploadRejected``."""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED:
        raise UploadRejected("use MP4, MOV or WebM video, or JPEG, PNG or WebP images")
    kind, limit = ALLOWED[ct]
    if size_bytes <= 0:
        raise UploadRejected("the file is empty")
    if size_bytes > limit:
        raise UploadRejected(f"{kind}s can be up to {limit // (1024 * 1024)} MB")
    return kind


def sniff(head: bytes) -> str | None:
    """The real content type from magic bytes, or None."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        return "video/quicktime" if brand == b"qt  " else "video/mp4"
    return None


def sniff_matches(declared: str, detected: str | None) -> bool:
    if detected is None:
        return False
    # MP4 and MOV share the ISO base media container; browsers label them loosely.
    iso = {"video/mp4", "video/quicktime"}
    return detected == declared or (declared in iso and detected in iso)


@dataclass(frozen=True)
class ProbeResult:
    width: int
    height: int
    duration_sec: float | None


def check_probe(kind: str, probe: dict[str, Any]) -> ProbeResult:
    streams = probe.get("streams") or []
    video = [s for s in streams if s.get("codec_type") == "video"]
    if not video:
        raise UploadRejected("no picture found in the file")
    v = video[0]
    try:
        w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    if min(w, h) < MIN_SIDE:
        raise UploadRejected(f"too small: at least {MIN_SIDE}px on the short side")
    if max(w, h) > MAX_SIDE:
        raise UploadRejected(f"too large: at most {MAX_SIDE}px on the long side")
    if kind == "image":
        return ProbeResult(w, h, None)
    try:
        dur = float((probe.get("format") or {}).get("duration") or v.get("duration") or 0)
    except (TypeError, ValueError):
        dur = 0.0
    if dur < MIN_VIDEO_SEC:
        raise UploadRejected("the video is under a second long")
    if dur > MAX_VIDEO_SEC:
        raise UploadRejected(f"videos can be up to {int(MAX_VIDEO_SEC)} seconds")
    return ProbeResult(w, h, dur)


def ffprobe_json(path: Path) -> dict[str, Any]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, timeout=60,
    ).stdout
    return json.loads(out or "{}")


def object_key(user_id: str, upload_id: UUID, content_type: str) -> str:
    return f"users/{user_id}/short-video/uploads/{upload_id}{EXTENSIONS.get(content_type, '')}"


def safe_filename(name: str) -> str:
    keep = "".join(ch for ch in (name or "") if ch.isalnum() or ch in " ._-")
    return keep.strip()[:120]


# -------------------------------------------------------------- storage I/O

async def presigned_put(key: str, content_type: str) -> str:
    import asyncio

    from ..config import settings
    from ..services import object_storage

    if not object_storage.enabled():
        raise object_storage.ObjectStorageDisabled("object storage is not configured")

    def _do() -> str:
        return object_storage._client().generate_presigned_url(
            "put_object",
            Params={"Bucket": settings.wasabi_bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=PRESIGN_SEC,
        )

    return await asyncio.to_thread(_do)


async def stored_size(key: str) -> int:
    import asyncio

    from ..config import settings
    from ..services import object_storage

    def _do() -> int:
        head = object_storage._client().head_object(Bucket=settings.wasabi_bucket, Key=key)
        return int(head.get("ContentLength") or 0)

    return await asyncio.to_thread(_do)


async def verify_stored(
    *, key: str, kind: str, content_type: str, declared_size: int, workdir: Path,
    size_of=stored_size, fetch=None, probe=ffprobe_json,
) -> ProbeResult:
    """Run checks 2-4 against the stored object. Raises ``UploadRejected``."""
    from ..services import object_storage

    _, limit = ALLOWED[content_type]
    try:
        size = await size_of(key)
    except Exception as e:  # noqa: BLE001 - missing object is the person's problem to retry
        raise UploadRejected("the file never arrived; upload it again") from e
    if size != declared_size or size > limit:
        raise UploadRejected("the stored file doesn't match what was declared")
    local = workdir / Path(key).name
    fetch = fetch or object_storage.download_file
    await fetch(key, local)
    try:
        with local.open("rb") as fh:
            head = fh.read(32)
        if not sniff_matches(content_type, sniff(head)):
            raise UploadRejected("the file's contents don't match its type")
        try:
            data = probe(local)
        except Exception as e:  # noqa: BLE001
            raise UploadRejected("the file couldn't be read as media") from e
        return check_probe(kind, data)
    finally:
        local.unlink(missing_ok=True)
