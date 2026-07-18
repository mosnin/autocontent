"""ffmpeg-based video assembly.

Three discrete functions, each shelling out to a single `ffmpeg`
invocation:

1. `concat_clips` — scale+pad each scene clip to the target aspect
   (9:16 → 1080x1920) and concat them into one silent mp4.
2. `mix_audio` — sidechain-duck the music against the VO, mix, and
   mux onto the silent video.
3. `burn_subtitles` — burn an ASS subtitle file into the final video.

All ffmpeg invocations go through the module-level `_run` so tests can
monkeypatch it and assert the constructed argv without spawning ffmpeg.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

ASPECT_DIMS: dict[str, tuple[int, int]] = {
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
    "1:1":  (1080, 1080),
}

# Extra freeze-frame tail (seconds) held after the narration ends when the
# voiceover outruns the assembled clips.
VO_TAIL_SEC = 0.4


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def _run_capture(cmd: list[str]) -> str:
    return subprocess.run(
        cmd, check=True, capture_output=True, text=True
    ).stdout


def _ffmpeg(args: list[str]) -> None:
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args])


def probe_duration(path: Path) -> float:
    """Container duration in seconds via ffprobe. Raises on unreadable files —
    a media file we can't probe is a media file we shouldn't publish."""
    out = _run_capture([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    return float(out.strip())


def measure_mean_volume_db(path: Path) -> float | None:
    """Mean loudness of the audio track in dBFS via the volumedetect
    filter. Returns None when ffmpeg emits no reading (e.g. no audio)."""
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats",
            "-i", str(path),
            "-map", "0:a:0",
            "-af", "volumedetect",
            "-f", "null", "-",
        ],
        check=False,  # missing audio stream is a finding, not a crash
        capture_output=True,
        text=True,
    )
    for line in proc.stderr.splitlines():
        if "mean_volume:" in line:
            try:
                return float(line.split("mean_volume:")[1].split("dB")[0].strip())
            except ValueError:
                return None
    return None


def probe_has_audio(path: Path) -> bool:
    """True when the container has at least one audio stream."""
    out = _run_capture([
        "ffprobe", "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ])
    return "audio" in out


def _resolve_dims(aspect: str) -> tuple[int, int]:
    try:
        return ASPECT_DIMS[aspect]
    except KeyError as e:
        raise ValueError(f"unsupported aspect {aspect!r}") from e


def concat_clips(clip_paths: list[Path], out_path: Path, aspect: str = "9:16") -> Path:
    """Scale+pad every input to `aspect` and concat into one silent mp4."""
    if not clip_paths:
        raise ValueError("concat_clips requires at least one clip")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = _resolve_dims(aspect)

    inputs: list[str] = []
    for p in clip_paths:
        inputs += ["-i", str(p)]

    n = len(clip_paths)
    chains: list[str] = []
    for i in range(n):
        chains.append(
            f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]"
        )
    concat_inputs = "".join(f"[v{i}]" for i in range(n))
    chains.append(f"{concat_inputs}concat=n={n}:v=1:a=0[out]")
    filter_complex = ";".join(chains)

    _ffmpeg([
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path


def mix_audio(
    video_path: Path,
    voiceover_path: Path,
    music_path: Path | None,
    out_path: Path,
    music_gain_db: float = -18.0,
) -> Path:
    """Mux VO (+ optional sidechain-ducked music) onto the silent video.

    When `music_path` is None the voiceover is copied directly as the
    audio track — the result is a valid mp4 with no background music.
    When music is provided it is attenuated to `music_gain_db` and ducked
    further whenever the VO is loud (sidechain compression), so the
    narration always sits clearly on top.

    Duration reconciliation: scene clip durations are int-rounded by the
    animation provider, so the assembled video can come out shorter than
    the narration. `-shortest` would then cut the VO mid-sentence. When
    the VO outruns the video we hold the last frame (`tpad` clone) for the
    difference plus a short tail so narration always finishes on screen.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)

    video_dur = probe_duration(video_path)
    vo_dur = probe_duration(voiceover_path)
    pad_sec = max(0.0, vo_dur - video_dur)
    if pad_sec > 0.05:
        pad_sec += VO_TAIL_SEC  # breathing room after the last word
        video_filter = f"[0:v]tpad=stop_mode=clone:stop_duration={pad_sec:.3f}[v]"
        video_map = "[v]"
        # tpad forces a re-encode; stream-copy is only possible untouched.
        video_codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    else:
        video_filter = None
        video_map = "0:v"
        video_codec = ["-c:v", "copy"]

    if music_path is None:
        filters = [video_filter] if video_filter else []
        args: list[str] = [
            "-i", str(video_path),
            "-i", str(voiceover_path),
        ]
        if filters:
            args += ["-filter_complex", ";".join(filters)]
        _ffmpeg([
            *args,
            "-map", video_map,
            "-map", "1:a",
            *video_codec,
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            str(out_path),
        ])
    else:
        audio_filter = (
            f"[2:a]volume={music_gain_db}dB[m];"
            "[m][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[mducked];"
            "[mducked][1:a]amix=inputs=2:duration=longest:dropout_transition=0[a]"
        )
        filter_complex = (
            f"{video_filter};{audio_filter}" if video_filter else audio_filter
        )
        _ffmpeg([
            "-i", str(video_path),
            "-i", str(voiceover_path),
            "-i", str(music_path),
            "-filter_complex", filter_complex,
            "-map", video_map,
            "-map", "[a]",
            *video_codec,
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            str(out_path),
        ])
    return out_path


def reencode_to_size(video_path: Path, out_path: Path, max_bytes: int) -> Path:
    """Re-encode so the output fits under `max_bytes` (upload limits).

    Computes a video bitrate from the container duration with an 8% mux
    safety margin and a fixed 128k audio budget, then runs a two-pass
    x264 encode — single-pass ABR overshoots on short clips, and this
    budget is a hard upload ceiling, not a target. Raises ValueError when
    the budget implies an unwatchably low bitrate — better to fail loudly
    than post mush.
    """
    duration = probe_duration(video_path)
    if duration <= 0:
        raise ValueError(f"cannot re-encode {video_path}: zero/unknown duration")
    audio_kbps = 128
    total_kbps = int((max_bytes * 8 / duration) / 1000 * 0.92)
    video_kbps = total_kbps - audio_kbps
    if video_kbps < 500:
        raise ValueError(
            f"size budget {max_bytes}B over {duration:.1f}s implies "
            f"{video_kbps}kbps video — too low to publish"
        )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    passlog = str(out_path.with_suffix(".passlog"))
    rate_args = [
        "-c:v", "libx264",
        "-b:v", f"{video_kbps}k",
        "-maxrate", f"{video_kbps}k",
        "-bufsize", f"{video_kbps * 2}k",
        "-pix_fmt", "yuv420p",
    ]
    _ffmpeg([
        "-i", str(video_path),
        *rate_args,
        "-pass", "1", "-passlogfile", passlog,
        "-an",
        "-f", "null", "/dev/null",
    ])
    _ffmpeg([
        "-i", str(video_path),
        *rate_args,
        "-pass", "2", "-passlogfile", passlog,
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", f"{audio_kbps}k",
        str(out_path),
    ])
    for leftover in out_path.parent.glob(out_path.stem + ".passlog*"):
        leftover.unlink(missing_ok=True)
    return out_path


def burn_subtitles(video_path: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn an ASS subtitle file into the video."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg([
        "-i", str(video_path),
        "-vf", f"ass={ass_path}",
        "-c:a", "copy",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_path),
    ])
    return out_path
