"""Voice previews — fixes picking a TTS voice blind during onboarding.

The first request for a voice synthesizes a short sample line via the
existing OpenAI TTS service and caches the WAV on the assets volume;
every subsequent request is a plain file read. Costs a fraction of a
cent once per voice per deployment.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from autocontent.config import settings
from autocontent.services import openai_tts

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# Mirrors VOICE_OPTIONS in the onboarding wizard.
ALLOWED_VOICES = {
    "alloy", "echo", "fable", "onyx", "nova",
    "shimmer", "ash", "sage", "coral",
}

PREVIEW_LINE = (
    "This is how your channel will sound. Every video, every day, this voice."
)


def preview_path(voice: str) -> Path:
    return Path(settings.assets_dir) / "voice_previews" / f"{voice}.wav"


@router.get("/{voice}/preview")
async def voice_preview(voice: str, ctx: AuthCtx = CurrentUser) -> FileResponse:
    if voice not in ALLOWED_VOICES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="unknown voice")

    path = preview_path(voice)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            # No SpendContext: previews are an operator cost, not niche spend.
            await openai_tts.synthesize(PREVIEW_LINE, path, voice=voice)
        except Exception as e:  # noqa: BLE001 — surface as a clean 502
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail=f"voice preview synthesis failed: {e}",
            ) from e

    return FileResponse(path, media_type="audio/wav")
