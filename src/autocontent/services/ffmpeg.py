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


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def _ffmpeg(args: list[str]) -> None:
    _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args])


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
    music_path: Path,
    out_path: Path,
    music_gain_db: float = -18.0,
) -> Path:
    """Mux VO + sidechain-ducked music onto the silent video.

    Music is attenuated to `music_gain_db` and then ducked further
    whenever the VO is loud (sidechain compression), so the narration
    always sits clearly on top.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    filter_complex = (
        f"[2:a]volume={music_gain_db}dB[m];"
        "[m][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[mducked];"
        "[mducked][1:a]amix=inputs=2:duration=longest:dropout_transition=0[a]"
    )
    _ffmpeg([
        "-i", str(video_path),
        "-i", str(voiceover_path),
        "-i", str(music_path),
        "-filter_complex", filter_complex,
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(out_path),
    ])
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
