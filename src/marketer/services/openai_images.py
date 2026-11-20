"""gpt-image-1 keyframe generation.

Two entry points:
- `generate_keyframe(...)` for per-scene frames; accepts an optional
  `reference_image_path` (the niche character sheet) so the model keeps
  characters/look consistent across scenes.
- `generate_reference(...)` produces a stand-alone character/style sheet.

Returns the saved path; records a spend_ledger row when given a context.

Retry policy: only the provider API call is retried. The cap pre-flight,
spend recording, and decode/save steps run exactly once — a retry there
would double-spend (the API charges on success) or, worse, retry
`SpendCapExceeded` and blow past the daily cap.
"""
from __future__ import annotations

import base64
from decimal import Decimal
from pathlib import Path

from openai import AsyncOpenAI
from opentelemetry import trace
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger
from ..observability import model_span
from .openai_pricing import image_cost
from .retry_policy import is_content_policy_error, is_transient_openai_error
from .spend_context import SpendContext

log = get_logger(__name__)

# One softened re-prompt when the safety system refuses a scene prompt.
# Scene prompts are LLM-written; an occasional trip is expected and should
# not kill a job that already paid for ideation + scripting.
SAFE_PROMPT_PREFIX = (
    "Family-friendly, brand-safe, non-violent, fully-clothed illustration. "
)

PROVIDER = "openai"
SKU = "gpt-image-1"
SIZE_9_16 = "1024x1536"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        # Explicit timeout (the SDK default is 10 minutes). max_retries=0: the
        # tenacity policy on the call is the only retry, so attempts do not
        # multiply (3 here x 3 in the SDK).
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key, timeout=180.0, max_retries=0
        )
    return _client


def _image_span(quality: str, size: str, spend: SpendContext | None, *, reference: bool, operation: str = "generate"):
    """The GenAI span for one image call (docs/observability/braintrust.md).
    The prompt is content; the image never goes on a span."""
    return model_span(
        "generate_content",
        model=SKU,
        provider=PROVIDER,
        tenant_id=spend.user_id if spend is not None else None,
        name=f"gen_ai.image.{operation} {SKU}",
        attributes={
            "gen_ai.output.type": "image",
            "marketer.image.quality": quality,
            "marketer.image.size": size,
            "marketer.image.reference": reference,
        },
    )


def _decode_b64_to(path: Path, b64: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(b64))
    return path


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(is_transient_openai_error),
)
async def _call_api(
    prompt: str,
    *,
    quality: str,
    size: str,
    reference_image_path: Path | None,
):
    client = _get_client()
    if reference_image_path is not None:
        with reference_image_path.open("rb") as fp:
            return await client.images.edit(
                model=SKU,
                image=fp,
                prompt=prompt,
                size=size,
                quality=quality,
                n=1,
            )
    return await client.images.generate(
        model=SKU,
        prompt=prompt,
        size=size,
        quality=quality,
        n=1,
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
        await spend.ensure_can_spend(image_cost(quality, size=size))
    async with _image_span(quality, size, spend, reference=reference_image_path is not None) as call:
        call.prompt(prompt)
        try:
            result = await _call_api(
                prompt, quality=quality, size=size, reference_image_path=reference_image_path
            )
        except Exception as e:
            if not is_content_policy_error(e):
                raise
            # Safety refusal: soften once instead of failing the whole job.
            log.warning(
                "image prompt refused by safety system; retrying softened",
                extra={"error": str(e)},
            )
            call.set("marketer.image.softened", True)
            result = await _call_api(
                SAFE_PROMPT_PREFIX + prompt,
                quality=quality,
                size=size,
                reference_image_path=reference_image_path,
            )

        # The API charged us the moment the call above succeeded — record the
        # spend before decoding so a local failure can't undercount the ledger.
        cost = image_cost(quality, size=size)
        span = trace.get_current_span()
        span.set_attribute("openai.sku", SKU)
        span.set_attribute("openai.image_quality", quality)
        call.cost(cost)
        if spend is not None:
            await spend.log(
                provider=PROVIDER,
                sku=SKU,
                units=Decimal(1),
                cost_usd=cost,
            )
    _decode_b64_to(out_path, result.data[0].b64_json)
    return out_path


async def generate_remix(
    prompt: str,
    out_path: Path,
    *,
    reference_paths: list[Path],
    quality: str = "medium",
    size: str = "1024x1024",
    spend: SpendContext | None = None,
) -> Path:
    """Template remix: regenerate the template's aesthetic around the
    user's product. All references (template look + product shot) go to
    gpt-image-1 edit together; the prompt is the template's own."""
    if spend is not None:
        await spend.ensure_can_spend(image_cost(quality, size=size))

    async with _image_span(quality, size, spend, reference=True, operation="remix") as call:
        call.prompt(prompt)
        files = [p.open("rb") for p in reference_paths]
        try:
            result = await _call_remix_api(prompt, files=files, quality=quality, size=size)
        finally:
            for fp in files:
                fp.close()

        cost = image_cost(quality, size=size)
        call.cost(cost)
        if spend is not None:
            await spend.log(
                provider=PROVIDER,
                sku=SKU,
                units=Decimal(1),
                cost_usd=cost,
            )
    _decode_b64_to(out_path, result.data[0].b64_json)
    return out_path


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(is_transient_openai_error),
)
async def _call_remix_api(prompt: str, *, files: list, quality: str, size: str):
    client = _get_client()
    return await client.images.edit(
        model=SKU,
        image=files if len(files) > 1 else files[0],
        prompt=prompt,
        size=size,
        quality=quality,
        n=1,
    )


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
