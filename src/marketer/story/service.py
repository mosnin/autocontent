"""Story video operations shared by the API routes (and so by the agent tools).

Each operation that starts background work first wins an atomic status
transition (``claim_status``), then spawns the stage: a double click, a
retried request or two agents racing start the work once.

Renders: an estimate at or above ``story_settings.approval_usd`` parks the
story in ``awaiting_approval`` with the render's arguments hashed (story,
revision, every shot's frame revision, the estimate). A person with
``spend:approve`` approves it; the approval executes through the rails
enforcement point as ``content.story.render`` (kill switch ``spend``, the
argument binding, idempotency), so a storyboard changed after the request
cannot be rendered on the old approval.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from ..rails.canonical import args_hash
from .models import (
    BUSY,
    Scene,
    Shot,
    ShotView,
    StoryPlan,
    StoryStatus,
    StorySummary,
    StoryVideo,
    StoryView,
    key_clip,
    key_frame,
    key_portrait,
    micros_to_usd,
    usd_to_micros,
)
from .pipeline import WORKING
from .settings import story_settings
from .store import StoryStore, get_store

RENDER_ACTION = "content.story.render"

Spawner = Callable[[str, UUID, str, str | None], Awaitable[None]]


class StoryError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


async def _modal_spawn(user_id: str, story_id: UUID, stage: str, arg: str | None) -> None:
    import modal

    fn = modal.Function.from_name("marketer-sh", "run_story_stage")
    fn.spawn(user_id, str(story_id), stage, arg)


_spawner: Spawner = _modal_spawn


def set_spawner(fn: Spawner) -> Spawner:
    global _spawner
    previous, _spawner = _spawner, fn
    return previous


async def _spawn(story: StoryVideo, stage: str, arg: str | None = None) -> None:
    try:
        await _spawner(story.user_id, story.id, stage, arg)
    except Exception as exc:  # noqa: BLE001 - never leave a claimed row busy with nothing running
        await get_store().update(story.id, user_id=story.user_id, status=StoryStatus.failed, stage=stage,
                                 error=f"could not start the {stage} stage: {type(exc).__name__}")
        raise StoryError(503, "the render queue is unavailable, try again shortly") from exc


async def _claim(store: StoryStore, story: StoryVideo, allowed: set[StoryStatus], stage: str) -> StoryVideo:
    claimed = await store.claim_status(story.id, user_id=story.user_id, allowed={s.value for s in allowed},
                                       to=WORKING[stage].value, stage=stage)
    if claimed is None:
        raise StoryError(409, f"the story is {story.status.value.replace('_', ' ')}; it can't do that now")
    return claimed


async def load(story_id: UUID, user_id: str) -> StoryVideo:
    story = await get_store().get(story_id, user_id=user_id)
    if story is None:
        raise StoryError(404, "story not found")
    return story


async def create(*, user_id: str, actor_id: str, mode: str, source: str, requirement: str = "", style: str = "",
                 aspect: str = "9:16", title: str = "", niche_id: UUID | None = None) -> StoryVideo:
    store = get_store()
    story = await store.create(StoryVideo(
        id=uuid4(), user_id=user_id, niche_id=niche_id, created_by=actor_id, title=title.strip(), mode=mode,
        source=source.strip(), requirement=requirement.strip(), style=style.strip(), aspect=aspect,
        status=StoryStatus.writing, stage="script",
    ))
    await _spawn(story, "script")
    return story


_EDITABLE = {StoryStatus.script_ready, StoryStatus.storyboard_ready, StoryStatus.awaiting_approval, StoryStatus.done}


def _stale_plan(story: StoryVideo, scenes: list[Scene]) -> StoryPlan:
    # A new script makes the storyboard stale: characters and shots are
    # planned again for the new revision.
    return StoryPlan(logline=story.plan.logline, story=story.plan.story, scenes=scenes)


async def edit_script(story: StoryVideo, *, scenes: list[Scene], title: str | None = None) -> StoryVideo:
    if story.status not in _EDITABLE and not (story.status == StoryStatus.failed and story.plan.scenes):
        raise StoryError(409, "the script can't be edited right now")
    if not any(s.script.strip() for s in scenes):
        raise StoryError(422, "the script needs at least one scene")
    fields: dict[str, Any] = dict(
        plan=_stale_plan(story, [s for s in scenes if s.script.strip()][: story_settings.max_scenes]),
        revision=story.revision + 1, status=StoryStatus.script_ready, stage="", error=None,
        estimate_micros=0, approval_status=None, approval_args_hash=None, video_path=None,
    )
    if title is not None:
        fields["title"] = title.strip()[:200]
    updated = await get_store().update(story.id, user_id=story.user_id, **fields)
    assert updated is not None
    return updated


async def revise(story: StoryVideo, note: str) -> StoryVideo:
    store = get_store()
    claimed = await _claim(store, story, {StoryStatus.script_ready, StoryStatus.storyboard_ready, StoryStatus.awaiting_approval}, "revise")
    await store.put_checkpoint(story.id, f"note:r{story.revision + 1}", {"note": note.strip()[:2000]})
    await _spawn(claimed, "revise", note.strip()[:2000])
    return claimed


async def storyboard(story: StoryVideo) -> StoryVideo:
    claimed = await _claim(get_store(), story, {StoryStatus.script_ready}, "storyboard")
    await _spawn(claimed, "storyboard")
    return claimed


async def regenerate_shot(story: StoryVideo, idx: int, *, first_frame: str | None = None, motion: str | None = None) -> StoryVideo:
    if story.status not in {StoryStatus.storyboard_ready, StoryStatus.awaiting_approval, StoryStatus.done}:
        raise StoryError(409, "shots can be redrawn once the storyboard is ready")
    shots = list(story.plan.shots)
    if not 0 <= idx < len(shots):
        raise StoryError(404, "shot not found")
    upd: dict[str, Any] = {"frame_rev": shots[idx].frame_rev + 1}
    if first_frame is not None and first_frame.strip():
        upd["first_frame"] = first_frame.strip()[:2000]
    if motion is not None and motion.strip():
        upd["motion"] = motion.strip()[:1000]
    shots[idx] = shots[idx].model_copy(update=upd)
    store = get_store()
    claimed = await _claim(store, story, {StoryStatus.storyboard_ready, StoryStatus.awaiting_approval, StoryStatus.done}, "frame")
    claimed = await store.update(story.id, user_id=story.user_id, plan=story.plan.model_copy(update={"shots": shots}),
                                 approval_status=None, approval_args_hash=None, video_path=None) or claimed
    await _spawn(claimed, "frame", str(idx))
    return claimed


def render_args(story: StoryVideo) -> dict[str, Any]:
    """What a render approval is bound to."""
    return {
        "story_id": str(story.id),
        "revision": story.revision,
        "shots": [[s.idx, s.frame_rev] for s in story.plan.shots],
        "estimate_micros": story.estimate_micros,
    }


def needs_approval(story: StoryVideo) -> bool:
    return story.estimate_micros >= usd_to_micros(story_settings.approval_usd)


async def request_render(story: StoryVideo) -> StoryVideo:
    if story.status != StoryStatus.storyboard_ready:
        raise StoryError(409, "render the storyboard once it's ready")
    ceiling = usd_to_micros(story_settings.max_usd)
    if story.spent_micros + story.estimate_micros > ceiling:
        raise StoryError(402, f"this render would pass the ${story_settings.max_usd} limit for one story video")
    store = get_store()
    if needs_approval(story):
        updated = await store.update(story.id, user_id=story.user_id, status=StoryStatus.awaiting_approval, stage="",
                                     approval_status="pending", approval_args_hash=args_hash(RENDER_ACTION, render_args(story)))
        assert updated is not None
        return updated
    claimed = await _claim(store, story, {StoryStatus.storyboard_ready}, "render")
    await _spawn(claimed, "render")
    return claimed


async def approve_render(story: StoryVideo, *, ctx: Any) -> StoryVideo:
    """Execute a stored render approval through the rails."""
    from ..rails.enforce import enforce_dispatch, principal_of
    from ..rails.policy import ApprovalBinding

    if story.status != StoryStatus.awaiting_approval or story.approval_status != "pending":
        raise StoryError(409, "there's no render waiting for approval")
    store = get_store()
    dispatch = await enforce_dispatch(
        RENDER_ACTION, user_id=story.user_id, principal=principal_of(ctx), args=render_args(story),
        actor_email=getattr(ctx, "actor_email", "") or "", target_type="story_video", target_id=str(story.id),
        approval=ApprovalBinding(status="approved", stored_args_hash=story.approval_args_hash,
                                 current_args_hash=args_hash(RENDER_ACTION, render_args(story))),
    )
    try:
        claimed = await _claim(store, story, {StoryStatus.awaiting_approval}, "render")
    except StoryError as exc:
        await dispatch.failed(exc.detail)
        raise
    await store.update(story.id, user_id=story.user_id, approval_status="approved",
                       approved_by=getattr(ctx, "actor_id", "") or getattr(ctx, "user_id", ""),
                       approved_at=datetime.now(timezone.utc))
    # Handing the render to the queue is the side effect; it publishes nothing.
    await dispatch.run(lambda: _spawn(claimed, "render"), definite=(StoryError,))
    return claimed


async def decline_render(story: StoryVideo) -> StoryVideo:
    if story.status != StoryStatus.awaiting_approval:
        raise StoryError(409, "there's no render waiting for approval")
    updated = await get_store().update(story.id, user_id=story.user_id, status=StoryStatus.storyboard_ready,
                                       approval_status="expired", approval_args_hash=None)
    assert updated is not None
    return updated


STALE_AFTER = timedelta(minutes=45)


def _stale(story: StoryVideo) -> bool:
    """Busy with no progress for longer than any stage takes: its worker died."""
    return story.status in BUSY and story.updated_at is not None and datetime.now(timezone.utc) - story.updated_at > STALE_AFTER


async def retry(story: StoryVideo) -> StoryVideo:
    if story.status != StoryStatus.failed and not _stale(story):
        raise StoryError(409, "only a stopped story can be resumed")
    stage, _, arg = (story.stage or "script").partition(":")
    if stage not in WORKING:
        stage, arg = "script", ""
    claimed = await _claim(get_store(), story, {StoryStatus.failed, story.status}, stage)
    await _spawn(claimed, stage, arg or None)
    return claimed


# ── views ───────────────────────────────────────────────────────────────────

def _progress(story: StoryVideo, cps: dict[str, Any]) -> dict[str, Any]:
    rev = story.revision
    frames = sum(1 for s in story.plan.shots if key_frame(rev, s) in cps)
    clips = sum(1 for s in story.plan.shots if key_clip(rev, s) in cps)
    return {"shots": len(story.plan.shots), "frames": frames, "clips": clips}


async def view(story: StoryVideo) -> StoryView:
    cps = await get_store().checkpoints(story.id)
    rev = story.revision
    shots = [ShotView(**s.model_dump(), frame_ready=key_frame(rev, s) in cps, clip_ready=key_clip(rev, s) in cps)
             for s in story.plan.shots]
    portraits = [c.name for c in story.plan.characters if key_portrait(rev, c.name) in cps]
    return StoryView(
        id=story.id, niche_id=story.niche_id, title=story.title, mode=story.mode, source=story.source,
        requirement=story.requirement, style=story.style, aspect=story.aspect, status=story.status,
        stage=story.stage, revision=rev, logline=story.plan.logline, scenes=story.plan.scenes,
        characters=story.plan.characters, shots=shots, portraits=portraits,
        estimate_usd=micros_to_usd(story.estimate_micros), spent_usd=micros_to_usd(story.spent_micros),
        approval_status=story.approval_status, needs_approval=needs_approval(story),
        has_video=bool(story.video_path), error=story.error, progress=_progress(story, cps),
        created_at=story.created_at, updated_at=story.updated_at,
    )


def summary(story: StoryVideo) -> StorySummary:
    return StorySummary(id=story.id, title=story.title, status=story.status, stage=story.stage,
                        shots=len(story.plan.shots), spent_usd=micros_to_usd(story.spent_micros),
                        has_video=bool(story.video_path), created_at=story.created_at)


async def file_for(story: StoryVideo, kind: str, idx: int | None = None) -> str | None:
    """The file behind a frame, portrait or the final video (paths never leave the server)."""
    if kind == "video":
        return story.video_path
    cps = await get_store().checkpoints(story.id)
    rev = story.revision
    if kind == "frame" and idx is not None and 0 <= idx < len(story.plan.shots):
        hit = cps.get(key_frame(rev, story.plan.shots[idx]))
        return hit.get("path") if hit else None
    if kind == "portrait" and idx is not None and 0 <= idx < len(story.plan.characters):
        hit = cps.get(key_portrait(rev, story.plan.characters[idx].name))
        return hit.get("path") if hit else None
    return None


__all__ = ["BUSY", "Shot", "StoryError", "set_spawner"]
