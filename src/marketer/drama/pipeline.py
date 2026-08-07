"""Micro-drama orchestration: screenplay -> cast -> keyframes -> clips -> film.

This is an ORCHESTRATION layer only. Every provider call goes through an
existing service:

    LLM stages        -> agents.metered.run_metered (Agents SDK + ledger)
    style sheet       -> services.character_sheet
    portraits/frames  -> services.openai_images (+ services.provider_limits)
    per-shot video    -> services.provider_fallback.render_i2v_scene
    dialogue VO       -> services.provider_fallback.synthesize_vo_with_fallback
    stitch + mix      -> services.ffmpeg

Three invariants carry the design:

* **Metering.** A drama is the most expensive artifact in the product — one
  image AND one video generation per shot, plus a portrait per cast member.
  Every call is gated by `SpendContext` (per-niche daily cap, user global cap,
  prepaid credits) and a cheap `_ensure_cap` runs between stages as an early
  out. The race-safe guarantee is `SpendContext.log`'s post-spend re-read, the
  same as the video pipeline.

* **Resume.** `DramaPlan` is checkpointed to the row after every stage, and
  every expensive artifact is addressed by a deterministic path on the volume.
  A retry therefore re-buys nothing that already succeeded: the screenplay is
  in the plan, portraits and keyframes are adopted from disk, and completed
  shots keep their clips. This matters more here than for a 6-scene video: a
  drama that fails on shot 6 of 6 has already spent real money on 5.

* **Bounded fan-out.** Per-shot work runs concurrently but capped at
  `settings.scene_fanout_limit`. Unbounded, a 12-shot drama would fire 12
  image calls and 12 video calls at once — a rate-limit and spend-rate hazard,
  and enough in-flight spend to blow past the cap before the ledger reacts.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger, job_context
from ..models import Niche
from ..repos import dramas as dramas_repo
from ..repos import niches as niches_repo
from ..repos import spend as spend_repo
from ..services import character_sheet, ffmpeg, provider_fallback
from ..services.concurrency import user_lock
from ..services.spend_context import SpendContext, default_context
from ..storage.volume import ensure_layout
from . import characters as cast_stage
from . import screenwriter as writer_stage
from . import storyboard as storyboard_stage
from .schemas import Drama, DramaPlan, DramaStatus, Shot, clamp_shot_count

log = get_logger(__name__)


class DramaError(RuntimeError):
    pass


def drama_root(user_id: str, drama_id: UUID) -> Path:
    """Artifacts layout for one drama.

    `ensure_layout` gives us keyframes/clips/audio/captions/output; `cast/` is
    the drama-specific addition holding the locked reference portraits.
    """
    root = ensure_layout(f"{user_id}/dramas/{drama_id}")
    (root / "cast").mkdir(parents=True, exist_ok=True)
    return root


async def _ensure_cap(drama: Drama, niche: Niche) -> str | None:
    """Cheap pre-stage cap check. Returns an error message when the run must
    stop, else None. This is only the early-out; the race-safe enforcement is
    the post-spend re-check inside `SpendContext.log`."""
    try:
        await spend_repo.assert_within_cap(
            user_id=drama.user_id,
            niche_id=niche.id,
            cap_usd=niche.daily_spend_cap_usd,
        )
    except spend_repo.SpendCapExceeded as e:
        return str(e)

    from ..repos import users as users_repo

    user = await users_repo.get(drama.user_id)
    if user is not None and user.global_daily_cap_usd is not None:
        total = await spend_repo.today_spend_total_usd(user_id=drama.user_id)
        if total >= user.global_daily_cap_usd:
            return (
                f"user global daily cap exceeded: "
                f"${total} >= ${user.global_daily_cap_usd}"
            )
    return None


async def _style_reference(niche: Niche, spend: SpendContext) -> Path | None:
    """The niche character/style sheet, used as the art-direction seed for
    portraits and as the keyframe reference for cast-free shots.

    Fail-open: the sheet is seasoning, not a gate. A drama's own locked
    portraits are the real consistency mechanism, so a sheet failure degrades
    the look rather than killing a run that has already paid for a screenplay.
    """
    try:
        return await character_sheet.get_or_create(
            niche, quality=niche.image_quality, spend=spend
        )
    except spend_repo.SpendCapExceeded:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("drama: style sheet unavailable", extra={"error": str(e)})
        return None


async def _render_shot(
    shot: Shot,
    *,
    root: Path,
    plan: DramaPlan,
    niche: Niche,
    drama: Drama,
    style_reference: Path | None,
    spend: SpendContext,
) -> Shot:
    """One shot: keyframe then clip. Both steps adopt an existing file rather
    than re-buying it, so a partially-rendered shot resumes at the exact step
    it died on."""
    keyframe = await storyboard_stage.render_keyframe(
        shot,
        root=root,
        cast=plan.cast,
        niche=niche,
        aspect=drama.aspect,
        style_reference=style_reference,
        spend=spend,
    )
    clip = root / "clips" / f"shot_{shot.index:02d}.mp4"
    if not clip.exists():
        await provider_fallback.render_i2v_scene(
            keyframe,
            shot.motion_prompt or shot.action,
            clip,
            niche=niche,
            duration_sec=min(shot.duration_sec, float(niche.scene_max_duration_sec)),
            spend=spend,
        )
    return shot.model_copy(
        update={"keyframe_path": str(keyframe), "clip_path": str(clip)}
    )


async def _render_shots(
    *,
    root: Path,
    plan: DramaPlan,
    niche: Niche,
    drama: Drama,
    style_reference: Path | None,
    spend: SpendContext,
) -> tuple[list[Shot], list[BaseException]]:
    """Bounded per-shot fan-out. Returns (shots, errors); completed shots are
    returned even when siblings fail so the caller can checkpoint them."""
    sem = asyncio.Semaphore(settings.scene_fanout_limit)

    async def _bounded(s: Shot) -> Shot:
        # A shot whose clip is still on the volume costs nothing to "render".
        if s.clip_path and Path(s.clip_path).exists():
            return s
        async with sem:
            return await _render_shot(
                s,
                root=root,
                plan=plan,
                niche=niche,
                drama=drama,
                style_reference=style_reference,
                spend=spend,
            )

    results = await asyncio.gather(
        *[_bounded(s) for s in plan.shots], return_exceptions=True
    )
    done = {r.index: r for r in results if isinstance(r, Shot)}
    shots = [done.get(s.index, s) for s in plan.shots]
    errors = [r for r in results if isinstance(r, BaseException)]
    return shots, errors


async def _mix_dialogue_vo(
    *,
    root: Path,
    plan: DramaPlan,
    niche: Niche,
    silent_video: Path,
    out_path: Path,
    spend: SpendContext,
) -> Path:
    """Lay the drama's spoken lines over the silent cut.

    i2v clips are mute, so without this a drama is a silent film. The dialogue
    is synthesized once for the whole film (not per shot) — one TTS call is
    cheaper than N and keeps delivery continuous across cuts. Fail-open: a TTS
    problem downgrades to the silent cut rather than discarding every clip we
    already bought. A spend-cap breach still ends the run.
    """
    text = plan.dialogue_text
    if not text:
        return silent_video
    vo_path = root / "audio" / "dialogue.wav"
    try:
        if not vo_path.exists():
            await provider_fallback.synthesize_vo_with_fallback(
                text, vo_path, niche=niche, spend=spend
            )
    except spend_repo.SpendCapExceeded:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("drama: dialogue VO failed; keeping silent cut",
                    extra={"error": str(e)})
        return silent_video
    plan.voiceover_path = str(vo_path)
    ffmpeg.mix_audio(silent_video, vo_path, None, out_path)
    return out_path


async def run_drama(*, user_id: str, drama_id: UUID) -> Drama:
    """Run one micro-drama end to end. Idempotent-ish: safe to re-invoke on a
    failed/queued row — completed work is resumed, not re-bought."""
    drama = await dramas_repo.get(drama_id, user_id=user_id)
    if drama is None:
        raise DramaError(f"drama {drama_id} not found for user {user_id}")
    niche = await niches_repo.get(drama.niche_id, user_id=user_id)
    if niche is None:
        raise DramaError(f"niche {drama.niche_id} not found for user {user_id}")

    # Bound per-user concurrency the same way the video pipeline does. We
    # deliberately do NOT take the per-niche lock: that lock exists to
    # serialize video jobs against character-sheet writes, and holding it here
    # would make a drama and a scheduled video mutually exclusive for the same
    # niche (one of them silently skipped). A drama's consistency anchor is its
    # own locked cast, not the shared sheet.
    async with user_lock(user_id, max_parallel=settings.pipeline_per_user_concurrency):
        with job_context(job_id=drama.id, user_id=user_id, niche_id=drama.niche_id):
            spend = await default_context(
                user_id=user_id,
                niche_id=drama.niche_id,
                job_id=None,
                cap_usd=niche.daily_spend_cap_usd,
            )
            plan = drama.plan.model_copy(deep=True)
            try:
                return await _run_drama_inner(drama, niche, plan, spend)
            except spend_repo.SpendCapExceeded as e:
                return await _fail(drama, plan, str(e))
            except Exception as e:  # noqa: BLE001 — terminal backstop
                # Without this a provider blow-up strands the row in a
                # non-terminal status forever: unretryable, and holding paid
                # artifacts hostage.
                return await _fail(drama, plan, f"{type(e).__name__}: {e}", exc=e)


async def _fail(
    drama: Drama, plan: DramaPlan, error: str, exc: BaseException | None = None
) -> Drama:
    log.warning("drama failed", extra={"drama_id": str(drama.id), "error": error})
    try:
        import sentry_sdk

        if exc is not None:
            sentry_sdk.capture_exception(exc)
    except Exception as report_exc:  # noqa: BLE001 — sentry absent/uninitialised
        log.debug("sentry capture skipped", extra={"error": str(report_exc)})
    updated = await dramas_repo.fail(
        drama.id, user_id=drama.user_id, error=error, plan=plan
    )
    return updated or drama.model_copy(
        update={"status": DramaStatus.failed, "error": error, "plan": plan}
    )


async def _checkpoint(drama: Drama, plan: DramaPlan, status: DramaStatus) -> None:
    await dramas_repo.save_plan(drama.id, user_id=drama.user_id, plan=plan)
    await dramas_repo.set_status(drama.id, user_id=drama.user_id, status=status)


async def _run_drama_inner(
    drama: Drama, niche: Niche, plan: DramaPlan, spend: SpendContext
) -> Drama:
    root = drama_root(drama.user_id, drama.id)
    shot_count = clamp_shot_count(drama.shot_count)

    # ---- 1. Screenplay ---------------------------------------------------
    if plan.screenplay is None:
        if cap_error := await _ensure_cap(drama, niche):
            return await _fail(drama, plan, cap_error)
        await dramas_repo.set_status(
            drama.id, user_id=drama.user_id, status=DramaStatus.screenwriting
        )
        if drama.script.strip():
            # Caller supplied the script: the screenwriter stage is skipped
            # outright — no agent, no tokens, no ledger row.
            plan.screenplay, plan.shots = writer_stage.screenplay_from_script(
                drama.script
            )
        else:
            if not drama.idea.strip():
                return await _fail(drama, plan, "drama has neither an idea nor a script")
            plan.screenplay, plan.shots = await writer_stage.write_screenplay(
                drama.idea,
                niche=niche,
                shot_count=shot_count,
                aspect=drama.aspect,
                spend=spend,
            )
        await _checkpoint(drama, plan, DramaStatus.screenwriting)
    else:
        log.info("drama resume: reusing screenplay from prior attempt")

    screenplay = plan.screenplay
    assert screenplay is not None  # set above or resumed

    # ---- 2. Cast + locked reference portraits ----------------------------
    if cap_error := await _ensure_cap(drama, niche):
        return await _fail(drama, plan, cap_error)
    await dramas_repo.set_status(
        drama.id, user_id=drama.user_id, status=DramaStatus.casting
    )
    if not plan.cast:
        plan.cast = await cast_stage.extract_cast(
            screenplay.as_prompt_text(), niche=niche, spend=spend
        )
    style_reference = await _style_reference(niche, spend)
    # Always called: it's a no-op for characters whose portrait file already
    # exists, which is what makes the "locked once" rule survive retries.
    plan.cast = await cast_stage.lock_reference_portraits(
        plan.cast,
        root=root,
        niche=niche,
        style_reference=style_reference,
        spend=spend,
    )
    await _checkpoint(drama, plan, DramaStatus.casting)

    # ---- 3. Storyboard ---------------------------------------------------
    if not plan.shots or any(not s.has_prompts for s in plan.shots):
        if cap_error := await _ensure_cap(drama, niche):
            return await _fail(drama, plan, cap_error)
        await dramas_repo.set_status(
            drama.id, user_id=drama.user_id, status=DramaStatus.storyboarding
        )
        plan.shots = await storyboard_stage.design_storyboard(
            screenplay,
            shots=plan.shots,
            cast=plan.cast,
            shot_count=shot_count,
            niche=niche,
            aspect=drama.aspect,
            spend=spend,
        )
        await _checkpoint(drama, plan, DramaStatus.storyboarding)
    else:
        log.info("drama resume: reusing storyboard from prior attempt")

    if not plan.shots:
        return await _fail(drama, plan, "storyboard produced no shots")

    # ---- 4. Per-shot keyframe + clip (bounded fan-out) -------------------
    if cap_error := await _ensure_cap(drama, niche):
        return await _fail(drama, plan, cap_error)
    await dramas_repo.set_status(
        drama.id, user_id=drama.user_id, status=DramaStatus.rendering
    )
    plan.shots, errors = await _render_shots(
        root=root,
        plan=plan,
        niche=niche,
        drama=drama,
        style_reference=style_reference,
        spend=spend,
    )
    # Checkpoint BEFORE reacting to errors: the shots that succeeded are paid
    # for, and the retry must inherit them.
    await dramas_repo.save_plan(drama.id, user_id=drama.user_id, plan=plan)
    if errors:
        exc = next(
            (e for e in errors if isinstance(e, spend_repo.SpendCapExceeded)), errors[0]
        )
        return await _fail(drama, plan, f"{type(exc).__name__}: {exc}", exc=exc)

    rendered = plan.rendered_shots
    if not rendered:
        return await _fail(drama, plan, "no shots rendered")

    # ---- 5. Edit: stitch + dialogue ------------------------------------
    await dramas_repo.set_status(
        drama.id, user_id=drama.user_id, status=DramaStatus.editing
    )
    silent = root / "output" / "silent.mp4"
    ffmpeg.concat_clips(
        [Path(s.clip_path) for s in rendered if s.clip_path],
        silent,
        aspect=drama.aspect,
    )
    final = await _mix_dialogue_vo(
        root=root,
        plan=plan,
        niche=niche,
        silent_video=silent,
        out_path=root / "output" / "final.mp4",
        spend=spend,
    )
    try:
        duration = ffmpeg.probe_duration(final)
    except Exception:  # noqa: BLE001 — a probe failure is not a render failure
        duration = float(sum(s.duration_sec for s in rendered))

    updated = await dramas_repo.complete(
        drama.id,
        user_id=drama.user_id,
        plan=plan,
        video_path=str(final),
        duration_sec=duration,
    )
    log.info(
        "drama done",
        extra={
            "drama_id": str(drama.id),
            "shots": len(rendered),
            "cast": len(plan.cast),
        },
    )
    return updated or drama.model_copy(
        update={
            "status": DramaStatus.done,
            "plan": plan,
            "video_path": str(final),
            "duration_sec": duration,
        }
    )


# Re-exported for callers that want a conservative pre-flight estimate of what
# a drama will cost (the API could refuse obviously-unaffordable requests).
# Deliberately conservative-high, like campaign_est_cost_per_piece_usd.
def estimated_cost_usd(shot_count: int, cast_size: int = 2) -> Decimal:
    from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, image_cost

    shots = clamp_shot_count(shot_count)
    images = image_cost("medium") * Decimal(shots + cast_size)
    llm = LLM_CALL_ESTIMATE_USD * Decimal(3)
    video = Decimal("0.12") * Decimal(shots)
    return images + llm + video
