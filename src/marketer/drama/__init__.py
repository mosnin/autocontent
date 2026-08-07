"""Micro-Drama: multi-shot vertical shorts with a consistent recurring cast.

The distinguishing features versus the stock video pipeline are (a) a
screenplay/shot-list structure instead of hook + scene beats, and (b)
character consistency across shots via per-drama locked reference portraits.

Only the schemas are re-exported here. `pipeline.run_drama` and the agent
stages are imported directly (`from marketer.drama.pipeline import run_drama`)
so importing a schema never drags the Agents SDK, provider clients, or the DB
pool into a process that only needed a pydantic model — the FastAPI route
imports these models on every request.
"""
from __future__ import annotations

from .schemas import (
    Aspect,
    CastDraft,
    Character,
    CharacterDraft,
    Drama,
    DramaPlan,
    DramaStatus,
    Screenplay,
    ScreenplayDraft,
    Shot,
    ShotDraft,
    ShotPromptDraft,
    StoryboardDraft,
    clamp_shot_count,
)

__all__ = [
    "Aspect",
    "CastDraft",
    "Character",
    "CharacterDraft",
    "Drama",
    "DramaPlan",
    "DramaStatus",
    "Screenplay",
    "ScreenplayDraft",
    "Shot",
    "ShotDraft",
    "ShotPromptDraft",
    "StoryboardDraft",
    "clamp_shot_count",
]
