"""Caption generation via Whisper, burned into video via ffmpeg."""
from __future__ import annotations

from pathlib import Path


async def transcribe_word_level(audio_path: Path) -> list[dict]:
    """Run Whisper with word-level timestamps. Returns a list of
    {"word": str, "start": float, "end": float} dicts.

    TODO: implement with `openai.audio.transcriptions.create(model="whisper-1",
      response_format="verbose_json", timestamp_granularities=["word"])`.
    """
    raise NotImplementedError


def words_to_ass(words: list[dict], out_path: Path, style: str = "tiktok-bold") -> Path:
    """Render word-level timings into an .ass subtitle file with karaoke-style
    word pop (one or two words on screen at a time, large bottom-center).

    TODO: emit ASS with `\\k` tags or per-word Dialogue lines.
    """
    raise NotImplementedError
