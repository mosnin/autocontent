"""QA-rejection wipe: retries must not resume the same rejected artifacts.

reset_for_retry wipes script/clips/audio when the pre-reset error is a
content or render QA failure. If that wipe regresses, a retry re-judges
the same script and burns spend until the job is abandoned.
"""
from __future__ import annotations

from uuid import UUID, uuid4

from marketer.models import AudioTrack, Clip, Idea, Job, JobStatus, Scene, Script
from marketer.repos.jobs import CONTENT_REJECTION_PREFIXES, wipe_pipeline_state


def _job_with_artifacts(*, error: str | None) -> Job:
    return Job(
        id=uuid4(),
        user_id="user_a",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        platform="tiktok",
        status=JobStatus.failed,
        error=error,
        script=Script(
            idea=Idea(
                topic="t", angle="a", hook="h",
                target_audience="x", why_it_works="y",
            ),
            scenes=[
                Scene(
                    index=0, narration="n", visual_prompt="v",
                    motion_prompt="m", duration_sec=4,
                )
            ],
            total_duration_sec=4,
        ),
        clips=[Clip(scene_index=0, keyframe_path="k.png", video_path="c.mp4", duration_sec=4)],
        audio=AudioTrack(voiceover_path="vo.wav"),
    )


def test_wipe_pipeline_state_clears_script_clips_and_audio():
    job = _job_with_artifacts(error="content QA failed: hook")
    wipe_pipeline_state(job)
    assert job.script is None
    assert job.clips == []
    assert job.audio is None
    # Status / error stay for the caller to reset — wipe is artifacts only.
    assert job.status == JobStatus.failed
    assert job.error and job.error.startswith("content QA failed")


def test_content_rejection_prefixes_are_stable_and_match_qa_errors():
    assert CONTENT_REJECTION_PREFIXES == ("content QA failed", "render QA failed")
    for prefix in CONTENT_REJECTION_PREFIXES:
        job = _job_with_artifacts(error=f"{prefix}: details")
        assert job.error and job.error.startswith(CONTENT_REJECTION_PREFIXES)


def test_wipe_is_safe_on_already_empty_job():
    job = Job(
        id=uuid4(),
        user_id="user_a",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        platform="reels",
        status=JobStatus.failed,
        error="render QA failed: duration",
    )
    wipe_pipeline_state(job)
    assert job.script is None
    assert job.clips == []
    assert job.audio is None
