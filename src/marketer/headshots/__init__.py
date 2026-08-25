"""Headshot / Portrait Studio.

Upload one or more photos of a person, pick a professional style, get a
batch of consistent on-style portraits. The portraits land in the media
library, where they become the founder/team/spokesperson imagery the
video, article, and UGC lanes reuse instead of stock photography.

Ported from SamurAI's `ai-headshot-generator`, but only its *idea*: the
source delegates everything to a third-party "photo pack" endpoint and
ships a 30+ entry category list that mixes professional headshots with
dating-app packs, fictional genres, and occupational costumes. We keep
the studio and rebuild the catalog — see `styles.py` for why the
occupational and fantasy categories are deliberately absent.

Layering, so the pieces stay testable in isolation:

    styles.py    pure data — the catalog, no I/O
    prompts.py   pure functions — style + subject -> final prompt
    pipeline.py  orchestration — storage, metering, bounded fan-out
"""
from __future__ import annotations

from .prompts import IDENTITY_RULES, build_variant_prompt
from .styles import (
    STYLE_KEYS,
    STYLES,
    HeadshotStyle,
    UnknownStyleError,
    get_style,
    list_styles,
)

__all__ = [
    "IDENTITY_RULES",
    "STYLES",
    "STYLE_KEYS",
    "HeadshotStyle",
    "UnknownStyleError",
    "build_variant_prompt",
    "get_style",
    "list_styles",
]
