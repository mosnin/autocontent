"""gpt-image-1 keyframe generation.

Two entry points:
- `generate_keyframe(...)` for per-scene frames; accepts an optional
  `reference_image_path` (the niche character sheet) so the model keeps
  characters/look consistent across scenes.
- `generate_reference(...)` produces a stand-alone character/style sheet.

Returns the saved path; records a spend_ledger row when given a context.
"""
from __future__ import annotations

import base64
from decimal import Decimal
from pathlib import Path

from openai import AsyncOpenAI
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .openai_pricing import image_cost
from .spend_context import SpendContext

PROVIDER = "openai"
SKU = "gpt-image-1"
SIZE_9_16 = "1024x1536"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def _decode_b64_to(path: Path, b64: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(b64))
    return path


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(Exception),
)
async def generate_keyframe(
    prompt: str,
    out_path: Path,
    *,
    quality: str = "medium",
    size: str = SIZE_9_16,
    reference_image_path: Path | None = None,
    spend: SpendContext | None = None,
) -> Path:
    """Generate one keyframe; if `reference_image_path` is provided, pass
    it as an input so the model preserves the established look."""
    if spend is not None:
        await spend.ensure_can_spend(image_cost(quality))
    client = _get_client()
    if reference_image_path is not None:
        with reference_image_path.open("rb") as fp:
            result = await client.images.edit(
                model=SKU,
                image=fp,
                prompt=prompt,
                size=size,
                quality=quality,
                n=1,
            )
    else:
        result = await client.images.generate(
            model=SKU,
            prompt=prompt,
            size=size,
            quality=quality,
            n=1,
        )

    _decode_b64_to(out_path, result.data[0].b64_json)
    if spend is not None:
        await spend.log(
            provider=PROVIDER,
            sku=SKU,
            units=Decimal(1),
            cost_usd=image_cost(quality),
        )
    return out_path


async def generate_reference(
    prompt: str,
    out_path: Path,
    *,
    quality: str = "medium",
    size: str = SIZE_9_16,
    spend: SpendContext | None = None,
) -> Path:
    """Generate a stand-alone character/style sheet (no reference image)."""
    return await generate_keyframe(
        prompt,
        out_path,
        quality=quality,
        size=size,
        reference_image_path=None,
        spend=spend,
    )
