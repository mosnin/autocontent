"""Small image previews from owned storage. Never fetch a supplied URL."""

import asyncio
import base64
import io
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from ..config import settings

MAX_BYTES = 8 * 1024 * 1024


def local_bytes(path: str) -> bytes | None:
    root = Path(settings.artifacts_dir).resolve()
    target = Path(path).resolve()
    if not target.is_relative_to(root) or not target.is_file() or target.stat().st_size > MAX_BYTES:
        return None
    return target.read_bytes()


def render(data: bytes) -> str | None:
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > 40_000_000:
                return None
            image = ImageOps.exif_transpose(original)
            image.thumbnail((640, 640))
            output = io.BytesIO()
            image.convert("RGB").save(output, "JPEG", quality=75)
            return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None


async def thumbnail(kind: str, row: dict, index: int = 0) -> str | None:
    path = (
        row.get("hero_image_path")
        or row.get("image_path")
        or (row.get("media_path") if kind == "ad" and row.get("kind") == "image" else None)
    )
    if kind == "video":
        payload = row.get("payload") or {}
        rendered = payload.get("rendered_video") or payload.get("rendered") or {}
        path = rendered.get("thumbnail_path") if isinstance(rendered, dict) else None
    if kind == "image-post":
        slides = (row.get("payload") or {}).get("slides") or []
        path = (
            slides[index].get("path")
            if index < len(slides) and isinstance(slides[index], dict)
            else None
        )
    data = None
    if kind == "asset" and str(row.get("content_type", "")).startswith("image/"):
        if row.get("storage") == "wasabi":
            from .object_storage import _client

            def read_object():
                result = _client().get_object(Bucket=settings.wasabi_bucket, Key=row["object_key"])
                with result["Body"] as body:
                    if result.get("ContentLength", MAX_BYTES + 1) > MAX_BYTES:
                        return None
                    content = body.read(MAX_BYTES + 1)
                    return content if len(content) <= MAX_BYTES else None

            try:
                data = await asyncio.to_thread(read_object)
            except Exception:
                return None  # A missing/expired thumbnail never hides its creative.
        else:
            path = row.get("object_key")
    if path and not data:
        try:
            data = await asyncio.to_thread(local_bytes, path)
        except OSError:
            return None
    return await asyncio.to_thread(render, data) if data else None
