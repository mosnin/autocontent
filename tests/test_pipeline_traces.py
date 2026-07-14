"""Pipeline OTEL span assertions.

Uses the SDK's InMemorySpanExporter to capture spans produced by a fully-
stubbed run_job() call and asserts that:
- a root ``pipeline.run_job`` span is present with the expected attributes.
- per-stage spans ``pipeline.stage.<name>`` are created in the right order.
- exception spans record an ERROR status.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest

import opentelemetry.trace as _otel_trace_mod
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.util._once import Once

from marketer import pipeline
from marketer.agents.qa import QAReport
from marketer.models import (
    Idea,
    Job,
    JobStatus,
    Niche,
    PostingWindow,
    Scene,
    Script,
)

USER_ID = "user_otel_test"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000def")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def in_memory_provider():
    """Install a real TracerProvider backed by InMemorySpanExporter for the
    duration of the test, then restore the previous global provider.

    The OTEL SDK only allows set_tracer_provider() once per process (via
    Once), so we must reach into the private module state to reset it.
    This is an accepted pattern in the OTEL SDK's own test suite.
    """
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    # Save old state.
    old_once = _otel_trace_mod._TRACER_PROVIDER_SET_ONCE
    old_provider = _otel_trace_mod._TRACER_PROVIDER

    # Reset so set_tracer_provider() is accepted.
    _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = Once()
    _otel_trace_mod._TRACER_PROVIDER = None

    trace.set_tracer_provider(provider)
    yield exporter

    # Restore original state.
    _otel_trace_mod._TRACER_PROVIDER_SET_ONCE = old_once
    _otel_trace_mod._TRACER_PROVIDER = old_provider
    exporter.clear()


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="claymation econ",
        description="3-min explainer",
        target_audience="curious adults",
        hashtags=["econ"],
        visual_style="claymation",
        voice="onyx",
        target_duration_sec=10,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


def _make_script() -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"),
        scenes=[
            Scene(index=0, narration="hello", visual_prompt="vp0",
                  motion_prompt="mp0", duration_sec=5),
            Scene(index=1, narration="world", visual_prompt="vp1",
                  motion_prompt="mp1", duration_sec=5),
        ],
        total_duration_sec=10,
        cta=None,
    )


@pytest.fixture()
def stub_pipeline(monkeypatch, tmp_path: Path):
    """Minimal stubs — same shape as test_pipeline_e2e, trimmed for brevity."""
    async def fake_niches_get(niche_id: Any, *, user_id: Any):
        return _make_niche()
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niches_get)

    async def fake_create(*, user_id, niche_id, platform):
        return Job(
            id=uuid4(), user_id=user_id, niche_id=niche_id,
            platform=platform, status=JobStatus.queued,
        )
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save(job: Job) -> None:
        pass
    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save)

    async def fake_cap(**_kw):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_cap)

    async def fake_today(**_kw):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today)

    async def fake_record(entry):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "record", fake_record)

    async def fake_today_total(**_kw):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_total_usd", fake_today_total)

    # users_repo.get is called inside default_context to pull the global cap.
    import marketer.repos.users as _users_repo
    from datetime import datetime, timezone
    from marketer.models import User

    async def fake_users_get(user_id: str):
        return User(
            id=user_id, email="t@t.com", global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_users_get)

    # niche_lock and user_lock take real pg advisory locks. In a unit test
    # without Postgres, bypass them with no-op context managers.
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _fake_niche_lock(niche_id):
        yield True
    monkeypatch.setattr(pipeline, "niche_lock", _fake_niche_lock)

    @asynccontextmanager
    async def _fake_user_lock(user_id, *, max_parallel):
        yield
    monkeypatch.setattr(pipeline, "user_lock", _fake_user_lock)

    def fake_layout(path: str) -> Path:
        root = tmp_path / path
        for sub in ("keyframes", "clips", "audio", "captions", "output"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    monkeypatch.setattr(pipeline, "ensure_layout", fake_layout)

    async def fake_ideation(title, *, performance_context: str = ""):
        return Idea(topic="t", angle="a", hook="h", target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_perf_ctx(*, niche_id, user_id, lookback_days):
        return ""
    monkeypatch.setattr(pipeline, "build_performance_context", fake_perf_ctx)

    async def fake_script(idea, *, scene_count, target_duration_sec):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_script)

    async def fake_vd(script, *, visual_style):
        return script
    monkeypatch.setattr(pipeline, "run_visual_director", fake_vd)

    async def fake_qa(script, transcript, dur, *, niche):
        return QAReport(passed=True, issues=[], suggested_action="publish")
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    async def fake_char_sheet(niche, *, quality, spend):
        ref = tmp_path / "ref.png"
        ref.write_bytes(b"PNG")
        return ref
    monkeypatch.setattr(pipeline.character_sheet, "get_or_create", fake_char_sheet)

    async def fake_keyframe(prompt, out_path, *, quality, reference_image_path=None, spend=None):
        out_path.write_bytes(b"PNG")
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe", fake_keyframe)

    async def fake_animate(kf, mp, out_path, *, duration_sec, resolution, spend=None):
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_animate)

    async def fake_tts(text, out_path, *, voice, style_directions=None, spend=None):
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_tts)

    async def fake_whisper(audio_path, *, spend=None):
        return [{"word": "hello", "start": 0.0, "end": 0.5}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level", fake_whisper)

    music_lib = tmp_path / "assets" / "music"
    music_lib.mkdir(parents=True, exist_ok=True)
    (music_lib / "track.mp3").write_bytes(b"\x00")
    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))

    def fake_concat(clips, out_path, aspect=None):
        out_path.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_mix(video, vo, music_p, out_path, music_gain_db=-18.0):
        out_path.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "mix_audio", fake_mix)

    def fake_burn(video, ass, out_path):
        out_path.write_bytes(b"MP4")
    monkeypatch.setattr(pipeline.ffmpeg, "burn_subtitles", fake_burn)

    def fake_words_to_ass(words, out_path, style="tiktok-bold"):
        out_path.write_text("[Script Info]\n")
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule(*, video_path, caption, hashtags, platform,
                            scheduled_for, profile_key, user_id):
        return "post-xyz"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_happy_path_produces_root_and_stage_spans(in_memory_provider, stub_pipeline):
    """A full pipeline run should emit a root span plus per-stage spans."""
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.done

    spans = in_memory_provider.get_finished_spans()
    span_names = [s.name for s in spans]

    # Root span must be present.
    assert "pipeline.run_job" in span_names, f"spans: {span_names}"

    # All nine pipeline stage spans must appear.
    expected_stages = [
        "pipeline.stage.ideating",
        "pipeline.stage.scripting",
        "pipeline.stage.generating_images",
        "pipeline.stage.animating",
        "pipeline.stage.voicing",
        "pipeline.stage.editing",
        "pipeline.stage.captioning",
        "pipeline.stage.qa",
        "pipeline.stage.scheduling",
    ]
    for stage_span_name in expected_stages:
        assert stage_span_name in span_names, (
            f"{stage_span_name!r} not in spans: {span_names}"
        )


async def test_root_span_carries_job_attributes(in_memory_provider, stub_pipeline):
    """The root pipeline.run_job span must carry user/niche/platform/job_id."""
    await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    spans = in_memory_provider.get_finished_spans()
    root = next(s for s in spans if s.name == "pipeline.run_job")
    attrs = dict(root.attributes or {})

    assert attrs.get("marketer.user_id") == USER_ID
    assert attrs.get("marketer.niche_id") == str(NICHE_ID)
    assert attrs.get("marketer.platform") == "tiktok"
    assert "marketer.job_id" in attrs
    assert attrs.get("marketer.job_status") == JobStatus.done.value


async def test_stage_spans_carry_stage_attribute(in_memory_provider, stub_pipeline):
    """Each pipeline.stage.* span must have marketer.stage set."""
    await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    spans = in_memory_provider.get_finished_spans()
    stage_spans = [s for s in spans if s.name.startswith("pipeline.stage.")]
    assert stage_spans, "No stage spans found"

    for s in stage_spans:
        attrs = dict(s.attributes or {})
        assert "marketer.stage" in attrs, (
            f"span {s.name!r} missing marketer.stage attribute"
        )
        # Attribute value matches the suffix of the span name.
        expected_stage = s.name[len("pipeline.stage."):]
        assert attrs["marketer.stage"] == expected_stage


async def test_exception_in_stage_records_error_status(in_memory_provider, monkeypatch, stub_pipeline):
    """When a stage raises, the span should record ERROR status."""
    async def boom(*args, **kwargs):
        raise RuntimeError("scripting exploded")

    monkeypatch.setattr(pipeline, "run_scriptwriter", boom)

    with pytest.raises(RuntimeError, match="scripting exploded"):
        await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    spans = in_memory_provider.get_finished_spans()
    # Both the stage span and the root span should be ERROR.
    error_spans = [
        s for s in spans
        if s.status.status_code == trace.StatusCode.ERROR
    ]
    assert error_spans, "Expected at least one ERROR span"

    error_names = {s.name for s in error_spans}
    assert "pipeline.stage.scripting" in error_names


async def test_stage_spans_ordered_by_start_time(in_memory_provider, stub_pipeline):
    """Stage spans should start in pipeline order (ideating before scripting, etc.)."""
    await pipeline.run_job(user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok")

    spans = in_memory_provider.get_finished_spans()
    stage_spans = sorted(
        [s for s in spans if s.name.startswith("pipeline.stage.")],
        key=lambda s: s.start_time,
    )
    names_ordered = [s.name for s in stage_spans]

    # Check ideating precedes scripting precedes generating_images.
    idx_ideating = names_ordered.index("pipeline.stage.ideating")
    idx_scripting = names_ordered.index("pipeline.stage.scripting")
    idx_images = names_ordered.index("pipeline.stage.generating_images")

    assert idx_ideating < idx_scripting < idx_images
