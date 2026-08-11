"""B-roll planning and the render/composite orchestration.

No ffmpeg process, no network, no DB: `services.ffmpeg._run` is stubbed
so every argv the pipeline would execute is asserted instead of run, and
the providers/repos are fakes.

Two properties get the most attention, because they are the ones the
source notebook got wrong or left implicit:

* coverage selection is **deterministic**, not `random.sample`;
* the narration is the **only** audio, so b-roll can never duck it.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from marketer.config import settings
from marketer.motion import broll, pipeline
from marketer.motion import stock as stock_svc
from marketer.motion.beats import Beat
from marketer.motion.broll import (
    SOURCE_GENERATED,
    SOURCE_STOCK,
    BrollShot,
    attach_keywords,
    demote_to_generated,
    plan_broll,
    select_broll_beats,
    visual_filter,
    visual_score,
)
from marketer.motion.overlays import Canvas
from marketer.motion.styles import get_style

CANVAS = Canvas(1080, 1920)
STYLE = get_style("modern-flat")
USER = "user_motion"
PROJECT_ID = UUID("00000000-0000-0000-0000-0000000000aa")

VISUAL = "a barista pouring espresso into a ceramic cup"
ABSTRACT = "and so it is really just about that kind of thing you know"


def beats(*texts) -> list[Beat]:
    return [
        Beat(index=i, start=i * 4.0, end=i * 4.0 + 4.0, text=t)
        for i, t in enumerate(texts)
    ]


# ------------------------------------------------- deterministic coverage


def test_visual_score_prefers_depictable_narration():
    assert visual_score(VISUAL) > visual_score(ABSTRACT)
    assert visual_score("") == 0.0


def test_coverage_picks_the_most_visual_beats_not_random_ones():
    """The notebook used `random.sample`; a cut plan must be reproducible
    and explainable, so we rank and take the top slice instead."""
    plan = beats(ABSTRACT, VISUAL, ABSTRACT, VISUAL, ABSTRACT, VISUAL)
    chosen = select_broll_beats(plan, coverage_ratio=0.5)
    assert chosen == [1, 3, 5]


def test_coverage_is_stable_across_runs():
    plan = beats(*[f"beat {i} about {'espresso machines' if i % 2 else 'things'}" for i in range(9)])
    runs = {tuple(select_broll_beats(plan, coverage_ratio=0.4)) for _ in range(25)}
    assert len(runs) == 1


def test_covered_beats_are_never_adjacent():
    plan = beats(*[VISUAL] * 8)
    chosen = select_broll_beats(plan, coverage_ratio=1.0)
    assert all(b - a > 1 for a, b in zip(chosen, chosen[1:]))


def test_coverage_edges():
    plan = beats(VISUAL, ABSTRACT, VISUAL)
    assert select_broll_beats(plan, coverage_ratio=0.0) == []
    assert select_broll_beats([], coverage_ratio=0.5) == []
    # A tiny ratio still yields one beat: "some b-roll" beats "none".
    assert len(select_broll_beats(plan, coverage_ratio=0.01)) == 1


# --------------------------------------------------------------- planning


def test_generated_covers_every_beat_and_buys_no_keywords():
    shots = plan_broll(beats(VISUAL, ABSTRACT, VISUAL), STYLE, source=SOURCE_GENERATED)
    assert [s.sourcing for s in shots] == [SOURCE_GENERATED] * 3
    assert broll.stock_shots(shots) == []
    assert all(s.prompt for s in shots)


@pytest.mark.parametrize("source", [SOURCE_STOCK, "mixed"])
def test_stock_strategies_cover_only_a_fraction_of_the_beats(source):
    plan = beats(*[VISUAL] * 6)
    shots = plan_broll(plan, STYLE, source=source)
    stock_count = len(broll.stock_shots(shots))
    assert 0 < stock_count < len(plan)  # intermittent, by construction
    # Every beat still has a shot: a beat with no picture is a hole.
    assert [s.beat_index for s in shots] == list(range(6))


def test_stock_claims_more_beats_than_mixed():
    plan = beats(*[VISUAL] * 8)
    assert len(broll.stock_shots(plan_broll(plan, STYLE, source=SOURCE_STOCK))) > len(
        broll.stock_shots(plan_broll(plan, STYLE, source="mixed"))
    )


def test_an_unknown_source_is_refused():
    with pytest.raises(ValueError):
        plan_broll(beats(VISUAL), STYLE, source="vibes")


def test_every_generated_shot_carries_its_prompt_even_under_stock():
    """The prompt is the fallback: a stock miss must never be a black hole."""
    shots = plan_broll(beats(*[VISUAL] * 4), STYLE, source=SOURCE_STOCK)
    assert all(s.prompt for s in shots)


def test_attach_keywords_applies_the_style_bias_and_demotes_the_blanks():
    shots = plan_broll(beats(*[VISUAL] * 4), STYLE, source=SOURCE_STOCK)
    targets = [s.beat_index for s in broll.stock_shots(shots)]
    attach_keywords(shots, {targets[0]: "pouring espresso"}, STYLE)

    supplied = next(s for s in shots if s.beat_index == targets[0])
    assert supplied.sourcing == SOURCE_STOCK
    assert supplied.keyword == "pouring espresso"
    assert supplied.stock_query == "pouring espresso " + STYLE.stock_bias
    # Any other stock beat had no keyword, so it fell back to generated.
    for other in targets[1:]:
        fell_back = next(s for s in shots if s.beat_index == other)
        assert fell_back.sourcing == SOURCE_GENERATED
        assert any(t.startswith("stock_fallback:") for t in fell_back.tags)


def test_a_demoted_shot_records_why_for_the_detail_view():
    shot = BrollShot(beat_index=0, start=0.0, end=3.0, sourcing=SOURCE_STOCK, keyword="rain")
    demote_to_generated(shot, reason="no footage")
    row = shot.as_dict()
    assert row["sourcing"] == SOURCE_GENERATED
    assert row["keyword"] == "rain"  # what was tried is still visible
    assert "stock_fallback:no footage" in row["tags"]


def test_visual_filter_dispatches_on_sourcing():
    still = BrollShot(beat_index=0, start=0.0, end=3.0, sourcing=SOURCE_GENERATED)
    footage = BrollShot(beat_index=1, start=3.0, end=6.0, sourcing=SOURCE_STOCK)
    assert "zoompan" in visual_filter(still, CANVAS)
    assert "loop=" in visual_filter(footage, CANVAS)
    for shot in (still, footage):
        assert "1080" in visual_filter(shot, CANVAS)


def test_the_ken_burns_move_rotates_so_neighbours_differ():
    shots = plan_broll(beats(*[VISUAL] * 5), STYLE, source=SOURCE_GENERATED)
    moves = [s.camera_move for s in shots]
    assert all(a != b for a, b in zip(moves, moves[1:]))


# ---------------------------------------------------------- plan_shots I/O


@pytest.mark.asyncio
async def test_no_stock_key_demotes_before_the_keyword_call_is_bought(monkeypatch):
    """Buying keywords for footage we cannot fetch is pure waste."""
    called: list = []

    async def never(*a, **kw):
        called.append(a)
        return {}

    monkeypatch.setattr(stock_svc, "enabled", lambda: False)
    monkeypatch.setattr(stock_svc, "keywords_for_beats", never)

    shots = await pipeline.plan_shots(
        beats(*[VISUAL] * 4), STYLE, source=SOURCE_STOCK, aspect="9:16"
    )
    assert called == []
    assert all(s.sourcing == SOURCE_GENERATED for s in shots)
    assert any("stock_fallback:no stock key" in s.tags for s in shots)


@pytest.mark.asyncio
async def test_plan_shots_asks_for_keywords_only_for_the_covered_beats(monkeypatch):
    asked: list[list[int]] = []

    async def fake_keywords(bts, *, spend=None):
        asked.append([b.index for b in bts])
        return {b.index: "sunrise" for b in bts}

    monkeypatch.setattr(stock_svc, "enabled", lambda: True)
    monkeypatch.setattr(stock_svc, "keywords_for_beats", fake_keywords)

    plan = beats(*[VISUAL] * 6)
    shots = await pipeline.plan_shots(plan, STYLE, source=SOURCE_STOCK, aspect="9:16")
    covered = [s.beat_index for s in broll.stock_shots(shots)]
    assert asked == [covered]
    assert len(covered) < len(plan)


@pytest.mark.asyncio
async def test_generated_projects_never_touch_the_stock_module(monkeypatch):
    def boom():
        raise AssertionError("stock must not be consulted")

    monkeypatch.setattr(stock_svc, "enabled", boom)
    shots = await pipeline.plan_shots(
        beats(VISUAL, VISUAL), STYLE, source=SOURCE_GENERATED, aspect="9:16"
    )
    assert all(s.sourcing == SOURCE_GENERATED for s in shots)


# -------------------------------------------------------------- rendering


@pytest.fixture
def ff(monkeypatch):
    """Capture every ffmpeg argv instead of running it."""
    from marketer.services import ffmpeg as ffmpeg_svc

    runs: list[list[str]] = []
    monkeypatch.setattr(ffmpeg_svc, "_run", lambda cmd: runs.append(cmd))
    monkeypatch.setattr(ffmpeg_svc, "_run_capture", lambda cmd: "6.0")
    return runs


@pytest.fixture
def images(monkeypatch):
    """Stub gpt-image-1: write a sentinel file, record the prompt."""
    from marketer.services import openai_images

    made: list[str] = []

    async def fake_generate(prompt, out_path, **kw):
        made.append(prompt)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"png")
        return out_path

    monkeypatch.setattr(openai_images, "generate_keyframe", fake_generate)
    return made


@pytest.mark.asyncio
async def test_a_generated_shot_renders_a_silent_ken_burns_clip(tmp_path, ff, images):
    shot = plan_broll(beats(VISUAL), STYLE, source=SOURCE_GENERATED)[0]
    await pipeline.render_shot(shot, tmp_path, CANVAS, aspect="9:16")

    assert len(images) == 1
    assert shot.status == "done" and shot.clip_path
    argv = ff[0]
    assert "-loop" in argv and "zoompan" in " ".join(argv)
    # The picture track can never smuggle audio into the concat.
    assert "-an" in argv


@pytest.mark.asyncio
async def test_a_stock_miss_falls_back_to_the_generated_frame(tmp_path, ff, images, monkeypatch):
    async def no_footage(*a, **kw):
        return None

    monkeypatch.setattr(stock_svc, "fetch_clip", no_footage)
    shot = BrollShot(
        beat_index=0, start=0.0, end=4.0, sourcing=SOURCE_STOCK,
        keyword="espresso", stock_query="espresso clean", prompt="draw espresso",
    )
    await pipeline.render_shot(shot, tmp_path, CANVAS, aspect="9:16")

    assert shot.sourcing == SOURCE_GENERATED
    assert "stock_fallback:no footage" in shot.tags
    assert images == ["draw espresso"]
    assert shot.status == "done"


@pytest.mark.asyncio
async def test_a_stock_hit_renders_the_footage_and_records_its_url(tmp_path, ff, monkeypatch):
    clip = stock_svc.StockClip(
        id=1, url="https://videos.example.com/a.mp4", width=1080, height=1920, duration=9.0
    )

    async def fake_fetch(query, dest, **kw):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"mp4")
        return clip

    monkeypatch.setattr(stock_svc, "fetch_clip", fake_fetch)
    shot = BrollShot(
        beat_index=2, start=0.0, end=4.0, sourcing=SOURCE_STOCK,
        keyword="rain", stock_query="rain gritty", prompt="fallback",
    )
    await pipeline.render_shot(shot, tmp_path, CANVAS, aspect="9:16")

    assert shot.sourcing == SOURCE_STOCK
    assert shot.stock_url == clip.url
    argv = " ".join(ff[0])
    assert "loop=" in argv and "-an" in ff[0]
    assert "-loop" not in ff[0]  # footage is not a still


@pytest.mark.asyncio
async def test_an_existing_keyframe_is_not_re_bought(tmp_path, ff, images):
    shot = plan_broll(beats(VISUAL), STYLE, source=SOURCE_GENERATED)[0]
    (tmp_path / "keyframes").mkdir(parents=True)
    (tmp_path / "keyframes" / "beat_00.png").write_bytes(b"already paid for")
    await pipeline.render_shot(shot, tmp_path, CANVAS, aspect="9:16")
    assert images == []


@pytest.mark.asyncio
async def test_one_failed_shot_does_not_abort_its_siblings(tmp_path, ff, monkeypatch):
    from marketer.services import openai_images

    async def flaky(prompt, out_path, **kw):
        if "beat_01" in str(out_path):
            raise RuntimeError("provider said no")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"png")
        return out_path

    monkeypatch.setattr(openai_images, "generate_keyframe", flaky)
    shots = plan_broll(beats(VISUAL, VISUAL, VISUAL), STYLE, source=SOURCE_GENERATED)
    await pipeline.render_shots(shots, tmp_path, CANVAS, aspect="9:16")

    assert [s.status for s in shots] == ["done", "failed", "done"]
    assert "provider said no" in shots[1].error


@pytest.mark.asyncio
async def test_a_tripped_spend_cap_stops_the_fan_out(tmp_path, ff, monkeypatch):
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services import openai_images

    async def capped(prompt, out_path, **kw):
        raise SpendCapExceeded("over cap", scope="niche")

    monkeypatch.setattr(openai_images, "generate_keyframe", capped)
    shots = plan_broll(beats(VISUAL, VISUAL), STYLE, source=SOURCE_GENERATED)
    with pytest.raises(SpendCapExceeded):
        await pipeline.render_shots(shots, tmp_path, CANVAS, aspect="9:16")


@pytest.mark.asyncio
async def test_the_fan_out_is_bounded_by_the_configured_limit(tmp_path, ff, monkeypatch):
    from marketer.services import openai_images

    monkeypatch.setattr(settings, "scene_fanout_limit", 2)
    live = 0
    peak = 0

    async def slow(prompt, out_path, **kw):
        nonlocal live, peak
        live += 1
        peak = max(peak, live)
        await asyncio.sleep(0)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"png")
        live -= 1
        return out_path

    monkeypatch.setattr(openai_images, "generate_keyframe", slow)
    shots = plan_broll(beats(*[VISUAL] * 8), STYLE, source=SOURCE_GENERATED)
    await pipeline.render_shots(shots, tmp_path, CANVAS, aspect="9:16")
    assert peak <= 2


# ------------------------------------------------------------- composite


def _finished_shots(tmp_path) -> list[BrollShot]:
    shots = plan_broll(beats(VISUAL, ABSTRACT), STYLE, source=SOURCE_GENERATED)
    for shot in shots:
        clip = tmp_path / "clips" / f"beat_{shot.beat_index:02d}.mp4"
        clip.parent.mkdir(parents=True, exist_ok=True)
        clip.write_bytes(b"mp4")
        shot.clip_path = str(clip)
    return shots


def test_the_narration_is_the_only_audio_stream(tmp_path, ff):
    """The invariant: b-roll replaces picture only. No mixer, no ducking,
    no sidechain — nothing that could displace a word of the voiceover."""
    vo = tmp_path / "voiceover.wav"
    vo.write_bytes(b"wav")
    shots = _finished_shots(tmp_path)

    pipeline.composite(
        shots=shots, overlays=[], canvas=CANVAS, words=[], style=STYLE,
        voiceover_path=vo, root=tmp_path, aspect="9:16",
    )
    joined = [" ".join(cmd) for cmd in ff]
    # The concat is silent...
    assert "-an" in ff[0]
    # ...and the only command with the voiceover has no music input, no
    # amix and no sidechaincompress.
    mux = [c for c in joined if str(vo) in c]
    assert len(mux) == 1
    assert "amix" not in mux[0]
    assert "sidechaincompress" not in mux[0]


def test_the_type_is_burned_before_the_audio_is_attached(tmp_path, ff):
    from marketer.motion.overlays import build_overlays

    vo = tmp_path / "voiceover.wav"
    vo.write_bytes(b"wav")
    shots = _finished_shots(tmp_path)
    overlays = build_overlays(beats(VISUAL, ABSTRACT), STYLE, CANVAS)

    out = pipeline.composite(
        shots=shots, overlays=overlays, canvas=CANVAS, words=[], style=STYLE,
        voiceover_path=vo, root=tmp_path, aspect="9:16",
    )
    joined = [" ".join(cmd) for cmd in ff]
    burn = next(i for i, c in enumerate(joined) if "drawtext=" in c)
    mux = next(i for i, c in enumerate(joined) if str(vo) in c)
    assert burn < mux
    # The drawtext pass never re-encodes the audio it does not yet have.
    assert "-c:a copy" in joined[burn]
    assert out.name == "final.mp4"


def test_word_captions_are_burned_in_the_same_pass_as_the_kinetic_type(tmp_path, ff):
    vo = tmp_path / "voiceover.wav"
    vo.write_bytes(b"wav")
    shots = _finished_shots(tmp_path)
    words = [{"word": "hello", "start": 0.0, "end": 0.5}]

    pipeline.composite(
        shots=shots, overlays=[], canvas=CANVAS, words=words, style=STYLE,
        voiceover_path=vo, root=tmp_path, aspect="9:16",
    )
    joined = " ".join(" ".join(cmd) for cmd in ff)
    assert "ass=" in joined
    assert (tmp_path / "captions" / "words.ass").exists()


def test_a_style_that_owns_its_words_does_not_double_them(tmp_path, ff):
    """`punk-zine` is word-mode; burning ASS captions too would render the
    same words twice on top of each other."""
    vo = tmp_path / "voiceover.wav"
    vo.write_bytes(b"wav")
    shots = _finished_shots(tmp_path)
    words = [{"word": "hello", "start": 0.0, "end": 0.5}]

    pipeline.composite(
        shots=shots, overlays=[], canvas=CANVAS, words=words,
        style=get_style("punk-zine"), voiceover_path=vo, root=tmp_path, aspect="9:16",
    )
    assert "ass=" not in " ".join(" ".join(cmd) for cmd in ff)


def test_composite_refuses_an_empty_picture_track(tmp_path, ff):
    with pytest.raises(pipeline.MotionRenderError):
        pipeline.composite(
            shots=[], overlays=[], canvas=CANVAS, words=[], style=STYLE,
            voiceover_path=tmp_path / "v.wav", root=tmp_path, aspect="9:16",
        )


def test_overlay_mode_selects_the_word_treatment():
    words = [{"word": "hi", "start": 0.0, "end": 0.4}]
    plan = beats("hi there")
    block = pipeline.build_overlay_specs(plan, words, get_style("modern-flat"), CANVAS)
    word = pipeline.build_overlay_specs(plan, words, get_style("punk-zine"), CANVAS)
    assert [o.text for o in block] == ["HI THERE"]
    assert [o.text for o in word] == ["HI"]


# ------------------------------------------------------------ end to end


class FakeProjects:
    """In-memory stand-in for repos.motion_projects."""

    def __init__(self, row: dict):
        self.row = row
        self.statuses: list[str] = []
        self.plans: list[dict] = []

    def install(self, monkeypatch):
        from marketer.repos import motion_projects as repo

        async def get(project_id, *, user_id):
            return dict(self.row) if user_id == self.row["user_id"] else None

        async def set_status(project_id, *, user_id, status):
            self.statuses.append(status)
            self.row["status"] = status
            return dict(self.row)

        async def save_plan(project_id, *, user_id, beats, overlays):
            self.plans.append({"beats": beats, "overlays": overlays})
            return dict(self.row)

        async def complete(project_id, *, user_id, video_path):
            self.row.update(status="done", video_path=video_path)
            return dict(self.row)

        async def fail(project_id, *, user_id, error):
            self.row.update(status="failed", error=error)
            return dict(self.row)

        for name, fn in [
            ("get", get), ("set_status", set_status), ("save_plan", save_plan),
            ("complete", complete), ("fail", fail),
        ]:
            monkeypatch.setattr(repo, name, fn)
        return self


@pytest.fixture
def project_env(monkeypatch, tmp_path, ff, images, fake_spend):
    from marketer.services import openai_tts, openai_whisper

    row = {
        "id": PROJECT_ID,
        "user_id": USER,
        "niche_id": uuid4(),
        "job_id": None,
        "narration": "A barista pours espresso. The crema settles slowly. We drink it.",
        "style_key": "modern-flat",
        "aspect": "9:16",
        "source": "generated",
        "status": "queued",
    }
    projects = FakeProjects(row).install(monkeypatch)

    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))
    ctx, rec = fake_spend

    async def fake_spend_for(project):
        return ctx

    monkeypatch.setattr(pipeline, "_spend_for_project", fake_spend_for)

    async def fake_tts(text, out_path, **kw):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"wav")
        return out_path

    async def fake_transcribe(path, *, spend=None):
        return [
            {"word": w, "start": i * 0.8, "end": i * 0.8 + 0.8}
            for i, w in enumerate(
                "A barista pours espresso. The crema settles slowly. We drink it.".split()
            )
        ]

    monkeypatch.setattr(openai_tts, "synthesize", fake_tts)
    monkeypatch.setattr(openai_whisper, "transcribe_word_level", fake_transcribe)
    monkeypatch.setattr(stock_svc, "enabled", lambda: False)
    return {"projects": projects, "row": row, "runs": ff, "images": images, "spend": rec}


@pytest.mark.asyncio
async def test_a_project_runs_end_to_end_and_settles_done(project_env):
    result = await pipeline.run_motion_project(user_id=USER, project_id=PROJECT_ID)

    assert result["status"] == "done"
    assert result["video_path"].endswith("output/final.mp4")
    projects = project_env["projects"]
    assert projects.statuses == [
        "voicing", "transcribing", "planning", "rendering", "compositing",
    ]
    # The plan is snapshotted BEFORE pixels are bought, and again after.
    assert len(projects.plans) == 2
    first = projects.plans[0]["beats"]
    assert first and all(b["broll"]["sourcing"] == "generated" for b in first)
    assert all("prompt" in b["broll"] for b in first)
    assert projects.plans[0]["overlays"]


@pytest.mark.asyncio
async def test_a_failure_settles_the_row_instead_of_stranding_it(project_env, monkeypatch):
    from marketer.services import openai_tts

    async def boom(text, out_path, **kw):
        raise RuntimeError("tts exploded")

    monkeypatch.setattr(openai_tts, "synthesize", boom)
    result = await pipeline.run_motion_project(user_id=USER, project_id=PROJECT_ID)
    assert result["status"] == "failed"
    assert project_env["row"]["status"] == "failed"
    assert "tts exploded" in project_env["row"]["error"]


@pytest.mark.asyncio
async def test_a_job_backed_project_reuses_the_paid_voiceover(project_env, monkeypatch, tmp_path):
    from marketer.services import openai_tts

    job_vo = tmp_path / "job" / "audio" / "voiceover.wav"
    job_vo.parent.mkdir(parents=True)
    job_vo.write_bytes(b"already paid for")

    async def refuse(text, out_path, **kw):
        raise AssertionError("must not re-synthesize a job's voiceover")

    monkeypatch.setattr(openai_tts, "synthesize", refuse)
    out = await pipeline.resolve_narration_audio(
        narration="whatever", out_path=tmp_path / "new.wav", job_voiceover=job_vo
    )
    assert out == job_vo


@pytest.mark.asyncio
async def test_a_dead_transcriber_falls_back_to_text_beats(monkeypatch, tmp_path, ff):
    from marketer.services import openai_whisper

    async def boom(path, *, spend=None):
        raise RuntimeError("whisper down")

    monkeypatch.setattr(openai_whisper, "transcribe_word_level", boom)
    vo = tmp_path / "v.wav"
    vo.write_bytes(b"wav")
    out, words = await pipeline.resolve_beats(
        narration="One thing. Another thing. A third thing.", voiceover_path=vo
    )
    assert words == []
    assert out and out[-1].end == 6.0  # the stubbed probe duration


@pytest.mark.asyncio
async def test_a_narration_that_yields_no_beats_is_a_clean_failure(monkeypatch, tmp_path, ff):
    from marketer.services import openai_whisper

    async def nothing(path, *, spend=None):
        return []

    monkeypatch.setattr(openai_whisper, "transcribe_word_level", nothing)
    vo = tmp_path / "v.wav"
    vo.write_bytes(b"wav")
    with pytest.raises(pipeline.MotionRenderError):
        await pipeline.resolve_beats(narration="", voiceover_path=vo)


def test_the_project_root_is_user_partitioned(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))
    root = pipeline.project_root(USER, PROJECT_ID)
    assert root == Path(tmp_path) / USER / "motion" / str(PROJECT_ID)
    assert pipeline.final_video_path(USER, PROJECT_ID) == root / "output" / "final.mp4"
