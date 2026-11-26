"""Run a short-video batch: every variant through its stages.

Stages per variant (``models.STAGES``): script → voice → timing → footage →
edit → subtitles → music → render. Each stage is persisted on the item (state,
start, end, a one-line detail) and wrapped in a ``pipeline.short_video.stage.*``
span, so the UI shows progress and a retry knows where it stands.

Paid stages (script, voice, timing, generated music) go through ``Meter``:
one idempotency key per item attempt and stage, integer micro-dollars, the
batch cap, and SpendContext's playbook/global/credit caps. A replayed key
reuses what is on disk instead of paying again.

Variants are independent: one variant failing (a cap, a provider, no footage)
leaves the others running. The batch ends ``done``, ``partial`` or ``failed``.

All I/O sits behind ``Deps`` so the orchestration is tested with fakes.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from opentelemetry import trace

from ..config import settings
from ..logging import get_logger
from ..observability import scope as obs_scope
from ..repos.spend import SpendCapExceeded
from ..services import otel
from ..services.spend_context import SpendContext
from . import captions, keywords
from . import edit_plan as plan_mod
from . import render as render_mod
from .metering import SKIPPED, BatchCapExceeded, IndeterminateCharge, Meter, charge_key, usd_to_micros
from .models import OPENAI_VOICES, STAGES, ShortVideoBatch, ShortVideoItem, StockClip

log = get_logger(__name__)

TAIL_SEC = 0.4


class NoFootage(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


@dataclass
class Deps:
    """Everything the runner touches. ``default_deps()`` wires the real ones."""

    get_batch: Callable[..., Awaitable[ShortVideoBatch | None]]
    transition_batch: Callable[..., Awaitable[bool]]
    finish_batch: Callable[..., Awaitable[str]]
    update_item: Callable[..., Awaitable[None]]
    item_is_cancelled: Callable[[UUID], Awaitable[bool]]
    charges: Any
    spend_for: Callable[[ShortVideoBatch], Awaitable[SpendContext]]
    brand: Callable[[str], Awaitable[tuple[str, list[str]]]]
    write_script: Callable[..., Awaitable[Any]]
    synthesize: Callable[..., Awaitable[Path]]
    transcribe: Callable[..., Awaitable[list[dict]]]
    search: Callable[..., Awaitable[list[StockClip]]]
    download: Callable[[StockClip, Path], Awaitable[Path]]
    uploads: Callable[[ShortVideoBatch, Path], Awaitable[list[StockClip]]]
    probe_duration: Callable[[Path], float]
    pick_library_music: Callable[..., Awaitable[Path | None]]
    compose_music: Callable[..., Awaitable[Path]]
    archive: Callable[..., Awaitable[UUID | None]]
    render_slices: Callable[..., list[Path]] = render_mod.render_slices
    concat: Callable[..., Path] = render_mod.concat
    mix: Callable[..., Path] = render_mod.mix
    burn: Callable[..., Path] = render_mod.burn
    workdir_root: Path = field(default_factory=lambda: Path(settings.artifacts_dir))


def seed_for(batch_id: UUID, variant: int, attempt: int) -> int:
    return int(hashlib.sha256(f"{batch_id}:{variant}:{attempt}".encode()).hexdigest()[:12], 16)


def pick_footage(candidates: list[StockClip], *, need: int, seed: int) -> list[StockClip]:
    """A variant's own subset: shuffle within each script segment (seeded),
    then take round-robin across segments so every part of the script gets
    footage before any segment gets a second clip."""
    rng = random.Random(seed)
    by_seg: dict[int, list[StockClip]] = {}
    for c in candidates:
        by_seg.setdefault(c.segment, []).append(c)
    for clips in by_seg.values():
        rng.shuffle(clips)
    out: list[StockClip] = []
    segs = sorted(by_seg)
    i = 0
    while len(out) < need and any(by_seg[s] for s in segs):
        s = segs[i % len(segs)]
        if by_seg[s]:
            out.append(by_seg[s].pop(0))
        i += 1
    return out


class _Item:
    """Stage bookkeeping for one variant."""

    def __init__(self, deps: Deps, item: ShortVideoItem) -> None:
        self.deps, self.item = deps, item
        self.stages = {k: v.model_dump(mode="json") for k, v in item.stages.items()}

    async def save(self, **fields: Any) -> None:
        await self.deps.update_item(self.item.id, user_id=self.item.user_id, **fields)

    @asynccontextmanager
    async def stage(self, name: str):
        if await self.deps.item_is_cancelled(self.item.id):
            raise Cancelled("cancelled")
        now = datetime.now(timezone.utc).isoformat()
        self.stages[name] = {"state": "running", "started_at": now, "ended_at": None, "detail": ""}
        progress = int(100 * STAGES.index(name) / len(STAGES))
        await self.save(stage=name, progress=progress, stages=self.stages, status="running")
        tracer = otel.get_tracer(__name__)
        with tracer.start_as_current_span(f"pipeline.short_video.stage.{name}") as span:
            span.set_attribute("marketer.stage", name)
            span.set_attribute("marketer.short_video.variant", self.item.variant)
            try:
                yield self.stages[name]
            except BaseException as exc:
                span.record_exception(exc)
                span.set_status(trace.StatusCode.ERROR, type(exc).__name__)
                self.stages[name].update(state="failed", ended_at=datetime.now(timezone.utc).isoformat())
                await self.save(stages=self.stages)
                raise
        st = self.stages[name]
        if st["state"] == "running":
            st["state"] = "done"
        st["ended_at"] = datetime.now(timezone.utc).isoformat()
        await self.save(stages=self.stages)


async def run_batch(*, user_id: str, batch_id: UUID, deps: Deps | None = None) -> str:
    deps = deps or default_deps()
    batch = await deps.get_batch(batch_id, user_id=user_id)
    if batch is None:
        raise ValueError(f"short video batch {batch_id} not found")
    if batch.status not in ("queued", "running"):
        return batch.status
    if batch.status == "queued" and not await deps.transition_batch(
        batch_id, user_id=user_id, from_status=("queued",), to_status="running"
    ):
        return batch.status  # another worker claimed it

    tracer = otel.get_tracer(__name__)
    with obs_scope(tenant_id=user_id, agent="short_video_pipeline"), tracer.start_as_current_span(
        "pipeline.short_video.run",
        attributes={"tenant_id": user_id, "agent": "short_video_pipeline", "braintrust.span_attributes.type": "task",
                    "marketer.short_video.batch_id": str(batch_id), "marketer.short_video.variants": batch.variants},
    ) as span:
        spend = await deps.spend_for(batch)
        meter = Meter(spend=spend, store=deps.charges, batch_id=batch.id, cap_micros=batch.cap_micros)
        brand_voice, banned = await deps.brand(user_id)
        for item in batch.items:
            if item.status != "queued":
                continue
            await _run_item(deps, batch, item, meter, brand_voice, banned)
        final = await deps.finish_batch(batch_id, user_id=user_id)
        span.set_attribute("marketer.short_video.status", final)
        return final


async def _run_item(
    deps: Deps, batch: ShortVideoBatch, item: ShortVideoItem, meter: Meter, brand_voice: str, banned: list[str],
) -> None:
    it = _Item(deps, item)
    s = batch.settings
    work = deps.workdir_root / batch.user_id / "short-video" / str(batch.id) / f"v{item.variant}"
    work.mkdir(parents=True, exist_ok=True)
    seed = seed_for(batch.id, item.variant, item.attempt)

    def key(stage: str) -> str:
        return charge_key(item.id, item.attempt, stage)

    try:
        # 1. script
        async with it.stage("script") as st:
            draft_file = work / f"draft_a{item.attempt}.json"
            if batch.source == "script":
                text = batch.script
                segs = keywords.split_segments(text)
                hook = segs[0] if segs else text[:120]
                terms = keywords.search_terms(text, topic=batch.topic or batch.title)
                st["detail"] = "your script"
            else:
                async def _write(ctx: SpendContext):
                    return await deps.write_script(
                        topic=batch.topic, variant=item.variant, duration_sec=s.look.duration_sec,
                        language=s.look.language, tone=s.look.tone, brand_voice=brand_voice,
                        banned_words=banned, spend=ctx,
                    )

                draft = await meter.charge(key("script"), item_id=item.id, stage="script", provider="openai",
                                           sku=f"llm:{settings.agent_model}", estimate_micros=50_000, call=_write)
                if draft is SKIPPED:
                    if not draft_file.exists():
                        raise IndeterminateCharge("the script was paid for but its draft is missing; retry the variant")
                    saved = json.loads(draft_file.read_text())
                    hook, text, terms = saved["hook"], saved["script"], [tuple(t) for t in saved["terms"]]
                else:
                    hook, text, terms = draft.hook, draft.script, list(draft.terms)
                    draft_file.write_text(json.dumps({"hook": hook, "script": text, "terms": terms}))
                st["detail"] = hook[:120]
            await it.save(hook=hook, script=text, search_terms=[t for _, t in terms])

        # 2. voice
        voice_path = work / f"voice_a{item.attempt}.wav"
        async with it.stage("voice") as st:
            chars = len(text)
            est = usd_to_micros(chars * 0.000015) if s.look.voice_provider == "openai" else usd_to_micros(chars * 0.0003)

            async def _voice(ctx: SpendContext):
                return await deps.synthesize(text, voice_path, look=s.look, spend=ctx)

            res = await meter.charge(key("voice"), item_id=item.id, stage="voice", provider=s.look.voice_provider,
                                     sku="tts", estimate_micros=est, call=_voice)
            if res is SKIPPED and not voice_path.exists():
                raise IndeterminateCharge("the voiceover was paid for but its file is missing; retry the variant")
            vo_dur = deps.probe_duration(voice_path)
            st["detail"] = f"{vo_dur:.1f}s"

        # 3. timing (word timestamps from our own audio)
        words_file = work / f"words_a{item.attempt}.json"
        async with it.stage("timing") as st:
            async def _time(ctx: SpendContext):
                return await deps.transcribe(voice_path, spend=ctx)

            words = await meter.charge(key("timing"), item_id=item.id, stage="timing", provider="openai",
                                       sku="whisper-1", estimate_micros=usd_to_micros(vo_dur / 60 * 0.006) + 1,
                                       call=_time)
            if words is SKIPPED:
                if not words_file.exists():
                    raise IndeterminateCharge("the timing was paid for but its file is missing; retry the variant")
                words = json.loads(words_file.read_text())
            else:
                words_file.write_text(json.dumps(words))
            st["detail"] = f"{len(words)} words"

        # 4. footage
        async with it.stage("footage") as st:
            need = max(3, math.ceil((vo_dur + TAIL_SEC) / s.footage.clip_duration_sec) + 1)
            pool: list[StockClip] = []
            stock_sources = [x for x in s.footage.sources if x in ("pexels", "pixabay")]
            if stock_sources and terms:
                pool = await deps.search(terms, sources=stock_sources, aspect=s.look.aspect,
                                         min_duration=min(3.0, s.footage.clip_duration_sec))
            chosen = pick_footage(pool, need=need, seed=seed)
            uploads = await deps.uploads(batch, work) if "uploads" in s.footage.sources else []
            local: list[StockClip] = list(uploads)
            for c in chosen:
                try:
                    p = await deps.download(c, Path(settings.assets_dir) / "stock")
                except Exception as e:  # noqa: BLE001 - one bad clip never sinks the variant
                    log.warning("short_video.download_failed", extra={"provider": c.provider, "error": type(e).__name__})
                    continue
                local.append(c.model_copy(update={"local_path": str(p)}))
            if not local:
                raise NoFootage("no footage found for this script; try other words, or add uploads")
            await it.save(clips=[c.model_dump(mode="json") for c in local])
            st["detail"] = f"{len(local)} clips"

        # 5. edit
        silent = work / f"silent_a{item.attempt}.mp4"
        duration = round(vo_dur + TAIL_SEC, 3)
        async with it.stage("edit") as st:
            sources = [plan_mod.Source(c.local_path, c.duration_sec or plan_mod.IMAGE_HOLD_SEC, c.kind, c.segment) for c in local]
            slices = plan_mod.plan(sources, audio_duration=duration, clip_duration=s.footage.clip_duration_sec,
                                   speed=s.footage.speed, order=s.footage.order,
                                   transition=s.footage.transition, seed=seed)
            parts = deps.render_slices(slices, work / "slices", aspect=s.look.aspect, fit=s.footage.fit)
            deps.concat(parts, silent, duration=duration)
            st["detail"] = f"{len(slices)} cuts"

        # 6. subtitles
        subs: dict[str, Path] = {}
        async with it.stage("subtitles") as st:
            if s.subtitles.enabled:
                aligned = captions.align_to_script(words, text)
                cues = captions.build_cues(aligned, max_chars=s.subtitles.max_chars)
                w, h = render_mod.dims(s.look.aspect)
                subs = captions.write_all(cues, s.subtitles, work / "subs", width=w, height=h)
                st["detail"] = f"{len(cues)} lines"
            else:
                st["state"] = "skipped"

        # 7. music
        music_path: Path | None = None
        async with it.stage("music") as st:
            mood = s.music.mood or batch.topic or batch.title
            if s.music.mode == "generated":
                gen_path = work / f"music_a{item.attempt}.mp3"

                async def _compose(ctx: SpendContext):
                    return await deps.compose_music(mood=mood, duration_sec=int(math.ceil(duration)),
                                                    out_path=gen_path, spend=ctx)

                try:
                    res = await meter.charge(key("music"), item_id=item.id, stage="music", provider="elevenlabs",
                                             sku="music", estimate_micros=usd_to_micros(max(10, duration) / 60 * 0.5),
                                             call=_compose)
                    music_path = gen_path if (res is not SKIPPED or gen_path.exists()) else None
                except (SpendCapExceeded, BatchCapExceeded, IndeterminateCharge):
                    raise
                except Exception as e:  # noqa: BLE001 - generated music falls back to the library
                    log.warning("short_video.music_gen_failed", extra={"error": type(e).__name__})
            if s.music.mode in ("library", "generated") and music_path is None:
                music_path = await deps.pick_library_music(query=mood, target_duration_sec=int(duration))
            if s.music.mode == "none":
                st["state"] = "skipped"
            else:
                st["detail"] = "music" if music_path else "no track found"

        # 8. render
        async with it.stage("render") as st:
            mixed = work / f"mixed_a{item.attempt}.mp4"
            deps.mix(silent, voice_path, music_path, mixed, duration=duration,
                     volume_db=s.music.volume_db, duck=s.music.duck)
            final = mixed
            if subs and s.subtitles.delivery in ("burned", "both"):
                final = work / f"final_a{item.attempt}.mp4"
                deps.burn(mixed, subs["ass"], final)
            asset_id = await deps.archive(final, batch=batch, item=item, title=hook[:200] or batch.title)
            sidecar = subs and s.subtitles.delivery in ("sidecar", "both")
            await it.save(
                video_path=str(final), output_asset_id=asset_id, duration_sec=duration,
                srt_path=str(subs["srt"]) if subs else None, vtt_path=str(subs["vtt"]) if subs else None,
            )
            st["detail"] = "with subtitle files" if sidecar else ""
        await it.save(status="done", stage="done", progress=100)
    except Cancelled:
        await it.save(status="cancelled", error=None)
    except (BatchCapExceeded, SpendCapExceeded, IndeterminateCharge, NoFootage) as e:
        await it.save(status="failed", error=str(e)[:500])
    except Exception as e:  # noqa: BLE001 - terminal state, never a stuck item
        log.warning("short_video.item_failed", extra={"item_id": str(item.id), "error": type(e).__name__}, exc_info=True)
        await it.save(status="failed", error=f"{type(e).__name__}: {str(e)[:300]}")


# ------------------------------------------------------------- real wiring

def default_deps() -> Deps:
    from ..repos import short_videos as repo
    from ..services import ffmpeg as ff
    from . import stock

    async def spend_for(batch: ShortVideoBatch) -> SpendContext:
        from ..repos import niches as niches_repo
        from ..services.spend_context import default_context

        cap = None
        if batch.niche_id is not None:
            niche = await niches_repo.get(batch.niche_id, user_id=batch.user_id)
            cap = niche.daily_spend_cap_usd if niche else None
        return await default_context(user_id=batch.user_id, niche_id=batch.niche_id if cap else None,
                                     job_id=None, cap_usd=cap)

    async def brand(user_id: str) -> tuple[str, list[str]]:
        try:
            from ..repos import brand_kit as brand_kit_repo

            b = await brand_kit_repo.get(user_id)
            return (b.tone_of_voice or "", list(b.banned_words or [])) if b else ("", [])
        except Exception:  # noqa: BLE001 - brand kit seasons, never blocks
            return "", []

    async def write_script(**kw):
        from . import script

        return await script.write(**kw)

    async def synthesize(text: str, out: Path, *, look, spend):
        from ..services import elevenlabs_tts, openai_tts

        if look.voice_provider == "elevenlabs":
            return await elevenlabs_tts.synthesize(text, out, voice_id=look.voice, spend=spend)
        voice = look.voice if look.voice in OPENAI_VOICES else openai_tts.DEFAULT_VOICE
        return await openai_tts.synthesize(text, out, voice=voice, style_directions=look.tone or None, spend=spend)

    async def transcribe(path: Path, *, spend):
        from ..services import openai_whisper

        return await openai_whisper.transcribe_word_level(path, spend=spend)

    async def search(terms, *, sources, aspect, min_duration):
        return await stock.search(terms, sources=sources, aspect=aspect, min_duration=min_duration,
                                  cache=repo.PgSearchCache())

    async def uploads(batch: ShortVideoBatch, work: Path) -> list[StockClip]:
        from ..services import object_storage

        rows = await repo.get_uploads_bulk(list(batch.settings.footage.upload_ids), user_id=batch.user_id)
        out = []
        for u in rows:
            if u.status != "ready":
                continue
            local = work / "uploads" / Path(u.object_key).name
            if not local.exists():
                await object_storage.download_file(u.object_key, local)
            out.append(StockClip(provider="upload", provider_id=str(u.id), kind=u.kind,
                                 width=u.width or 0, height=u.height or 0,
                                 duration_sec=float(u.duration_sec or 0), local_path=str(local),
                                 creator="", licence="Yours"))
        return out

    async def pick_library_music(*, query: str, target_duration_sec: int):
        from ..services import music

        try:
            return await music.pick_track(
                query=query, target_duration_sec=target_duration_sec,
                library_dir=Path(settings.assets_dir) / "music",
                cache_dir=Path(settings.assets_dir) / "music" / "pixabay",
            )
        except Exception:  # noqa: BLE001 - music never fails a video
            return None

    async def compose_music(**kw):
        from ..services import music_gen

        return await music_gen.compose(**kw)

    async def archive(final: Path, *, batch: ShortVideoBatch, item: ShortVideoItem, title: str):
        from ..repos import media as media_repo
        from ..services import object_storage

        try:
            if object_storage.enabled():
                key = f"users/{batch.user_id}/short-video/{batch.id}/{item.id}.mp4"
                await object_storage.upload_file(final, key)
                storage = "wasabi"
            else:
                key, storage = str(final), "volume"
            asset = await media_repo.record_asset(
                user_id=batch.user_id, kind="final", storage=storage, object_key=key,
                niche_id=batch.niche_id, size_bytes=final.stat().st_size,
                duration_sec=ff.probe_duration(final), title=title,
            )
            return asset.id
        except Exception:  # noqa: BLE001 - the file on the volume still plays
            log.warning("short_video.archive_failed", exc_info=True)
            return None

    return Deps(
        get_batch=repo.get_batch, transition_batch=repo.transition_batch, finish_batch=repo.finish_batch,
        update_item=repo.update_item, item_is_cancelled=repo.item_is_cancelled, charges=repo.PgChargeStore(),
        spend_for=spend_for, brand=brand, write_script=write_script, synthesize=synthesize, transcribe=transcribe,
        search=search, download=lambda c, root: stock.download(c, root), uploads=uploads,
        probe_duration=ff.probe_duration, pick_library_music=pick_library_music, compose_music=compose_music,
        archive=archive,
    )
