"""ffmpeg for short video: render slices, concat, mix, burn subtitles.

Every function builds an argv (pure, tested) and runs it through
``services.ffmpeg._ffmpeg`` so tests can capture commands without spawning
ffmpeg, the same seam the playbook pipeline uses. The fit and fade choices
mirror MoneyPrinterTurbo's ``_fit_clip_to_canvas`` and transitions (MIT,
Copyright (c) 2024 Harry), expressed as ffmpeg filters instead of moviepy.
"""
from __future__ import annotations

from pathlib import Path

from ..services import ffmpeg as ff
from .edit_plan import Slice

FPS = 30
FADE_MAX_SEC = 0.5
VO_TAIL_SEC = 0.4

CANVAS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}


def dims(aspect: str) -> tuple[int, int]:
    try:
        return CANVAS[aspect]
    except KeyError as e:
        raise ValueError(f"unsupported aspect {aspect!r}") from e


def fit_filter(w: int, h: int, fit: str) -> str:
    if fit == "letterbox":
        return f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    if fit == "crop":
        return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"
    raise ValueError(f"unknown fit {fit!r}")


def fade_filters(transition: str, out_len: float) -> list[str]:
    d = round(min(FADE_MAX_SEC, out_len / 3), 3)
    if d <= 0:
        return []
    out: list[str] = []
    if transition in ("fade", "fade_in"):
        out.append(f"fade=t=in:st=0:d={d}")
    if transition in ("fade", "fade_out"):
        out.append(f"fade=t=out:st={round(out_len - d, 3)}:d={d}")
    return out


def slice_argv(s: Slice, out_path: Path, *, aspect: str, fit: str) -> list[str]:
    w, h = dims(aspect)
    if s.kind == "image":
        frames = max(1, int(round(s.out_len * FPS)))
        # Slow push-in so a still reads as footage (MoneyPrinterTurbo's "slow zoom").
        chain = [
            fit_filter(w, h, fit),
            f"zoompan=z='min(zoom+0.0008,1.12)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={FPS}",
            *fade_filters(s.transition, s.out_len),
            "format=yuv420p",
        ]
        inputs = ["-loop", "1", "-t", f"{s.out_len:.3f}", "-i", s.path]
    else:
        speed = s.source_len / s.out_len if s.out_len > 0 else 1.0
        chain = []
        if abs(speed - 1.0) > 1e-3:
            chain.append(f"setpts=PTS/{speed:.4f}")
        chain += [fit_filter(w, h, fit), f"fps={FPS}", *fade_filters(s.transition, s.out_len), "format=yuv420p"]
        inputs = ["-ss", f"{s.start:.3f}", "-t", f"{s.source_len:.3f}", "-i", s.path]
    return [
        *inputs,
        "-vf", ",".join(chain),
        "-t", f"{s.out_len:.3f}",
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-r", str(FPS),
        str(out_path),
    ]


def concat_argv(list_file: Path, out_path: Path, *, duration: float) -> list[str]:
    return [
        "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c", "copy", "-t", f"{duration:.3f}", "-movflags", "+faststart",
        str(out_path),
    ]


def mix_argv(
    video: Path, voice: Path, music: Path | None, out_path: Path, *,
    duration: float, volume_db: float, duck: bool,
) -> list[str]:
    """Voice on top; music looped under it at ``volume_db`` and, with ``duck``,
    pushed further down while the voice speaks (sidechain compression)."""
    args = ["-i", str(video), "-i", str(voice)]
    if music is None:
        return [*args, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", f"{duration:.3f}", str(out_path)]
    args += ["-stream_loop", "-1", "-i", str(music)]
    if duck:
        audio = (
            f"[2:a]volume={volume_db}dB[m];"
            "[m][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[md];"
            "[md][1:a]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]"
        )
    else:
        audio = (
            f"[2:a]volume={volume_db}dB[m];"
            "[m][1:a]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]"
        )
    return [*args, "-filter_complex", audio, "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}", str(out_path)]


def burn_argv(video: Path, ass: Path, out_path: Path) -> list[str]:
    escaped = str(ass).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return ["-i", str(video), "-vf", f"ass='{escaped}'", "-c:a", "copy", "-c:v", "libx264",
            "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)]


# ------------------------------------------------------------------- runners

def render_slices(slices: list[Slice], workdir: Path, *, aspect: str, fit: str) -> list[Path]:
    workdir.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    cache: dict[tuple, Path] = {}
    for i, s in enumerate(slices):
        key = (s.path, s.start, s.source_len, s.out_len, s.transition)
        if key in cache:  # a looped slice is encoded once
            out.append(cache[key])
            continue
        p = workdir / f"slice_{i:03d}.mp4"
        ff._ffmpeg(slice_argv(s, p, aspect=aspect, fit=fit))
        cache[key] = p
        out.append(p)
    return out


def concat(paths: list[Path], out_path: Path, *, duration: float) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    list_file = out_path.with_suffix(".txt")
    list_file.write_text("".join(f"file '{p.resolve()}'\n" for p in paths), encoding="utf-8")
    ff._ffmpeg(concat_argv(list_file, out_path, duration=duration))
    return out_path


def mix(video: Path, voice: Path, music: Path | None, out_path: Path, *, duration: float, volume_db: float, duck: bool) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ff._ffmpeg(mix_argv(video, voice, music, out_path, duration=duration, volume_db=volume_db, duck=duck))
    return out_path


def burn(video: Path, ass: Path, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ff._ffmpeg(burn_argv(video, ass, out_path))
    return out_path
