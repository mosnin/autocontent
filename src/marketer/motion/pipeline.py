"""Motion project orchestration: narration -> beats -> visuals -> mp4.

The only module in `motion/` that talks to providers, the volume, the
database, or ffmpeg. Everything it composes with (`beats`, `overlays`,
`broll`, `styles`) is pure, so the interesting logic stays testable and
this file stays a straight line:

    1. audio      narration WAV — synthesized, or reused from a job
    2. beats      word timings (whisper) -> bounded beat model
    3. plan       style + sourcing strategy -> one shot per beat
    4. keywords   ONE batched LLM call for every stock beat
    5. render     shots -> per-beat clips, fan-out bounded
    6. composite  concat -> burn kinetic type -> mux the narration

Invariant: the narration is the authoritative audio
---------------------------------------------------
B-roll replaces the PICTURE for a beat and nothing else. Every per-beat
clip is rendered with `-an` (no audio stream at all), the concat is
silent, and the narration WAV is muxed on exactly once at the end with
`music_path=None` — so there is no mixer, no sidechain, and no path by
which a stock clip's own soundtrack could displace, duck, or shorten a
word of the voiceover the user paid for. This is the notebook's rule
("b-roll replaces picture while the original audio continues") enforced
structurally rather than by convention.

Spend
-----
Everything metered flows through one `SpendContext`: TTS, transcription,
the batched keyword call, and every generated keyframe. Per-beat work
fans out under `settings.scene_fanout_limit`, which is a spend-rate
control as much as a rate-limit one — N unbounded image calls can cross
a daily cap between the pre-flight check and the first ledger write.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..services import ffmpeg as ffmpeg_svc
from ..services import openai_images, openai_tts, openai_whisper, subtitle
from ..services.spend_context import SpendContext
from ..storage.volume import job_root
from . import stock as stock_svc
from .beats import Beat, beats_from_narration, segment_words
from .broll import (
    SOURCE_GENERATED,
    SOURCE_STOCK,
    BrollShot,
    attach_keywords,
    demote_to_generated,
    plan_broll,
    stock_shots,
    visual_filter,
)
from .overlays import Canvas, OverlaySpec, build_overlays, build_word_overlays, filter_chain
from .styles import MotionStyle, get_style

log = get_logger(__name__)

STATUS_QUEUED = "queued"
STATUS_VOICING = "voicing"
STATUS_TRANSCRIBING = "transcribing"
STATUS_PLANNING = "planning"
STATUS_RENDERING = "rendering"
STATUS_COMPOSITING = "compositing"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

FPS = 30
# Keyframes are one-per-beat and heavily overlaid with type; `medium` is
# the tier where the collage reads without paying for detail the kinetic
# layer covers up anyway.
KEYFRAME_QUALITY = "medium"
IMAGE_SIZE_BY_ASPECT: dict[str, str] = {
    "9:16": "1024x1536",
    "16:9": "1536x1024",
    "1:1": "1024x1024",
}


class MotionRenderError(RuntimeError):
    """A motion project that cannot produce a video."""


@dataclass
class MotionPlan:
    """Everything the run produced, in the shape the API serves."""

    beats: list[Beat]
    shots: list[BrollShot]
    overlays: list[OverlaySpec]

    def as_dict(self) -> dict:
        by_beat = {s.beat_index: s for s in self.shots}
        return {
            "beats": [
                {
                    **beat.as_dict(),
                    "broll": by_beat[beat.index].as_dict() if beat.index in by_beat else None,
                }
                for beat in self.beats
            ],
            "overlays": [o.as_dict() for o in self.overlays],
        }


# ---------------------------------------------------------------------------
# Volume layout
# ---------------------------------------------------------------------------


def project_root(user_id: str, project_id: UUID | str) -> Path:
    """Volume directory for one motion project.

    Goes through `storage.volume.job_root` so motion artifacts land in
    the same user-partitioned tree as every other artifact and are swept
    by the same retention job.
    """
    return job_root(f"{user_id}/motion/{project_id}")


def _ensure_layout(root: Path) -> Path:
    for sub in ("audio", "keyframes", "footage", "clips", "captions", "output"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def final_video_path(user_id: str, project_id: UUID | str) -> Path:
    return project_root(user_id, project_id) / "output" / "final.mp4"


# ---------------------------------------------------------------------------
# ffmpeg
# ---------------------------------------------------------------------------
#
# These three primitives belong in `services/ffmpeg.py` next to
# `concat_clips`/`mix_audio`; that file is owned by the lead, so they
# live here for now and delegate to its single subprocess choke point
# (`_ffmpeg` -> `_run`) rather than shelling out independently. Tests
# monkeypatch `services.ffmpeg._run` and assert the argv, exactly as the
# rest of the suite does. Move them verbatim when the file is free.


def _ffmpeg(args: list[str]) -> None:
    ffmpeg_svc._ffmpeg(args)


def render_still_clip(
    image_path: Path, out_path: Path, chain: str, *, duration: float, fps: int = FPS
) -> Path:
    """A still + a filter chain -> a silent clip of exactly `duration`.

    `-an` is not an optimization: the picture track must not be able to
    carry audio into the concat (see the module's audio invariant).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg([
        "-loop", "1",
        "-t", f"{duration:.3f}",
        "-i", str(image_path),
        "-vf", chain,
        "-an",
        "-r", str(fps),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path


def render_footage_clip(
    source_path: Path, out_path: Path, chain: str, *, duration: float, fps: int = FPS
) -> Path:
    """Downloaded stock footage -> a silent clip of exactly `duration`."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg([
        "-i", str(source_path),
        "-vf", chain,
        "-t", f"{duration:.3f}",
        "-an",
        "-r", str(fps),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path


def burn_filter_chain(video_path: Path, out_path: Path, chain: str) -> Path:
    """Burn a `-vf` chain (kinetic drawtext, optional ASS) into a video.

    Audio is stream-copied, never re-encoded or re-timed.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg([
        "-i", str(video_path),
        "-vf", chain,
        "-c:a", "copy",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path


# ---------------------------------------------------------------------------
# Stage 1 — narration audio
# ---------------------------------------------------------------------------


async def resolve_narration_audio(
    *,
    narration: str,
    out_path: Path,
    job_voiceover: Path | None = None,
    spend: SpendContext | None = None,
) -> Path:
    """The narration WAV: reused from a job, resumed, or synthesized.

    Reuse is the whole point of the `job_id` form of the API — a job's
    voiceover has already been paid for, and re-synthesizing it would
    both cost money twice and drift the timing away from the video the
    user is extending.
    """
    if job_voiceover is not None and job_voiceover.exists():
        log.info("motion.audio.reused_job_voiceover", extra={"path": str(job_voiceover)})
        return job_voiceover
    if out_path.exists() and out_path.stat().st_size > 0:
        log.info("motion.audio.resumed", extra={"path": str(out_path)})
        return out_path
    if not narration.strip():
        raise MotionRenderError("no narration to synthesize and no job voiceover to reuse")
    return await openai_tts.synthesize(narration, out_path, spend=spend)


async def resolve_beats(
    *,
    narration: str,
    voiceover_path: Path,
    spend: SpendContext | None = None,
) -> tuple[list[Beat], list[dict]]:
    """Word timings -> beats, with a text-only fallback.

    A degraded ASS provider must not fail a render whose voiceover is
    already bought: we fall back to `beats_from_narration`, which is less
    accurate but still bounded and monotonic.
    """
    words: list[dict] = []
    try:
        words = await openai_whisper.transcribe_word_level(voiceover_path, spend=spend)
    except Exception as exc:  # noqa: BLE001 — classified below
        from ..repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise
        log.warning("motion.beats.transcription_failed", extra={"error": str(exc)[:200]})

    beats = segment_words(words) if words else []
    if not beats:
        duration = ffmpeg_svc.probe_duration(voiceover_path)
        beats = beats_from_narration(narration, duration)
    if not beats:
        raise MotionRenderError("narration produced no beats")
    return beats, words


# ---------------------------------------------------------------------------
# Stage 3/4 — the shot plan and its keywords
# ---------------------------------------------------------------------------


async def plan_shots(
    beats: list[Beat],
    style: MotionStyle,
    *,
    source: str,
    aspect: str,
    spend: SpendContext | None = None,
) -> list[BrollShot]:
    """Plan every beat's visual and resolve the stock beats' keywords.

    When Pexels is unconfigured the whole stock half is demoted to
    generated *before* the keyword call is made — buying keywords for
    footage we cannot fetch is pure waste, and the project still renders.
    """
    shots = plan_broll(beats, style, source=source, aspect=aspect)
    pending = stock_shots(shots)
    if not pending:
        return shots

    if not stock_svc.enabled():
        log.info(
            "motion.stock.disabled",
            extra={"demoted": len(pending), "setting": "MARKETER_PEXELS_API_KEY"},
        )
        for shot in pending:
            demote_to_generated(shot, reason="no stock key")
        return shots

    by_index = {b.index: b for b in beats}
    keyword_beats = [by_index[s.beat_index] for s in pending if s.beat_index in by_index]
    keywords = await stock_svc.keywords_for_beats(keyword_beats, spend=spend)
    return attach_keywords(shots, keywords, style)


# ---------------------------------------------------------------------------
# Stage 5 — per-beat clips
# ---------------------------------------------------------------------------


async def _supply_stock(
    shot: BrollShot, root: Path, *, aspect: str, spend: SpendContext | None
) -> Path | None:
    """Stock strategy: keyword -> footage file, or None on any miss."""
    dest = root / "footage" / f"beat_{shot.beat_index:02d}.mp4"
    clip = await stock_svc.fetch_clip(
        shot.stock_query or shot.keyword,
        dest,
        orientation=stock_svc.orientation_for(aspect),
        min_duration=shot.duration,
        spend=spend,
    )
    if clip is None:
        return None
    shot.stock_url = clip.url
    return dest


async def _supply_generated(
    shot: BrollShot, root: Path, *, aspect: str, spend: SpendContext | None
) -> Path:
    """Generated strategy: art-directed prompt -> one keyframe PNG."""
    dest = root / "keyframes" / f"beat_{shot.beat_index:02d}.png"
    if dest.exists() and dest.stat().st_size > 0:
        return dest  # resume: never re-buy an image already on the volume
    await openai_images.generate_keyframe(
        shot.prompt,
        dest,
        quality=KEYFRAME_QUALITY,
        size=IMAGE_SIZE_BY_ASPECT.get(aspect, IMAGE_SIZE_BY_ASPECT["9:16"]),
        spend=spend,
    )
    return dest


async def render_shot(
    shot: BrollShot,
    root: Path,
    canvas: Canvas,
    *,
    aspect: str,
    spend: SpendContext | None = None,
) -> None:
    """Turn one shot into one clip, recording the outcome on the shot.

    Both strategies land here through the same three steps — supply an
    asset, pick the filter chain (`broll.visual_filter`), render a silent
    clip of the beat's exact length — which is what lets the rest of the
    pipeline stay strategy-blind.
    """
    clip_path = root / "clips" / f"beat_{shot.beat_index:02d}.mp4"
    shot.status = "rendering"

    source_path: Path | None = None
    if shot.sourcing == SOURCE_STOCK:
        source_path = await _supply_stock(shot, root, aspect=aspect, spend=spend)
        if source_path is None:
            # A stock miss is not a failure: the beat was planned with a
            # generated prompt precisely so it can fall back here.
            demote_to_generated(shot, reason="no footage")

    if source_path is None:
        shot.keyframe_path = str(await _supply_generated(shot, root, aspect=aspect, spend=spend))
        source_path = Path(shot.keyframe_path)

    chain = visual_filter(shot, canvas, fps=FPS)
    if shot.sourcing == SOURCE_STOCK:
        await asyncio.to_thread(
            render_footage_clip, source_path, clip_path, chain, duration=shot.duration, fps=FPS
        )
    else:
        await asyncio.to_thread(
            render_still_clip, source_path, clip_path, chain, duration=shot.duration, fps=FPS
        )
    shot.clip_path = str(clip_path)
    shot.status = "done"


async def render_shots(
    shots: list[BrollShot],
    root: Path,
    canvas: Canvas,
    *,
    aspect: str,
    spend: SpendContext | None = None,
) -> list[BrollShot]:
    """Fan out over shots, bounded by `settings.scene_fanout_limit`.

    A failed shot fails only itself — but unlike an ad slot, a hole in
    the picture track is fatal to the timeline, so the caller checks that
    at least the whole span is covered before compositing.
    """
    gate = asyncio.Semaphore(max(int(settings.scene_fanout_limit), 1))

    async def run(shot: BrollShot) -> None:
        async with gate:
            try:
                await render_shot(shot, root, canvas, aspect=aspect, spend=spend)
            except Exception as exc:  # noqa: BLE001 — recorded, then reported
                from ..repos.spend import SpendCapExceeded

                shot.status = "failed"
                shot.error = str(exc)[:500]
                if isinstance(exc, SpendCapExceeded):
                    raise
                log.warning(
                    "motion.shot.failed",
                    extra={"beat": shot.beat_index, "error": shot.error},
                )

    await asyncio.gather(*(run(shot) for shot in shots))
    return shots


# ---------------------------------------------------------------------------
# Stage 6 — composite
# ---------------------------------------------------------------------------


def build_overlay_specs(
    beats: list[Beat], words: list[dict], style: MotionStyle, canvas: Canvas
) -> list[OverlaySpec]:
    if style.overlay_mode == "word" and words:
        return build_word_overlays(beats, words, style, canvas)
    return build_overlays(beats, style, canvas)


def composite(
    *,
    shots: list[BrollShot],
    overlays: list[OverlaySpec],
    canvas: Canvas,
    words: list[dict],
    style: MotionStyle,
    voiceover_path: Path,
    root: Path,
    aspect: str,
) -> Path:
    """Clips + type + narration -> the deliverable mp4.

    Order matters: concat while everything is silent, burn the type into
    the picture, and only then attach audio — so the drawtext pass can
    never re-time or re-encode the narration.
    """
    clips = [Path(s.clip_path) for s in shots if s.clip_path]
    if not clips:
        raise MotionRenderError("no beat produced a clip")

    silent = root / "output" / "silent.mp4"
    ffmpeg_svc.concat_clips(clips, silent, aspect=aspect)

    chain_parts = [part for part in (filter_chain(overlays, canvas),) if part]
    if style.word_captions and words:
        # The style asks for the house word-level captions underneath the
        # kinetic layer; reuse services/subtitle rather than reimplement
        # burned captions here.
        ass_path = root / "captions" / "words.ass"
        subtitle.words_to_ass(words, ass_path)
        chain_parts.append(f"ass={ass_path}")

    typed = silent
    if chain_parts:
        typed = root / "output" / "typed.mp4"
        burn_filter_chain(silent, typed, ",".join(chain_parts))

    final = root / "output" / "final.mp4"
    # music_path=None: the narration is the ONLY audio stream, so there
    # is no mixer that could ever duck it. See the module's invariant.
    ffmpeg_svc.mix_audio(typed, voiceover_path, None, final)
    return final


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def _spend_for_project(project: dict) -> SpendContext:
    from ..repos import niches as niches_repo
    from ..services.spend_context import default_context

    niche_id = project.get("niche_id")
    cap = None
    if niche_id is not None:
        niche = await niches_repo.get(niche_id, user_id=project["user_id"])
        cap = getattr(niche, "daily_spend_cap_usd", None) if niche else None
    return await default_context(
        user_id=project["user_id"],
        niche_id=niche_id,
        job_id=project.get("job_id"),
        cap_usd=cap,
    )


async def _job_voiceover(project: dict) -> tuple[Path | None, str]:
    """The referenced job's voiceover path and narration, when reusable."""
    job_id = project.get("job_id")
    if not job_id:
        return None, ""
    from ..repos import jobs as jobs_repo

    job = await jobs_repo.get(job_id, user_id=project["user_id"])
    if job is None:
        return None, ""
    path = job_root(str(job_id)) / "audio" / "voiceover.wav"
    script = getattr(job, "script", None)
    narration = " ".join(s.narration for s in getattr(script, "scenes", []) or [])
    return (path if path.exists() else None), narration


async def run_motion_project(*, user_id: str, project_id: UUID) -> dict:
    """Drive one motion project end to end. The background entry point.

    Every exit path settles the row: `done` with a video, or `failed`
    with a reason, so a project is never left invisible and un-retryable.
    """
    from ..repos import motion_projects as projects_repo

    project = await projects_repo.get(project_id, user_id=user_id)
    if project is None:
        raise MotionRenderError(f"motion project {project_id} not found for {user_id}")

    root = _ensure_layout(project_root(user_id, project_id))
    aspect = project.get("aspect") or "9:16"
    canvas = Canvas.from_aspect(aspect)
    style = get_style(project.get("style_key"))
    spend = await _spend_for_project(project)

    try:
        await projects_repo.set_status(project_id, user_id=user_id, status=STATUS_VOICING)
        job_vo, job_narration = await _job_voiceover(project)
        narration = (project.get("narration") or "").strip() or job_narration
        vo_path = await resolve_narration_audio(
            narration=narration,
            out_path=root / "audio" / "voiceover.wav",
            job_voiceover=job_vo,
            spend=spend,
        )

        await projects_repo.set_status(project_id, user_id=user_id, status=STATUS_TRANSCRIBING)
        beats, words = await resolve_beats(
            narration=narration, voiceover_path=vo_path, spend=spend
        )

        await projects_repo.set_status(project_id, user_id=user_id, status=STATUS_PLANNING)
        shots = await plan_shots(
            beats,
            style,
            source=project.get("source") or SOURCE_GENERATED,
            aspect=aspect,
            spend=spend,
        )
        overlays = build_overlay_specs(beats, words, style, canvas)
        plan = MotionPlan(beats=beats, shots=shots, overlays=overlays)
        # Snapshot before spending on pixels: a container death mid-render
        # then leaves an inspectable, retryable plan behind.
        await projects_repo.save_plan(project_id, user_id=user_id, **plan.as_dict())

        await projects_repo.set_status(project_id, user_id=user_id, status=STATUS_RENDERING)
        await render_shots(shots, root, canvas, aspect=aspect, spend=spend)
        await projects_repo.save_plan(project_id, user_id=user_id, **plan.as_dict())

        await projects_repo.set_status(project_id, user_id=user_id, status=STATUS_COMPOSITING)
        final = await asyncio.to_thread(
            composite,
            shots=shots,
            overlays=overlays,
            canvas=canvas,
            words=words,
            style=style,
            voiceover_path=vo_path,
            root=root,
            aspect=aspect,
        )
    except Exception as exc:  # noqa: BLE001 — the row must always settle
        log.warning(
            "motion.project.failed",
            extra={"project_id": str(project_id), "error": str(exc)[:500]},
        )
        await projects_repo.fail(project_id, user_id=user_id, error=str(exc))
        return {"status": STATUS_FAILED, "error": str(exc)[:500]}

    row = await projects_repo.complete(project_id, user_id=user_id, video_path=str(final))
    return {"status": row.get("status", STATUS_DONE), "video_path": str(final)}


def plan_json(plan: MotionPlan) -> str:
    """Debug helper: the plan exactly as the detail endpoint serves it."""
    return json.dumps(plan.as_dict(), indent=2, default=str)


__all__ = [
    "MotionPlan",
    "MotionRenderError",
    "build_overlay_specs",
    "composite",
    "final_video_path",
    "plan_shots",
    "project_root",
    "render_shot",
    "render_shots",
    "resolve_beats",
    "resolve_narration_audio",
    "run_motion_project",
]
