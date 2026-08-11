"""Image-post pipeline: stills and carousels, end to end.

queued → planning (topic + carousel plan) → generating (slides, with
slide 1 as the aesthetic reference for the rest) → awaiting_approval
(when the niche requires sign-off) → scheduling (Ayrshare multi-image)
→ done.

Cohesion trick: slide 0 renders first from the plan; every later slide
passes slide 0 as the reference image to gpt-image-1, so the whole set
inherits one aesthetic — the same mechanism the video pipeline uses for
character consistency, repurposed for design cohesion.

Spend: every LLM/image call is metered through SpendContext with
image_post_id attribution, so caps, cost rollups, and campaign budgets
all see it.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from ..agents.metered import run_metered
from ..agents.carousel import CarouselPlan, build_carousel_agent
from ..logging import get_logger
from ..models import Niche
from ..repos import image_posts as image_posts_repo
from ..repos import niches as niches_repo
from ..services import media_archive, openai_images, scheduler
from ..services.spend_context import SpendContext, default_context
from ..storage.volume import ensure_layout

log = get_logger(__name__)

MAX_SLIDES = 10

# Ayrshare can't post still images to YouTube ("shorts"); pick the first
# platform that supports image posts so we fail BEFORE spending, not after.
_IMAGE_CAPABLE = ("reels", "tiktok")


def image_platform(niche: Niche, override: str | None = None) -> str | None:
    if override and override in _IMAGE_CAPABLE:
        return override
    for p in niche.platforms:
        if p in _IMAGE_CAPABLE:
            return p
    return None


async def _plan(
    *, topic: str, kind: str, slide_count: int, niche: Niche, spend: SpendContext
) -> CarouselPlan:
    brief_lines = (
        niche.creative_brief.ideation_lines()
        + niche.creative_brief.scriptwriter_lines()
        + niche.creative_brief.image_lines()
    )
    payload = {
        "topic": topic,
        "kind": kind,
        "slide_count": 1 if kind == "single" else max(2, min(MAX_SLIDES, slide_count)),
        "niche": f"{niche.title} — {niche.description}",
        "audience": niche.target_audience,
        "visual_style": niche.visual_style,
        "brief_lines": brief_lines,
    }
    result = await run_metered(
        build_carousel_agent(), json.dumps(payload), spend=spend
    )
    plan = result.final_output_as(CarouselPlan)
    # Normalize: sort by claimed index then reindex 0..n-1 so duplicate or
    # gapped planner indices can't overwrite slide files.
    ordered = sorted(plan.slides, key=lambda sl: sl.index)
    plan.slides = [
        sl.model_copy(update={"index": i})
        for i, sl in enumerate(ordered[: (1 if kind == "single" else MAX_SLIDES)])
    ]
    return plan


async def run_image_post(
    *, user_id: str, image_post_id: UUID, apply_schedule=None
) -> dict:
    """Drive one image post to a terminal state. `apply_schedule` is
    injectable for tests; production posts through Ayrshare."""
    post = await image_posts_repo.get(image_post_id, user_id=user_id)
    if post is None:
        raise ValueError(f"image post {image_post_id} not found for {user_id}")
    niche = await niches_repo.get(post["niche_id"], user_id=user_id)
    if niche is None:
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error="niche not found"
        )

    if image_platform(niche, post["payload"].get("platform")) is None:
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id,
            error="no image-capable platform on this niche (YouTube/shorts "
                  "can't take still-image posts) — add reels or tiktok",
        )

    spend = await default_context(
        user_id=user_id,
        niche_id=niche.id,
        job_id=None,
        image_post_id=image_post_id,
        cap_usd=niche.daily_spend_cap_usd,
    )
    root = ensure_layout(f"{user_id}/imageposts/{image_post_id}")

    try:
        # 1. Plan
        await image_posts_repo.set_status(image_post_id, user_id=user_id, status="planning")
        slide_count = int(post["payload"].get("slide_count", 5))
        plan = await _plan(
            topic=post["topic"] or niche.title,
            kind=post["kind"],
            slide_count=slide_count,
            niche=niche,
            spend=spend,
        )

        # 2. Generate — slide 0 first, then the rest against it.
        await image_posts_repo.set_status(image_post_id, user_id=user_id, status="generating")
        paths: list[Path] = []
        reference: Path | None = None
        for slide in sorted(plan.slides, key=lambda s: s.index):
            out = root / "slides" / f"slide_{slide.index}.png"
            await openai_images.generate_keyframe(
                slide.visual_prompt,
                out,
                quality=niche.image_quality,
                reference_image_path=reference,
                spend=spend,
            )
            paths.append(out)
            if reference is None:
                reference = out  # aesthetic anchor for the rest of the set

        payload: dict[str, Any] = {
            **post["payload"],
            "caption": plan.caption,
            "hashtags": plan.hashtags or niche.hashtags,
            "slides": [
                {"index": s.index, "heading": s.heading, "path": str(p)}
                for s, p in zip(sorted(plan.slides, key=lambda s: s.index), paths)
            ],
        }
        await image_posts_repo.save_payload(
            image_post_id, user_id=user_id, payload=payload
        )

        # 3. Archive into the library (fail-open, same as video).
        try:
            await media_archive.archive_image_slides(
                user_id=user_id, niche_id=niche.id, image_post_id=image_post_id,
                slide_paths=paths, title=plan.caption.splitlines()[0] if plan.caption else post["topic"],
            )
        except Exception as e:  # noqa: BLE001
            log.warning("image post archive failed", extra={"error": str(e)})

        # 4. Approval gate (trust ramp parity with video).
        if niche.approve_before_post:
            return await image_posts_repo.set_status(
                image_post_id, user_id=user_id, status="awaiting_approval"
            )

        # 5. Schedule.
        return await schedule_image_post(
            user_id=user_id, image_post_id=image_post_id, apply_schedule=apply_schedule
        )
    except Exception as e:  # noqa: BLE001 — terminal backstop, no zombie rows
        log.warning(
            "image post failed", extra={"image_post_id": str(image_post_id), "error": str(e)}
        )
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error=f"{type(e).__name__}: {e}"
        )


async def schedule_image_post(
    *, user_id: str, image_post_id: UUID, apply_schedule=None
) -> dict:
    """Post the generated slides. Shared by the autonomous path and the
    approval resume."""
    post = await image_posts_repo.get(image_post_id, user_id=user_id)
    if post is None:
        raise ValueError(f"image post {image_post_id} not found")
    niche = await niches_repo.get(post["niche_id"], user_id=user_id)
    slides = post["payload"].get("slides", [])
    if not slides or niche is None:
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error="nothing generated to post"
        )

    try:
        await image_posts_repo.set_status(image_post_id, user_id=user_id, status="scheduling")
        caption = post["payload"].get("caption", "")
        hashtags = post["payload"].get("hashtags", [])
        platform = image_platform(niche, post["payload"].get("platform")) or "reels"
        when = datetime.now(timezone.utc)

        poster = apply_schedule or scheduler.schedule_image_post
        provider_post_id = await poster(
            image_paths=[Path(s["path"]) for s in slides],
            caption=caption,
            hashtags=hashtags,
            platform=platform,
            scheduled_for=when,
            user_id=user_id,
        )
        return await image_posts_repo.complete(
            image_post_id, user_id=user_id, provider_post_id=provider_post_id
        )
    except Exception as e:  # noqa: BLE001 — terminal backstop: the approval
        # resume path has no outer catcher, and a row stuck in 'scheduling'
        # can never be re-approved.
        log.warning(
            "image post scheduling failed",
            extra={"image_post_id": str(image_post_id), "error": str(e)},
        )
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error=f"{type(e).__name__}: {e}"
        )
