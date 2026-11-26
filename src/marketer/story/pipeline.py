"""Story video orchestration: stages, checkpoints, resume.

The stage structure follows ViMax's Idea2Video / Script2Video pipelines
(screenwriter → character extraction → storyboard → reference portraits →
first frames → shot videos → assembly; MIT, THIRD_PARTY_NOTICES.md). The code
is ours: ViMax checkpoints to files in a working directory, we checkpoint to
``story_checkpoints`` rows keyed by the revision of everything that shaped
the unit, and every paid call is metered (meter.py) under the rails' caps.

A person stands between the stages: the script is reviewed (and can be
edited or revised with a note) before the storyboard is drawn, and the
storyboard is reviewed (each shot can be regenerated) before anything is
rendered. ``run_stage`` runs one background stage; it is safe to run again
after any failure: finished units are skipped, and a replayed paid call is
never charged twice.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar
from uuid import UUID

from opentelemetry import trace

from ..config import settings
from ..logging import get_logger
from ..observability import scope as obs_scope
from ..services import otel
from ..services.spend_context import SpendContext
from . import prompts
from .meter import StoryMeter
from .models import (
    Character,
    Scene,
    Shot,
    StoryPlan,
    StoryStatus,
    StoryVideo,
    key_characters,
    key_clip,
    key_final,
    key_frame,
    key_portrait,
    key_scenes,
    key_shots,
    key_story,
    usd_to_micros,
)
from .providers import DefaultProviders, StoryProviders, assemble_async
from .settings import story_settings
from .store import StoryStore, get_store

log = get_logger(__name__)
T = TypeVar("T")

STAGES = ("script", "revise", "storyboard", "frame", "render")
# The status a stage works in, and the one it leaves on success.
WORKING = {"script": StoryStatus.writing, "revise": StoryStatus.writing, "storyboard": StoryStatus.boarding,
           "frame": StoryStatus.boarding, "render": StoryStatus.rendering}


def story_root(user_id: str, story_id: UUID) -> Path:
    return Path(settings.artifacts_dir) / user_id / "stories" / str(story_id)


@dataclass
class Run:
    story: StoryVideo
    store: StoryStore
    providers: StoryProviders
    meter: StoryMeter
    root: Path
    cps: dict[str, dict[str, Any]]

    @property
    def spend(self) -> SpendContext:
        return self.meter.spend

    async def once(self, key: str, stage: str, fn: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
        """Run ``fn`` unless ``key`` already has a checkpoint (whose file, if
        it names one, still exists). Store the artifact it returns."""
        hit = self.cps.get(key)
        if hit is not None and (not hit.get("path") or Path(hit["path"]).exists()):
            return hit
        async with self.meter.unit(key, stage):
            artifact = await fn()
        await self.store.put_checkpoint(self.story.id, key, artifact)
        self.cps[key] = artifact
        return artifact

    async def save(self, **fields: Any) -> None:
        updated = await self.store.update(self.story.id, user_id=self.story.user_id, **fields)
        if updated is not None:
            self.story = updated


def _span(name: str):
    return otel.get_tracer(__name__).start_as_current_span(f"pipeline.story.{name}", attributes={"marketer.stage": name})


async def _gather_limited(items: list[T], fn: Callable[[T], Awaitable[Any]], limit: int) -> list[Any]:
    sem = asyncio.Semaphore(max(1, limit))

    async def one(item: T) -> Any:
        async with sem:
            return await fn(item)

    return await asyncio.gather(*(one(i) for i in items))


def _text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


# ── writing ─────────────────────────────────────────────────────────────────

async def _stage_script(run: Run) -> None:
    s, rev, cfg = run.story, run.story.revision, story_settings
    req = s.requirement or "(none)"
    logline, story_text, title = "", s.source, s.title
    if s.mode == "idea":
        async def develop() -> dict[str, Any]:
            res = await run.providers.chat_json(
                system=prompts.DEVELOP_STORY_SYSTEM.format(max_scenes=cfg.max_scenes),
                user=prompts.DEVELOP_STORY_USER.format(idea=s.source, requirement=req), spend=run.spend, stage="story",
            )
            return {"title": _text(res.data.get("title"), 200), "logline": _text(res.data.get("logline"), 400),
                    "story": _text(res.data.get("story"), 12000)}

        with _span("develop"):
            dev = await run.once(key_story(rev), "story", develop)
        logline, story_text, title = dev["logline"], dev["story"] or s.source, title or dev["title"]

    async def scenes() -> dict[str, Any]:
        res = await run.providers.chat_json(
            system=prompts.WRITE_SCENES_SYSTEM.format(max_scenes=cfg.max_scenes),
            user=prompts.WRITE_SCENES_USER.format(story=story_text, requirement=req), spend=run.spend, stage="scenes",
        )
        return {"title": _text(res.data.get("title"), 200), "scenes": _scenes(res.data.get("scenes"))}

    with _span("scenes"):
        sc = await run.once(key_scenes(rev), "scenes", scenes)
    plan = StoryPlan(logline=logline, story=story_text if s.mode == "idea" else "", scenes=[Scene(**x) for x in sc["scenes"]])
    await run.save(plan=plan, title=title or sc["title"] or "Untitled story", status=StoryStatus.script_ready, stage="")


def _scenes(raw: Any) -> list[dict[str, str]]:
    out = []
    for x in (raw or [])[: story_settings.max_scenes]:
        if isinstance(x, dict) and str(x.get("script") or "").strip():
            out.append({"heading": _text(x.get("heading"), 200), "script": _text(x.get("script"), 6000)})
        elif isinstance(x, str) and x.strip():
            out.append({"heading": "", "script": x.strip()[:6000]})
    if not out:
        raise ValueError("the writer returned no scenes")
    return out


async def _stage_revise(run: Run, note: str) -> None:
    s, cfg = run.story, story_settings
    new_rev = s.revision + 1
    current = "\n\n".join(f"{sc.heading}\n{sc.script}" for sc in s.plan.scenes)

    async def revise() -> dict[str, Any]:
        res = await run.providers.chat_json(
            system=prompts.REVISE_SCENES_SYSTEM.format(max_scenes=cfg.max_scenes),
            user=prompts.REVISE_SCENES_USER.format(scenes=current, note=note), spend=run.spend, stage="revise",
        )
        return {"title": _text(res.data.get("title"), 200), "scenes": _scenes(res.data.get("scenes"))}

    with _span("revise"):
        out = await run.once(key_scenes(new_rev), "revise", revise)
    plan = StoryPlan(logline=s.plan.logline, story=s.plan.story, scenes=[Scene(**x) for x in out["scenes"]])
    await run.save(plan=plan, revision=new_rev, title=out["title"] or s.title, status=StoryStatus.script_ready, stage="",
                   estimate_micros=0, approval_status=None, approval_args_hash=None)


# ── storyboard ──────────────────────────────────────────────────────────────

def _characters_text(chars: list[Character]) -> str:
    return "\n".join(f"- {c.name}{'' if c.visible else ' (not visible)'}: {c.static_features}; {c.dynamic_features}" for c in chars) or "(none)"


async def _plan_shots(run: Run) -> None:
    s, rev, cfg = run.story, run.story.revision, story_settings
    if s.plan.shots and s.plan.characters:
        return
    script = "\n\n".join(f"{sc.heading}\n{sc.script}" for sc in s.plan.scenes)

    async def characters() -> dict[str, Any]:
        res = await run.providers.chat_json(
            system=prompts.EXTRACT_CHARACTERS_SYSTEM.format(max_characters=cfg.max_characters),
            user=prompts.EXTRACT_CHARACTERS_USER.format(script=script), spend=run.spend, stage="characters",
        )
        chars = []
        for x in (res.data.get("characters") or [])[: cfg.max_characters]:
            if isinstance(x, dict) and str(x.get("name") or "").strip():
                chars.append(Character(name=_text(x["name"], 80), visible=bool(x.get("visible", True)),
                                       static_features=_text(x.get("static_features"), 1000),
                                       dynamic_features=_text(x.get("dynamic_features"), 1000)).model_dump())
        return {"characters": chars}

    with _span("characters"):
        chars = [Character(**c) for c in (await run.once(key_characters(rev), "characters", characters))["characters"]]
    names = {c.name for c in chars}
    per_scene = max(1, cfg.max_shots // max(1, len(s.plan.scenes)))

    async def shots_for(i: int) -> dict[str, Any]:
        async def design() -> dict[str, Any]:
            sc = s.plan.scenes[i]
            res = await run.providers.chat_json(
                system=prompts.DESIGN_SHOTS_SYSTEM.format(max_shots=per_scene, shot_seconds=cfg.shot_seconds),
                user=prompts.DESIGN_SHOTS_USER.format(scene=f"{sc.heading}\n{sc.script}", characters=_characters_text(chars),
                                                      requirement=s.requirement or "(none)"),
                spend=run.spend, stage="shots",
            )
            shots = []
            for x in (res.data.get("shots") or [])[:per_scene]:
                if not isinstance(x, dict) or not str(x.get("first_frame") or x.get("visual") or "").strip():
                    continue
                shots.append({
                    "visual": _text(x.get("visual"), 2000), "first_frame": _text(x.get("first_frame") or x.get("visual"), 2000),
                    "motion": _text(x.get("motion"), 1000), "narration": _text(x.get("narration"), 400),
                    "characters": [n for n in (x.get("characters") or []) if isinstance(n, str) and n in names],
                })
            if not shots:
                raise ValueError(f"no shots for scene {i + 1}")
            return {"shots": shots}

        return await run.once(key_shots(rev, i), "shots", design)

    with _span("shots"):
        per = await asyncio.gather(*(shots_for(i) for i in range(len(s.plan.scenes))))
    shots: list[Shot] = []
    for scene_idx, block in enumerate(per):
        for x in block["shots"]:
            shots.append(Shot(idx=len(shots), scene_idx=scene_idx, duration_sec=cfg.shot_seconds, **x))
    plan = s.plan.model_copy(update={"characters": chars, "shots": shots[: cfg.max_shots]})
    await run.save(plan=plan)


async def _portraits(run: Run) -> dict[str, Path]:
    s, rev = run.story, run.story.revision

    async def portrait(c: Character) -> tuple[str, Path]:
        out = run.root / "portraits" / f"{key_portrait(rev, c.name).split(':')[-1]}.png"

        async def draw() -> dict[str, Any]:
            prompt = prompts.PORTRAIT_PROMPT.format(name=c.name, static=c.static_features, dynamic=c.dynamic_features,
                                                    style=s.style or "cinematic, natural light")
            await run.providers.image(prompt, out, reference=None, aspect=s.aspect, spend=run.spend)
            return {"path": str(out), "name": c.name}

        art = await run.once(key_portrait(rev, c.name), "portrait", draw)
        return c.name, Path(art["path"])

    with _span("portraits"):
        pairs = await _gather_limited([c for c in s.plan.characters if c.visible], portrait, story_settings.parallel)
    return dict(pairs)


async def _frame(run: Run, shot: Shot, portraits: dict[str, Path]) -> Path:
    s, rev = run.story, run.story.revision
    out = run.root / "frames" / f"shot_{shot.idx}_{shot.frame_rev}.png"
    ref = next((portraits[n] for n in shot.characters if n in portraits), None)

    async def draw() -> dict[str, Any]:
        cast = "".join(f"{c.name}: {c.static_features}; {c.dynamic_features}\n" for c in s.plan.characters if c.name in shot.characters)
        prompt = prompts.FRAME_PROMPT.format(first_frame=shot.first_frame.replace("<", "").replace(">", ""),
                                             cast=cast, style=s.style or "cinematic, natural light")
        await run.providers.image(prompt, out, reference=ref, aspect=s.aspect, spend=run.spend)
        return {"path": str(out), "shot": shot.idx}

    art = await run.once(key_frame(rev, shot), "frame", draw)
    return Path(art["path"])


def _estimate_micros(run: Run) -> int:
    rev = run.story.revision
    total = 0
    for shot in run.story.plan.shots:
        if key_clip(rev, shot) not in run.cps:
            total += usd_to_micros(run.providers.video_estimate_usd(shot.duration_sec))
    return total


async def _stage_storyboard(run: Run) -> None:
    await _plan_shots(run)
    portraits = await _portraits(run)
    with _span("frames"):
        await _gather_limited(run.story.plan.shots, lambda sh: _frame(run, sh, portraits), story_settings.parallel)
    await run.save(status=StoryStatus.storyboard_ready, stage="", estimate_micros=_estimate_micros(run))


async def _stage_frame(run: Run, shot_idx: int) -> None:
    shots = run.story.plan.shots
    if not 0 <= shot_idx < len(shots):
        raise ValueError(f"no shot {shot_idx}")
    portraits = await _portraits(run)
    with _span("frame"):
        await _frame(run, shots[shot_idx], portraits)
    await run.save(status=StoryStatus.storyboard_ready, stage="", estimate_micros=_estimate_micros(run))


# ── render ──────────────────────────────────────────────────────────────────

async def _stage_render(run: Run) -> None:
    s, rev = run.story, run.story.revision
    portraits = await _portraits(run)

    async def clip(shot: Shot) -> Path:
        frame = await _frame(run, shot, portraits)
        out = run.root / "clips" / f"shot_{shot.idx}_{shot.frame_rev}.mp4"

        async def animate() -> dict[str, Any]:
            await run.providers.video(frame, shot.motion or "subtle natural movement, static camera", out,
                                      duration_sec=shot.duration_sec, aspect=s.aspect, spend=run.spend)
            return {"path": str(out), "shot": shot.idx}

        return Path((await run.once(key_clip(rev, shot), "clip", animate))["path"])

    with _span("clips"):
        clips = await _gather_limited(s.plan.shots, clip, story_settings.parallel)
    out = run.root / "output" / f"story_r{rev}.mp4"

    async def assemble() -> dict[str, Any]:
        await assemble_async(run.providers, list(clips), out, aspect=s.aspect)
        return {"path": str(out)}

    with _span("assemble"):
        final = await run.once(key_final(rev, s.plan.shots), "assemble", assemble)
    await run.save(status=StoryStatus.done, stage="", video_path=final["path"], estimate_micros=0)


# ── entrypoint ──────────────────────────────────────────────────────────────

async def _base_spend(story: StoryVideo) -> SpendContext:
    from ..services.spend_context import default_context

    cap = None
    if story.niche_id is not None:
        from ..repos import niches as niches_repo

        niche = await niches_repo.get(story.niche_id, user_id=story.user_id)
        cap = niche.daily_spend_cap_usd if niche else None
    return await default_context(user_id=story.user_id, niche_id=story.niche_id if cap is not None else None,
                                 job_id=None, cap_usd=cap)


def _failure_message(exc: BaseException) -> str:
    from ..repos.spend import SpendCapExceeded

    if isinstance(exc, SpendCapExceeded):
        return f"Stopped at a spend limit: {exc}"
    return f"{type(exc).__name__}: {str(exc)[:500]}"


async def run_stage(
    story_id: UUID,
    *,
    user_id: str,
    stage: str,
    arg: str | None = None,
    store: StoryStore | None = None,
    providers: StoryProviders | None = None,
    spend: SpendContext | None = None,
    root: Path | None = None,
) -> StoryVideo:
    """Run one background stage. Any failure is recorded on the row
    (status ``failed``, ``stage`` kept so a retry resumes the same stage)."""
    if stage not in STAGES:
        raise ValueError(f"unknown stage {stage!r}")
    store = store or get_store()
    story = await store.get(story_id, user_id=user_id)
    if story is None:
        raise ValueError(f"story {story_id} not found")
    providers = providers or DefaultProviders()
    tracer = otel.get_tracer(__name__)
    with obs_scope(tenant_id=user_id, agent="story_video"), tracer.start_as_current_span(
        f"pipeline.story.run.{stage}",
        attributes={"tenant_id": user_id, "agent": "story_video", "braintrust.span_attributes.type": "task",
                    "marketer.story_id": str(story_id), "marketer.stage": stage},
    ) as span:
        try:
            base = spend or await _base_spend(story)
            meter = StoryMeter(store=store, story_id=story.id, user_id=user_id, base=base,
                               spent_micros=story.spent_micros, ceiling_micros=usd_to_micros(story_settings.max_usd))
            run = Run(story=story, store=store, providers=providers, meter=meter,
                      root=root or story_root(user_id, story.id), cps=await store.checkpoints(story.id))
            if stage == "script":
                await _stage_script(run)
            elif stage == "revise":
                note = arg or run.cps.get(f"note:r{story.revision + 1}", {}).get("note", "")
                await _stage_revise(run, note)
            elif stage == "storyboard":
                await _stage_storyboard(run)
            elif stage == "frame":
                await _stage_frame(run, int(arg or 0))
            else:
                await _stage_render(run)
            span.set_attribute("marketer.story.status", run.story.status.value)
            return run.story
        except Exception as exc:  # noqa: BLE001 - terminal backstop: never strand a busy row
            span.record_exception(exc)
            span.set_status(trace.StatusCode.ERROR, type(exc).__name__)
            log.warning("story stage failed", extra={"story_id": str(story_id), "stage": stage, "error": str(exc)[:300]})
            failed = await store.update(story_id, user_id=user_id, status=StoryStatus.failed,
                                        stage=f"{stage}:{arg}" if arg and stage == "frame" else stage,
                                        error=_failure_message(exc))
            return failed or story
