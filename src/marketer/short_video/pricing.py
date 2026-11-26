"""Cost estimates for a short-video batch, in integer micro-dollars.

Built from the pricing tables the providers' clients already use, so the
estimate and the metered cost come from the same numbers. Stock footage and
uploads are free. The estimate is shown before anything runs and sets the
default batch cap (1.5x).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..services import elevenlabs_tts, music_gen
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, tts_cost_estimated, whisper_cost
from .metering import usd_to_micros
from .models import APPROVAL_ESTIMATE_MICROS, APPROVAL_VARIANTS, ShortVideoRequest

# Spoken English runs at about 15 characters a second.
CHARS_PER_SECOND = 15
DEFAULT_CAP_FACTOR = 1.5


@dataclass(frozen=True)
class Estimate:
    per_variant_micros: int
    total_micros: int
    cap_micros: int
    needs_approval: bool
    lines: dict[str, int] = field(default_factory=dict)


def _chars(req: ShortVideoRequest) -> int:
    if req.source == "script":
        return len(req.script)
    return req.settings.look.duration_sec * CHARS_PER_SECOND


def per_variant_lines(req: ShortVideoRequest) -> dict[str, int]:
    s = req.settings
    seconds = s.look.duration_sec if req.source == "topic" else max(5, len(req.script) // CHARS_PER_SECOND)
    lines: dict[str, int] = {}
    if req.source == "topic":
        lines["script"] = usd_to_micros(LLM_CALL_ESTIMATE_USD)
    chars = _chars(req)
    if s.look.voice_provider == "elevenlabs":
        lines["voice"] = usd_to_micros(elevenlabs_tts.tts_cost(chars))
    else:
        lines["voice"] = usd_to_micros(tts_cost_estimated(chars))
    lines["timing"] = usd_to_micros(whisper_cost(seconds))
    if s.music.mode == "generated":
        lines["music"] = usd_to_micros(music_gen.music_cost(max(10, seconds)))
    return lines


def estimate(req: ShortVideoRequest) -> Estimate:
    lines = per_variant_lines(req)
    per = sum(lines.values())
    total = per * req.variants
    cap = usd_to_micros(req.cap_usd) if req.cap_usd is not None else max(int(total * DEFAULT_CAP_FACTOR), 100_000)
    needs = req.variants > APPROVAL_VARIANTS or total > APPROVAL_ESTIMATE_MICROS
    return Estimate(per_variant_micros=per, total_micros=total, cap_micros=cap, needs_approval=needs, lines=lines)
