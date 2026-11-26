"""The story pipeline's view of our providers.

``StoryProviders`` is the seam the orchestration talks to; tests pass fakes.
``DefaultProviders`` maps it onto what Marketer already runs:

- text: OpenRouter (``story_settings.text_model``) when configured, else the
  OpenAI ``agent_model``; chat completions in JSON mode;
- images: ``services/openai_images`` (gpt-image-1, a reference image for
  character consistency);
- video: ``services/grok_imagine`` or ``services/fal_video`` image-to-video;
- assembly: ``services/ffmpeg.concat_clips``.

Every paid call logs through the ``spend`` it is given (a ``MeteredSpend``)
and the text call opens a GenAI span; the image and video services open their
own spans.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol

from ..config import settings
from ..observability import model_span
from ..services.spend_context import SpendContext
from .settings import story_settings

IMAGE_SIZES = {"9:16": "1024x1536", "16:9": "1536x1024", "1:1": "1024x1024"}


@dataclass
class ChatResult:
    data: dict[str, Any]
    model: str


class StoryProviders(Protocol):
    async def chat_json(self, *, system: str, user: str, spend: SpendContext, stage: str) -> ChatResult: ...
    async def image(self, prompt: str, out: Path, *, reference: Path | None, aspect: str, spend: SpendContext) -> Path: ...
    async def video(self, keyframe: Path, motion: str, out: Path, *, duration_sec: int, aspect: str, spend: SpendContext) -> Path: ...
    def assemble(self, clips: list[Path], out: Path, *, aspect: str) -> Path: ...
    def image_estimate_usd(self, aspect: str) -> Decimal: ...
    def video_estimate_usd(self, seconds: int) -> Decimal: ...
    def chat_estimate_usd(self) -> Decimal: ...


def parse_json_object(text: str) -> dict[str, Any]:
    """The first JSON object in a model reply (tolerates code fences)."""
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
        s = s[s.find("{"):] if "{" in s else s
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model reply had no JSON object")
    data = json.loads(s[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("model reply was not a JSON object")
    return data


class DefaultProviders:
    def __init__(self) -> None:
        self._client = None

    # ── text ────────────────────────────────────────────────────────────
    def _text_route(self) -> tuple[str, str]:
        from ..services import openrouter

        if openrouter.enabled() and openrouter.get_model(story_settings.text_model) is not None:
            return "openrouter", story_settings.text_model
        return "openai", settings.agent_model

    def _oai(self, provider: str):
        if self._client is None:
            from openai import AsyncOpenAI

            from ..services import openrouter

            if provider == "openrouter":
                self._client = AsyncOpenAI(base_url=openrouter.BASE_URL, api_key=settings.openrouter_api_key, timeout=180.0, max_retries=2)
            else:
                self._client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=180.0, max_retries=2)
        return self._client

    def _cost(self, provider: str, model: str, tin: int, tout: int) -> Decimal:
        if provider == "openrouter":
            from ..services import openrouter

            m = openrouter.get_model(model)
            if m is not None:
                return openrouter.llm_cost(m, tin, tout)
        from ..services.openai_pricing import llm_cost

        return llm_cost(model, tin, tout)

    def chat_estimate_usd(self) -> Decimal:
        from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD

        return LLM_CALL_ESTIMATE_USD

    async def chat_json(self, *, system: str, user: str, spend: SpendContext, stage: str) -> ChatResult:
        provider, model = self._text_route()
        await spend.ensure_can_spend(self.chat_estimate_usd())
        async with model_span("chat", model=model, provider=provider, tenant_id=spend.user_id,
                              attributes={"marketer.story.stage": stage}) as call:
            call.prompt([{"role": "system", "content": system}, {"role": "user", "content": user}])
            resp = await self._oai(provider).chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_object"},
                temperature=0.7,
            )
            u = getattr(resp, "usage", None)
            tin = int(getattr(u, "prompt_tokens", 0) or 0)
            tout = int(getattr(u, "completion_tokens", 0) or 0)
            cost = self._cost(provider, model, tin, tout)
            call.usage(tin, tout, tin + tout)
            call.response_model(getattr(resp, "model", None))
            call.cost(cost)
            # Charged the moment the call succeeded: log before parsing.
            await spend.log(provider=provider, sku=f"llm:{model}", units=Decimal(tin + tout), cost_usd=cost)
            text = resp.choices[0].message.content or ""
            call.completion(text)
        return ChatResult(data=parse_json_object(text), model=model)

    # ── images ──────────────────────────────────────────────────────────
    def image_estimate_usd(self, aspect: str) -> Decimal:
        from ..services.openai_pricing import image_cost

        return image_cost(story_settings.image_quality, size=IMAGE_SIZES.get(aspect, IMAGE_SIZES["9:16"]))

    async def image(self, prompt: str, out: Path, *, reference: Path | None, aspect: str, spend: SpendContext) -> Path:
        from ..services import openai_images, provider_limits

        out.parent.mkdir(parents=True, exist_ok=True)
        async with provider_limits.slot("openai_images"):
            return await openai_images.generate_keyframe(
                prompt, out, quality=story_settings.image_quality, size=IMAGE_SIZES.get(aspect, IMAGE_SIZES["9:16"]),
                reference_image_path=reference, spend=spend,
            )

    # ── video ───────────────────────────────────────────────────────────
    def video_estimate_usd(self, seconds: int) -> Decimal:
        if story_settings.video_provider == "fal" and story_settings.fal_model:
            from ..services import fal_video

            m = fal_video.get_model(story_settings.fal_model)
            if m is not None:
                return fal_video.video_cost(m, seconds)
        from ..services.xai_pricing import imagine_video_cost

        return imagine_video_cost(seconds)

    async def video(self, keyframe: Path, motion: str, out: Path, *, duration_sec: int, aspect: str, spend: SpendContext) -> Path:
        from ..services import provider_limits

        out.parent.mkdir(parents=True, exist_ok=True)
        if story_settings.video_provider == "fal" and story_settings.fal_model:
            from ..services import fal_video

            async with provider_limits.slot("fal"):
                return await fal_video.animate(keyframe, motion, out, model_id=story_settings.fal_model,
                                               duration_sec=duration_sec, spend=spend)
        from ..services import grok_imagine

        async with provider_limits.slot("grok"):
            return await grok_imagine.animate(keyframe, motion, out, duration_sec=duration_sec, aspect_ratio=aspect, spend=spend)

    # ── assembly ────────────────────────────────────────────────────────
    def assemble(self, clips: list[Path], out: Path, *, aspect: str) -> Path:
        from ..services import ffmpeg

        return ffmpeg.concat_clips(clips, out, aspect=aspect)


async def assemble_async(providers: StoryProviders, clips: list[Path], out: Path, *, aspect: str) -> Path:
    return await asyncio.to_thread(providers.assemble, clips, out, aspect=aspect)
