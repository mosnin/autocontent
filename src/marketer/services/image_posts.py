"""Image-post pipeline: stills and carousels, end to end.

queued → planning (topic + carousel plan) → generating (slide 0 first,
then slides 1..n in one gather against that reference) →
awaiting_approval (when the niche requires sign-off) → scheduling
(Ayrshare multi-image) → done.

Cohesion trick: slide 0 renders first from the plan; every later slide
passes slide 0 as the reference image to gpt-image-1, so the whole set
inherits one aesthetic — the same mechanism the video pipeline uses for
character consistency, repurposed for design cohesion. Later slides do
not depend on each other, so they fan out.

Spend: every LLM/image call is metered through SpendContext with
image_post_id attribution, so caps, cost rollups, and campaign budgets
all see it.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from ..agents.carousel import CarouselPlan, CarouselSlide, template_carousel_plan
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
    plan = template_carousel_plan(
        topic=topic,
        kind=kind,
        slide_count=slide_count,
        niche_title=niche.title,
        visual_style=niche.visual_style,
    )
    # Templates do not meter. `spend` stays on the signature so callers
    # and campaign attribution do not fork.
    _ = spend
    # Normalize: sort by claimed index then reindex 0..n-1 so duplicate or
    # gapped planner indices can't overwrite slide files.
    ordered = sorted(plan.slides, key=lambda sl: sl.index)
    plan.slides = [
        sl.model_copy(update={"index": i})
        for i, sl in enumerate(ordered[: (1 if kind == "single" else MAX_SLIDES)])
    ]
    return _lock_image_copy(plan, niche, extra=topic)


def _lock_image_copy(plan: CarouselPlan, niche: Niche, extra: str = "") -> CarouselPlan:
    """Drop invented % / $ / study-year sentences from caption + on-image copy.

    Allowed tokens come from the niche brief plus the already-loaded
    topic — templates copy that topic into caption and headings.
    A heading/body/caption that would empty is left alone (fail-open).
    """
    if extra is None:
        extra = ""
    if not isinstance(extra, str):
        raise TypeError("extra must be a string")
    from ..jev.grounding import fact_tokens, strip_ungrounded_claims

    allowed = fact_tokens(
        " ".join(
            part
            for part in (
                niche.title,
                niche.description,
                niche.target_audience,
                extra,
            )
            if part
        )
    )
    caption, notes = strip_ungrounded_claims(plan.caption or "", allowed)
    slides = []
    for slide in plan.slides:
        heading, heading_notes = strip_ungrounded_claims(slide.heading or "", allowed)
        body, body_notes = strip_ungrounded_claims(slide.body or "", allowed)
        notes.extend(heading_notes)
        notes.extend(body_notes)
        updates: dict[str, str] = {}
        if heading_notes and heading.strip():
            updates["heading"] = heading
        if body_notes and body.strip():
            updates["body"] = body
        slides.append(slide.model_copy(update=updates) if updates else slide)
    if not notes:
        return plan
    log.info("image-post fact lock", extra={"stripped": len(notes)})
    updates: dict[str, Any] = {"slides": slides}
    if caption.strip():
        updates["caption"] = caption
    return plan.model_copy(update=updates)


async def _archive_slides_fail_open(
    *,
    user_id: str,
    niche_id: UUID,
    image_post_id: UUID,
    slide_paths: list[Path],
    title: str,
) -> None:
    try:
        await media_archive.archive_image_slides(
            user_id=user_id,
            niche_id=niche_id,
            image_post_id=image_post_id,
            slide_paths=slide_paths,
            title=title,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("image post archive failed", extra={"error": str(e)})


async def run_image_post(
    *, user_id: str, image_post_id: UUID, apply_schedule=None
) -> dict:
    """Drive one image post to a terminal state. `apply_schedule` is
    injectable for tests; production posts through Ayrshare."""
    post = await image_posts_repo.get(image_post_id, user_id=user_id)
    if post is None:
        raise ValueError(f"image post {image_post_id} not found for {user_id}")
    niche, spend = await asyncio.gather(
        niches_repo.get(post["niche_id"], user_id=user_id),
        default_context(
            user_id=user_id,
            niche_id=post["niche_id"],
            job_id=None,
            image_post_id=image_post_id,
            cap_usd=None,
        ),
    )
    if niche is None:
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error="niche not found"
        )
    if spend is not None:
        spend.cap_usd = niche.daily_spend_cap_usd

    if image_platform(niche, post["payload"].get("platform")) is None:
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id,
            error="no image-capable platform on this niche (YouTube/shorts "
                  "can't take still-image posts) — add reels or tiktok",
        )
    root = ensure_layout(f"{user_id}/imageposts/{image_post_id}")
    archive_task: asyncio.Task | None = None

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

        # 2. Generate — slide 0 first (aesthetic anchor), then fan-out
        # the rest against it. Later slides inherit slide 0, not each
        # other, so sequential generation was leftover wall-clock.
        await image_posts_repo.set_status(image_post_id, user_id=user_id, status="generating")
        slides = sorted(plan.slides, key=lambda s: s.index)
        if not slides:
            return await image_posts_repo.fail(
                image_post_id, user_id=user_id, error="planner produced no slides"
            )
        first = slides[0]
        first_out = root / "slides" / f"slide_{first.index}.png"
        await openai_images.generate_keyframe(
            first.visual_prompt,
            first_out,
            quality=niche.image_quality,
            reference_image_path=None,
            spend=spend,
        )

        async def _later(slide: CarouselSlide) -> Path:
            out = root / "slides" / f"slide_{slide.index}.png"
            await openai_images.generate_keyframe(
                slide.visual_prompt,
                out,
                quality=niche.image_quality,
                reference_image_path=first_out,
                spend=spend,
            )
            return out

        rest = await asyncio.gather(*[_later(s) for s in slides[1:]])
        paths: list[Path] = [first_out, *rest]

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

        # 3. Archive in the same beat as park / publish_gate. Fail-open.
        archive_task = asyncio.create_task(
            _archive_slides_fail_open(
                user_id=user_id,
                niche_id=niche.id,
                image_post_id=image_post_id,
                slide_paths=paths,
                title=plan.caption.splitlines()[0] if plan.caption else post["topic"],
            )
        )

        # 4. Approval gate (trust ramp parity with video).
        if niche.approve_before_post:
            parked, _ = await asyncio.gather(
                image_posts_repo.set_status(
                    image_post_id, user_id=user_id, status="awaiting_approval"
                ),
                archive_task,
            )
            return parked

        # 5. Schedule — publish_gate overlaps the remaining archive work.
        return await schedule_image_post(
            user_id=user_id,
            image_post_id=image_post_id,
            apply_schedule=apply_schedule,
            archive_task=archive_task,
            post={**post, "payload": payload},
            niche=niche,
        )
    except Exception as e:  # noqa: BLE001 — terminal backstop, no zombie rows
        if archive_task is not None and not archive_task.done():
            archive_task.cancel()
            try:
                await archive_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        log.warning(
            "image post failed", extra={"image_post_id": str(image_post_id), "error": str(e)}
        )
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error=f"{type(e).__name__}: {e}"
        )


async def schedule_image_post(
    *,
    user_id: str,
    image_post_id: UUID,
    apply_schedule=None,
    human_approved: bool = False,
    archive_task: asyncio.Task | None = None,
    post: dict[str, Any] | None = None,
    niche: Niche | None = None,
) -> dict:
    """Post the generated slides. Shared by the autonomous path and the
    approval resume. `archive_task` (when provided) overlaps Auto Mode.

    The generate path already loaded post + niche; pass them through so
    we do not pay two leftover reads before publish_gate.
    """
    if post is not None and not isinstance(post, dict):
        raise TypeError("post must be a dict")
    if niche is not None and not isinstance(niche, Niche):
        raise TypeError("niche must be a Niche")
    if post is None:
        post = await image_posts_repo.get(image_post_id, user_id=user_id)
    if post is None:
        raise ValueError(f"image post {image_post_id} not found")
    if niche is None:
        niche = await niches_repo.get(post["niche_id"], user_id=user_id)
    slides = post["payload"].get("slides", [])
    if not slides or niche is None:
        if archive_task is not None:
            archive_task.cancel()
            try:
                await archive_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        return await image_posts_repo.fail(
            image_post_id, user_id=user_id, error="nothing generated to post"
        )

    try:
        from ..jev.loops import publish_gate

        caption = post["payload"].get("caption", "")
        hashtags = post["payload"].get("hashtags", [])
        platform = image_platform(niche, post["payload"].get("platform")) or "reels"
        gate_coro = publish_gate(
            {
                "image_post_id": str(image_post_id),
                "caption": caption,
                "hashtags": hashtags,
                "platform": platform,
                "topic": post.get("topic") or "",
            },
            tool="schedule_image_post",
            human_approved=human_approved,
        )
        if archive_task is not None:
            gate, _ = await asyncio.gather(gate_coro, archive_task)
        else:
            gate = await gate_coro
        if gate.payload:
            payload = dict(post.get("payload") or {})
            payload["harness"] = gate.payload
            post = await image_posts_repo.save_payload(
                image_post_id, user_id=user_id, payload=payload
            )
        if gate.fail:
            return await image_posts_repo.fail(
                image_post_id,
                user_id=user_id,
                error=gate.reason or "jev auto-mode blocked publish",
            )
        if gate.park:
            return await image_posts_repo.set_status(
                image_post_id, user_id=user_id, status="awaiting_approval"
            )

        await image_posts_repo.set_status(image_post_id, user_id=user_id, status="scheduling")
        when = datetime.now(UTC)

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
