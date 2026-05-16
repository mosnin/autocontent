"""ffmpeg-based video assembly.

Two-pass approach:
  1. Concatenate scene clips into a single silent video matched to VO duration.
  2. Mix VO + ducked music, burn ASS subtitles, encode final mp4.
"""
from __future__ import annotations

from pathlib import Path


def concat_clips(clip_paths: list[Path], out_path: Path, aspect: str = "9:16") -> Path:
    """Concatenate clips (scaled/padded to aspect) into a single silent mp4.

    TODO: build a concat demuxer file or use `-filter_complex` for scale+pad+concat.
    """
    raise NotImplementedError


def mix_audio(video_path: Path, voiceover_path: Path, music_path: Path,
              out_path: Path, music_gain_db: float = -18.0) -> Path:
    """Mux VO + sidechain-ducked music onto the video.

    TODO: filter_complex with `sidechaincompress` (music keyed by VO) + `amix`.
    """
    raise NotImplementedError


def burn_subtitles(video_path: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn ASS subtitles into the video.

    TODO: `-vf "ass=<ass_path>"`.
    """
    raise NotImplementedError
