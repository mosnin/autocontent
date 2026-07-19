"""Deterministic QA on the rendered mp4 — runs before the LLM QA agent.

The LLM QA pass judges the *content* (hook, niche drift) from the script
and transcript; it never sees the file. This module is the machine gate
on the artifact itself:

- container is probeable, has video + audio streams, non-trivial size
- real duration covers the voiceover (narration is never cut off)
- real duration is within tolerance of the niche target
- audio isn't silent (mean volume above a floor)
- file fits the Ayrshare upload limit — re-encoded to a bitrate budget
  when it doesn't, and re-verified after

Everything funnels into a `RenderReport`; the pipeline fails the job on
`passed=False` with the concrete issues in `job.error`.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from ..logging import get_logger
from . import ffmpeg

log = get_logger(__name__)

# Ayrshare's documented media upload ceiling (see services/scheduler.py).
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
# Narration may end this far before the video does — never after it.
VO_COVERAGE_SLACK_SEC = 0.25
# Real duration may drift this fraction from the niche target before we fail.
DURATION_TOLERANCE = 0.35
# Mean loudness floor: below this the mix is effectively silent.
MIN_MEAN_VOLUME_DB = -45.0
# Anything smaller than this is a broken render, whatever ffprobe says.
MIN_FILE_BYTES = 50 * 1024


class RenderReport(BaseModel):
    passed: bool
    issues: list[str]
    final_path: str
    duration_sec: float
    size_bytes: int


def check_render(
    final_path: Path,
    *,
    voiceover_path: Path,
    target_duration_sec: int,
    max_upload_bytes: int = MAX_UPLOAD_BYTES,
    enforce_duration: bool = True,
) -> RenderReport:
    """Verify the rendered file; shrink it to the upload budget if needed.

    Returns a report whose `final_path` may point at a re-encoded file
    (`*_fit.mp4`) when the original exceeded `max_upload_bytes`.

    `enforce_duration=False` skips ONLY the duration-drift-from-target gate
    (all other gates — streams present, not silent, VO coverage, size
    budget — still run). In lip-synced avatar mode the total length is
    narration-driven rather than a fixed niche target, so drift from that
    target is expected and not a defect; the pipeline passes
    `enforce_duration=False` for those jobs so a legitimate lip-sync render
    isn't rejected (and re-spent) over a target it was never meant to hit.
    """
    issues: list[str] = []

    if not final_path.exists() or final_path.stat().st_size < MIN_FILE_BYTES:
        size = final_path.stat().st_size if final_path.exists() else 0
        return RenderReport(
            passed=False,
            issues=[f"rendered file missing or truncated ({size} bytes)"],
            final_path=str(final_path),
            duration_sec=0.0,
            size_bytes=size,
        )

    try:
        duration = ffmpeg.probe_duration(final_path)
    except Exception as e:  # noqa: BLE001 — unprobeable = unpublishable
        return RenderReport(
            passed=False,
            issues=[f"rendered file is not a valid container: {e}"],
            final_path=str(final_path),
            duration_sec=0.0,
            size_bytes=final_path.stat().st_size,
        )

    if not ffmpeg.probe_has_audio(final_path):
        issues.append("rendered video has no audio stream")
    else:
        mean_db = ffmpeg.measure_mean_volume_db(final_path)
        if mean_db is not None and mean_db < MIN_MEAN_VOLUME_DB:
            issues.append(
                f"audio is effectively silent (mean {mean_db:.1f}dB "
                f"< {MIN_MEAN_VOLUME_DB}dB floor)"
            )

    # The narration must finish before the video does.
    try:
        vo_duration = ffmpeg.probe_duration(voiceover_path)
        if duration < vo_duration - VO_COVERAGE_SLACK_SEC:
            issues.append(
                f"video ({duration:.1f}s) ends before the voiceover "
                f"({vo_duration:.1f}s) — narration would be cut off"
            )
    except Exception as e:  # noqa: BLE001
        issues.append(f"could not probe voiceover for coverage check: {e}")

    if enforce_duration and target_duration_sec > 0:
        drift = abs(duration - target_duration_sec) / target_duration_sec
        if drift > DURATION_TOLERANCE:
            issues.append(
                f"real duration {duration:.1f}s is {drift:.0%} off the "
                f"{target_duration_sec}s target (limit {DURATION_TOLERANCE:.0%})"
            )

    # Upload budget: try to fix (re-encode) before failing.
    out_path = final_path
    size = final_path.stat().st_size
    if size > max_upload_bytes:
        fitted = final_path.with_name(final_path.stem + "_fit.mp4")
        try:
            ffmpeg.reencode_to_size(final_path, fitted, max_bytes=max_upload_bytes)
            new_size = fitted.stat().st_size
            if new_size > max_upload_bytes:
                issues.append(
                    f"re-encoded file still exceeds upload limit "
                    f"({new_size} > {max_upload_bytes} bytes)"
                )
            else:
                log.info(
                    "render re-encoded to fit upload limit",
                    extra={"from_bytes": size, "to_bytes": new_size},
                )
                out_path, size = fitted, new_size
        except Exception as e:  # noqa: BLE001
            issues.append(
                f"file exceeds upload limit ({size} > {max_upload_bytes} "
                f"bytes) and re-encode failed: {e}"
            )

    return RenderReport(
        passed=not issues,
        issues=issues,
        final_path=str(out_path),
        duration_sec=duration,
        size_bytes=size,
    )
