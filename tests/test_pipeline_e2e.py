"""End-to-end happy-path / failure / spend-cap tests for `pipeline.run_job`.

Every provider, every repo, and the orchestrator's agent stages are
monkeypatched with minimal async stubs — no asyncpg, no httpx, no
external network.

We assert on the captured stage-order list rather than parsing log
lines: cheaper, more direct, and unaffected by the global logging
configuration's handler state.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

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
    User,
)
from marketer.repos.spend import SpendCapExceeded

USER_ID = "user_e2e"
NICHE_ID = UUID("00000000-0000-0000-0000-000000000abc")


def _make_niche(cap_usd: Decimal = Decimal("3.00")) -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id=USER_ID,
        title="claymation econ",
        description="3-min explainer videos",
        target_audience="curious adults",
        hashtags=["econ"],
        visual_style="claymation, warm palette",
        voice="onyx",
        target_duration_sec=30,
        scene_count=2,
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=cap_usd,
    )


def _make_script() -> Script:
    return Script(
        idea=Idea(
            topic="t", angle="a", hook="hook", target_audience="x", why_it_works="y"
        ),
        scenes=[
            Scene(index=0, narration="hello", visual_prompt="vp0",
                  motion_prompt="mp0", duration_sec=5),
            Scene(index=1, narration="world", visual_prompt="vp1",
                  motion_prompt="mp1", duration_sec=5),
        ],
        total_duration_sec=10,
        cta=None,
    )


@pytest.fixture
def stage_log() -> list[str]:
    return []


@pytest.fixture
def stub_all(monkeypatch, tmp_path: Path, stage_log: list[str], passing_render_qa):
    """Monkeypatch every external dependency `pipeline.run_job` reaches."""
    # --- DB layer ----------------------------------------------------------
    niche_holder = {"niche": _make_niche()}

    async def fake_niches_get(niche_id, *, user_id):
        return niche_holder["niche"]
    monkeypatch.setattr(pipeline.niches_repo, "get", fake_niches_get)

    saved: dict[UUID, Job] = {}

    async def fake_create(*, user_id, niche_id, platform):
        job = Job(
            id=uuid4(), user_id=user_id, niche_id=niche_id, platform=platform,
            status=JobStatus.queued,
        )
        saved[job.id] = job
        return job
    monkeypatch.setattr(pipeline.jobs_repo, "create", fake_create)

    async def fake_save_snapshot(job):
        saved[job.id] = job.model_copy(deep=True)
        # Record status transitions for the order assertion.
        stage_log.append(job.status.value)
    monkeypatch.setattr(pipeline.jobs_repo, "save_snapshot", fake_save_snapshot)

    async def fake_today_spend(*, user_id, niche_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today_spend)

    async def fake_today_total_spend(*, user_id):
        return Decimal("0.00")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_total_usd", fake_today_total_spend)

    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap", fake_assert_within_cap)

    # Stub users_repo.get so default_context and _ensure_cap don't hit DB.
    import marketer.repos.users as _users_repo
    from datetime import datetime, timezone

    async def fake_users_get(user_id: str):
        return User(
            id=user_id,
            email="test@test.com",
            global_daily_cap_usd=None,
            created_at=datetime.now(timezone.utc),
        )
    monkeypatch.setattr(_users_repo, "get", fake_users_get)

    # The default SpendContext.record calls spend_repo.record which needs
    # a DB pool — stub it out to a no-op so providers can log freely.
    async def fake_record(entry):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "record", fake_record)

    # --- Storage layout ----------------------------------------------------
    def fake_ensure_layout(job_path):
        root = tmp_path / job_path
        for sub in ("keyframes", "clips", "audio", "captions", "output"):
            (root / sub).mkdir(parents=True, exist_ok=True)
        return root
    monkeypatch.setattr(pipeline, "ensure_layout", fake_ensure_layout)

    # --- Agents ------------------------------------------------------------
    async def fake_build_performance_context(*, niche_id, user_id, lookback_days=30):
        return ""
    monkeypatch.setattr(pipeline, "build_performance_context", fake_build_performance_context)

    async def fake_ideation(title, *, performance_context="", niche_description="", target_audience="", platform="", brand_voice="", banned_words=None, recent_topics=None, spend=None):
        return Idea(topic="t", angle="a", hook="hook",
                    target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", fake_ideation)

    async def fake_scriptwriter(idea, *, scene_count, target_duration_sec, audience_context="", spend=None):
        return _make_script()
    monkeypatch.setattr(pipeline, "run_scriptwriter", fake_scriptwriter)

    async def fake_visual_director(script, *, visual_style, character_description="", spend=None):
        return script
    monkeypatch.setattr(pipeline, "run_visual_director", fake_visual_director)

    async def fake_qa(script, transcript, dur, *, niche, spend=None):
        return QAReport(passed=True, issues=[], suggested_action="publish")
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    # --- Providers ---------------------------------------------------------
    async def fake_get_or_create(niche, *, quality, spend):
        ref = tmp_path / "character_sheets" / f"{niche.id}.png"
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.write_bytes(b"PNG")
        return ref
    monkeypatch.setattr(pipeline.character_sheet, "get_or_create", fake_get_or_create)

    async def fake_generate_keyframe(prompt, out_path, *, quality,
                                     reference_image_path=None, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-image-1",
                            units=Decimal(1), cost_usd=Decimal("0.04"))
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe",
                        fake_generate_keyframe)

    async def fake_animate(keyframe, motion_prompt, out_path, *, duration_sec,
                           resolution, spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        if spend is not None:
            await spend.log(provider="xai", sku="grok-imagine-video",
                            units=Decimal(str(duration_sec)),
                            cost_usd=Decimal("0.25"))
        return out_path
    monkeypatch.setattr(pipeline.grok_imagine, "animate", fake_animate)

    async def fake_synthesize(text, out_path, *, voice, style_directions=None,
                              spend=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        if spend is not None:
            await spend.log(provider="openai", sku="gpt-4o-mini-tts",
                            units=Decimal("10"), cost_usd=Decimal("0.15"))
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", fake_synthesize)

    async def fake_transcribe(audio_path, *, spend=None):
        if spend is not None:
            await spend.log(provider="openai", sku="whisper-1",
                            units=Decimal("10"), cost_usd=Decimal("0.06"))
        return [{"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0}]
    monkeypatch.setattr(pipeline.openai_whisper, "transcribe_word_level",
                        fake_transcribe)

    # Local music library so music.pick_track finds a track.
    music_lib = tmp_path / "assets" / "music"
    music_lib.mkdir(parents=True, exist_ok=True)
    (music_lib / "track.mp3").write_bytes(b"\x00")
    monkeypatch.setattr(pipeline.settings, "assets_dir", str(tmp_path / "assets"))

    # ffmpeg + subtitle are non-async — patch with no-op functions that
    # write a sentinel file so subsequent steps reading the path work.
    def fake_concat(clips, out_path, aspect=None):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "concat_clips", fake_concat)

    def fake_mix(video, vo, music_path, out_path, music_gain_db=-18.0):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "mix_audio", fake_mix)

    def fake_burn(video, ass, out_path):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"MP4")
        return out_path
    monkeypatch.setattr(pipeline.ffmpeg, "burn_subtitles", fake_burn)

    def fake_words_to_ass(words, out_path, style="tiktok-bold"):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("[Script Info]\n")
        return out_path
    monkeypatch.setattr(pipeline.subtitle, "words_to_ass", fake_words_to_ass)

    async def fake_schedule_post(*, video_path, caption, hashtags, platform,
                                 scheduled_for, profile_key, user_id):
        return "post-id-xyz"
    monkeypatch.setattr(pipeline.scheduler, "schedule_post", fake_schedule_post)

    # Record archiver invocations (and isolate tests from the live DB the
    # real archiver would hit).
    archive_calls: list[UUID] = []

    async def fake_archive(job, niche):
        archive_calls.append(job.id)
        return 0
    monkeypatch.setattr(pipeline.media_archive, "archive_job_media", fake_archive)

    return {"saved": saved, "niche_holder": niche_holder, "archive_calls": archive_calls}


async def test_happy_path_runs_all_stages(stub_all, stage_log):
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.done
    assert job.provider_post_id == "post-id-xyz"
    assert job.error is None
    assert stub_all["archive_calls"] == [job.id]  # library archiving ran
    assert job.script is not None
    assert len(job.clips) == 2
    assert job.audio is not None
    assert job.rendered is not None

    # Every expected stage transition should have been persisted in order.
    # `queued` is set by `jobs_repo.create` and not re-saved; the first
    # `save_snapshot` records `ideating`.
    expected_subseq = [
        JobStatus.ideating.value,
        JobStatus.scripting.value,
        JobStatus.generating_images.value,
        JobStatus.animating.value,
        JobStatus.voicing.value,
        JobStatus.editing.value,
        JobStatus.captioning.value,
        JobStatus.qa.value,
        JobStatus.scheduling.value,
        JobStatus.done.value,
    ]
    # Filter consecutive duplicates and assert the resulting sequence matches.
    deduped: list[str] = []
    for s in stage_log:
        if not deduped or deduped[-1] != s:
            deduped.append(s)
    assert deduped == expected_subseq


async def test_scriptwriter_failure_marks_job_failed(monkeypatch, stub_all):
    async def boom(*args, **kwargs):
        raise RuntimeError("scriptwriter exploded")
    monkeypatch.setattr(pipeline, "run_scriptwriter", boom)

    # The terminal backstop converts unhandled stage exceptions into a
    # failed job (no more unretryable zombie rows stuck mid-status).
    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.failed
    assert "scriptwriter exploded" in (job.error or "")

    # The terminal state must also be what was persisted — a failed job
    # the queue can retry, not a row stranded at `scripting`.
    saved = stub_all["saved"]
    final_state = next(iter(saved.values()))
    assert final_state.status == JobStatus.failed
    assert "scriptwriter exploded" in (final_state.error or "")


async def test_spend_cap_overshoot_during_fan_out(monkeypatch, stub_all, stage_log):
    """A tiny cap so the first image spend exceeds it; the parallel
    fan-out should be aborted and the job marked failed."""
    stub_all["niche_holder"]["niche"] = _make_niche(cap_usd=Decimal("0.01"))

    # The pre-stage `_ensure_cap` check would also trip here; bypass it so
    # the test exercises the in-`log` race-safety guarantee specifically.
    async def fake_assert_within_cap(*, user_id, niche_id, cap_usd):
        return None
    monkeypatch.setattr(pipeline.spend_repo, "assert_within_cap",
                        fake_assert_within_cap)

    async def fake_today_spend(*, user_id, niche_id):
        # Any spend already pushes us over the $0.01 cap.
        return Decimal("0.04")
    monkeypatch.setattr(pipeline.spend_repo, "today_spend_usd", fake_today_spend)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.failed
    assert job.error is not None
    assert "spend_cap" in job.error


async def test_qa_failure_marks_job_failed(monkeypatch, stub_all):
    async def fake_qa(script, transcript, dur, *, niche, spend=None):
        return QAReport(
            passed=False, issues=["off-topic", "low energy"],
            suggested_action="regenerate_script",
        )
    monkeypatch.setattr(pipeline, "run_qa", fake_qa)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.failed
    assert "off-topic" in (job.error or "")
    assert job.provider_post_id is None


async def test_invalid_platform_raises(stub_all):
    with pytest.raises(ValueError, match="not enabled"):
        await pipeline.run_job(
            user_id=USER_ID, niche_id=NICHE_ID, platform="reels",
        )


async def test_unknown_niche_raises(monkeypatch, stub_all):
    async def none_get(niche_id, *, user_id):
        return None
    monkeypatch.setattr(pipeline.niches_repo, "get", none_get)
    with pytest.raises(ValueError, match="not found"):
        await pipeline.run_job(
            user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        )


# Sanity check: tells future-us that SpendCapExceeded import paths line up.
def test_spend_cap_exceeded_is_subclass_of_exception():
    assert issubclass(SpendCapExceeded, Exception)


async def test_approval_gate_parks_job_before_scheduling(stub_all, stage_log):
    """A niche with approve_before_post renders fully, passes QA, then
    parks in awaiting_approval — the scheduler must never be called."""
    niche = stub_all["niche_holder"]["niche"]
    stub_all["niche_holder"]["niche"] = niche.model_copy(
        update={"approve_before_post": True}
    )

    job = await pipeline.run_job(
        user_id="user_e2e", niche_id=niche.id, platform="tiktok"
    )

    assert job.status == JobStatus.awaiting_approval
    assert job.rendered is not None  # the video exists, it just didn't post
    assert job.provider_post_id is None  # scheduler never ran
    assert stub_all["archive_calls"] == [job.id]  # archived even when parked
    assert "scheduling" not in stage_log
    assert "awaiting_approval" in stage_log


# --------------------------------------------------------------------------- notifications

async def test_notify_respects_email_optout(monkeypatch):
    """_notify sends when the user is opted in, and stays silent when they've
    turned email notifications off — without ever touching job state."""
    from datetime import datetime, timezone

    import marketer.repos.users as _users_repo
    from marketer.services import email as email_svc

    sent: list[str] = []

    async def fake_send_email(*, to, subject, html):
        sent.append(subject)
        return True

    monkeypatch.setattr(email_svc, "send_email", fake_send_email)

    job = Job(
        id=uuid4(), user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed,
    )

    async def opted_in(user_id):
        return User(id=user_id, email="a@a.com", email_notifications=True,
                    created_at=datetime.now(timezone.utc))

    monkeypatch.setattr(_users_repo, "get", opted_in)
    await pipeline._notify(job, kind="failed")
    assert len(sent) == 1

    async def opted_out(user_id):
        return User(id=user_id, email="a@a.com", email_notifications=False,
                    created_at=datetime.now(timezone.utc))

    monkeypatch.setattr(_users_repo, "get", opted_out)
    await pipeline._notify(job, kind="failed")
    assert len(sent) == 1  # unchanged — opted-out user got nothing


# --------------------------------------------------------------------------- stage resume

def _seed_failed_job_artifacts(tmp_path: Path, job_id: UUID) -> tuple[Path, list]:
    """Materialize the on-volume artifacts a failed attempt left behind."""
    from marketer.models import Clip

    script = _make_script()
    root = tmp_path / USER_ID / str(job_id)
    clips = []
    for s in script.scenes:
        kf = root / "keyframes" / f"scene_{s.index}.png"
        cp = root / "clips" / f"scene_{s.index}.mp4"
        kf.parent.mkdir(parents=True, exist_ok=True)
        cp.parent.mkdir(parents=True, exist_ok=True)
        kf.write_bytes(b"PNG")
        cp.write_bytes(b"MP4")
        clips.append(Clip(scene_index=s.index, keyframe_path=str(kf),
                          video_path=str(cp), duration_sec=5))
    vo = root / "audio" / "voiceover.wav"
    vo.parent.mkdir(parents=True, exist_ok=True)
    vo.write_bytes(b"WAV")
    return root, clips


def _counting_provider_stubs(monkeypatch) -> dict[str, int]:
    """Re-patch the expensive stages with counters on top of stub_all."""
    calls = {"ideation": 0, "keyframe": 0, "tts": 0}

    async def counting_ideation(title, *, performance_context="", niche_description="", target_audience="", platform="", brand_voice="", banned_words=None, recent_topics=None, spend=None):
        calls["ideation"] += 1
        return Idea(topic="t", angle="a", hook="hook",
                    target_audience="x", why_it_works="y")
    monkeypatch.setattr(pipeline, "run_ideation", counting_ideation)

    async def counting_keyframe(prompt, out_path, *, quality,
                                reference_image_path=None, spend=None):
        calls["keyframe"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"PNG")
        return out_path
    monkeypatch.setattr(pipeline.openai_images, "generate_keyframe",
                        counting_keyframe)

    async def counting_tts(text, out_path, *, voice, style_directions=None,
                           spend=None):
        calls["tts"] += 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"WAV")
        return out_path
    monkeypatch.setattr(pipeline.openai_tts, "synthesize", counting_tts)
    return calls


async def test_retry_after_transient_failure_resumes_without_respending(
    monkeypatch, stub_all, tmp_path: Path
):
    """A job that failed mid-run keeps its script/clips/VO on retry —
    ideation, keyframes, and TTS must not be re-bought."""
    job_id = uuid4()
    _, clips = _seed_failed_job_artifacts(tmp_path, job_id)
    failed = Job(
        id=job_id, user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="GrokImagineError: 500 mid-poll",
        script=_make_script(), clips=clips,
    )

    async def fake_get(jid, *, user_id):
        return failed.model_copy(deep=True)
    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    calls = _counting_provider_stubs(monkeypatch)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok", job_id=job_id,
    )

    assert job.status == JobStatus.done
    assert calls == {"ideation": 0, "keyframe": 0, "tts": 0}


async def test_retry_regenerates_only_missing_scene(
    monkeypatch, stub_all, tmp_path: Path
):
    """Per-scene resume: when one clip file is gone, only that scene
    re-spends."""
    job_id = uuid4()
    _, clips = _seed_failed_job_artifacts(tmp_path, job_id)
    Path(clips[1].video_path).unlink()  # scene 1's clip was lost

    failed = Job(
        id=job_id, user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="GrokImagineError: timeout",
        script=_make_script(), clips=clips,
    )

    async def fake_get(jid, *, user_id):
        return failed.model_copy(deep=True)
    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    calls = _counting_provider_stubs(monkeypatch)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok", job_id=job_id,
    )

    assert job.status == JobStatus.done
    assert calls["keyframe"] == 1  # only the missing scene
    assert calls["ideation"] == 0 and calls["tts"] == 0


async def test_content_rejection_retry_regenerates_everything(
    monkeypatch, stub_all, tmp_path: Path
):
    """A QA content rejection means the artifacts are the problem — the
    retry must start from scratch."""
    job_id = uuid4()
    _, clips = _seed_failed_job_artifacts(tmp_path, job_id)
    failed = Job(
        id=job_id, user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="content QA failed: weak hook",
        script=_make_script(), clips=clips,
    )

    async def fake_get(jid, *, user_id):
        return failed.model_copy(deep=True)
    monkeypatch.setattr(pipeline.jobs_repo, "get", fake_get)

    calls = _counting_provider_stubs(monkeypatch)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok", job_id=job_id,
    )

    assert job.status == JobStatus.done
    assert calls["ideation"] == 1
    assert calls["keyframe"] == 2  # both scenes regenerated
    assert calls["tts"] == 1


# --------------------------------------------------------------------------- auto-regenerate

async def test_qa_regenerate_script_retries_once_then_succeeds(monkeypatch, stub_all):
    """QA rejecting the script with suggested_action=regenerate_script gets
    exactly one fresh in-run attempt; second pass publishes."""
    qa_calls = {"n": 0}

    async def flaky_qa(script, transcript, dur, *, niche, spend=None):
        qa_calls["n"] += 1
        if qa_calls["n"] == 1:
            return QAReport(passed=False, issues=["weak hook"],
                            suggested_action="regenerate_script")
        return QAReport(passed=True, issues=[], suggested_action="publish")

    monkeypatch.setattr(pipeline, "run_qa", flaky_qa)

    script_calls = {"n": 0}

    async def counting_scriptwriter(idea, *, scene_count, target_duration_sec,
                                    audience_context="", spend=None):
        script_calls["n"] += 1
        return _make_script()

    monkeypatch.setattr(pipeline, "run_scriptwriter", counting_scriptwriter)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.done
    assert qa_calls["n"] == 2
    assert script_calls["n"] == 2  # regenerated once


async def test_qa_regenerate_is_bounded_to_one_attempt(monkeypatch, stub_all):
    """A script QA keeps rejecting fails after exactly one regenerate."""
    qa_calls = {"n": 0}

    async def always_reject(script, transcript, dur, *, niche, spend=None):
        qa_calls["n"] += 1
        return QAReport(passed=False, issues=["still weak"],
                        suggested_action="regenerate_script")

    monkeypatch.setattr(pipeline, "run_qa", always_reject)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )
    assert job.status == JobStatus.failed
    assert qa_calls["n"] == 2  # original + one regenerate, then stop
    assert "content QA failed" in (job.error or "")


# --------------------------------------------------------------------------- render QA gate

async def test_render_qa_failure_fails_job_before_archive_and_schedule(
    monkeypatch, stub_all
):
    """The deterministic render gate failing must fail the job with the
    'render QA failed' prefix (the retry-wipe contract) and never reach
    archiving or scheduling."""
    from marketer.services import video_qa

    def failing_check(final_path, *, voiceover_path, target_duration_sec,
                      max_upload_bytes=video_qa.MAX_UPLOAD_BYTES):
        return video_qa.RenderReport(
            passed=False,
            issues=["video (3.0s) ends before the voiceover (9.0s)"],
            final_path=str(final_path),
            duration_sec=3.0,
            size_bytes=1024,
        )

    # applied after the passing_render_qa fixture, so this wins
    monkeypatch.setattr(video_qa, "check_render", failing_check)

    job = await pipeline.run_job(
        user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
    )

    assert job.status == JobStatus.failed
    assert (job.error or "").startswith("render QA failed")
    assert "ends before the voiceover" in job.error
    assert stub_all["archive_calls"] == []  # never archived
    assert job.provider_post_id is None  # never scheduled
    # the report's probed reality was still recorded on the job
    assert job.rendered is not None and job.rendered.duration_sec == 3.0


async def test_content_qa_rejection_wipes_state_via_reset_for_retry(monkeypatch):
    """reset_for_retry (the real retry route path) wipes script/clips/audio
    for QA content rejections — the error string is nulled in the same
    call, so the wipe must happen there, not later in the pipeline."""
    from marketer.models import AudioTrack
    from marketer.repos import jobs as jobs_repo

    rejected = Job(
        id=uuid4(), user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="content QA failed: weak hook",
        script=_make_script(),
        clips=[],
        audio=AudioTrack(voiceover_path="/tmp/vo.wav"),
    )

    async def fake_get(job_id, *, user_id):
        return rejected

    saved: list[Job] = []

    async def fake_save(job):
        saved.append(job)

    monkeypatch.setattr(jobs_repo, "get", fake_get)
    monkeypatch.setattr(jobs_repo, "save_snapshot", fake_save)

    fresh = await jobs_repo.reset_for_retry(rejected.id, user_id=USER_ID)

    assert fresh is not None
    assert fresh.status == JobStatus.queued and fresh.error is None
    assert fresh.script is None and fresh.clips == [] and fresh.audio is None
    assert saved and saved[0].script is None  # the wipe was persisted


async def test_transient_failure_reset_keeps_state_for_resume(monkeypatch):
    """Non-QA failures keep script/clips through reset_for_retry so the
    stage-resume path can reuse them."""
    from marketer.repos import jobs as jobs_repo

    failed = Job(
        id=uuid4(), user_id=USER_ID, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.failed, error="GrokImagineError: 500 mid-poll",
        script=_make_script(),
    )

    async def fake_get(job_id, *, user_id):
        return failed

    async def fake_save(job):
        pass

    monkeypatch.setattr(jobs_repo, "get", fake_get)
    monkeypatch.setattr(jobs_repo, "save_snapshot", fake_save)

    fresh = await jobs_repo.reset_for_retry(failed.id, user_id=USER_ID)
    assert fresh is not None and fresh.script is not None  # state survives
