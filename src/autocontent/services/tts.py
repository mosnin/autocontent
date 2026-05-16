"""OpenAI TTS voiceover generation."""
from __future__ import annotations

from pathlib import Path


async def synthesize(text: str, out_path: Path, voice: str = "onyx",
                     model: str = "tts-1-hd") -> Path:
    """Generate voiceover audio for the full script narration.

    TODO: implement with `openai.audio.speech.create(...)` streamed to disk.
    """
    raise NotImplementedError
