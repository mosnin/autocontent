"""Schemas for the Micro-Drama product.

A micro-drama is a multi-shot vertical short with a *screenplay* structure
(title / logline / beats / shot list) and, crucially, a **recurring cast**
that must look identical in every shot. That's the whole reason this lives
next to — rather than inside — the hook+scene-beat video pipeline:

- the video pipeline's continuity anchor is a per-NICHE character sheet
  that persists across jobs;
- a drama's continuity anchor is a per-DRAMA cast: each character gets one
  reference portrait that is generated ONCE and then reused as the image
  reference for every shot the character appears in. Regenerating a
  portrait mid-run would silently re-cast the actor halfway through the
  film, so a locked portrait is never re-bought (see `characters.py`).

Two families of models live here:

1. *Drafts* — the typed outputs the Agents-SDK stages return. They carry no
   filesystem state, so an LLM never has to emit (or hallucinate) a path.
2. *Persisted* models — `Character` / `Shot` / `Screenplay` / `DramaPlan`
   plus the `Drama` row. `DramaPlan` is the resume checkpoint: it is written
   back to `micro_dramas.plan` after every stage so a retry can tell exactly
   which screenplay, which portraits, and which clips were already paid for.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# A drama is expensive: every shot costs one image generation AND one video
# generation. The shot list is hard-bounded here (not just in the prompt)
# because an LLM that returns 40 shots would otherwise turn one API call
# into ~80 provider calls before the daily cap could react.
MIN_SHOTS = 2
MAX_SHOTS = 12
DEFAULT_SHOTS = 6

# Likewise for the cast: each character costs one locked portrait, and a
# 12-person ensemble in a 60-second short is a spend bug, not a drama.
MAX_CAST = 5

# Clip length bounds — the i2v providers top out around 10s per clip.
MIN_SHOT_SEC = 2.0
MAX_SHOT_SEC = 8.0

Aspect = Literal["9:16", "16:9", "1:1"]


def clamp_shot_count(value: int) -> int:
    return max(MIN_SHOTS, min(MAX_SHOTS, int(value)))


def clamp_duration(value: float) -> float:
    return max(MIN_SHOT_SEC, min(MAX_SHOT_SEC, float(value)))


def character_id(name: str) -> str:
    """Stable slug id for a character.

    Derived from the name rather than a random uuid so the id survives a
    resume: the portrait file on the volume is `<character_id>.png`, and a
    retry must map the same character back onto the same already-paid file.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "character"


class DramaStatus(str, Enum):
    queued = "queued"
    screenwriting = "screenwriting"
    casting = "casting"
    storyboarding = "storyboarding"
    rendering = "rendering"
    editing = "editing"
    done = "done"
    failed = "failed"


# --------------------------------------------------------------------------
# Agent outputs (drafts) — no filesystem state.
# --------------------------------------------------------------------------


class ShotDraft(BaseModel):
    """One shot as the screenwriter conceives it (story, not pixels)."""

    index: int
    slugline: str = Field(description="INT./EXT. LOCATION - TIME, screenplay style")
    action: str = Field(description="What physically happens in this shot")
    character_names: list[str] = Field(
        default_factory=list, description="Cast members visible in this shot"
    )
    dialogue: str = Field(default="", description="Spoken line, empty when silent")
    duration_sec: float = 5.0


class ScreenplayDraft(BaseModel):
    title: str
    logline: str
    beats: list[str] = Field(default_factory=list)
    shots: list[ShotDraft] = Field(default_factory=list)


class CharacterDraft(BaseModel):
    name: str
    role: str = ""
    static_features: str = Field(
        description="Unchanging physique: age, build, face, hair. Must be "
        "detailed enough to regenerate the same person."
    )
    wardrobe: str = Field(default="", description="Outfit worn throughout the drama")


class CastDraft(BaseModel):
    characters: list[CharacterDraft] = Field(default_factory=list)


class ShotPromptDraft(BaseModel):
    """One shot as the storyboard artist renders it (pixels, not story)."""

    index: int
    slugline: str = ""
    action: str = ""
    character_names: list[str] = Field(default_factory=list)
    visual_prompt: str = Field(description="Prompt for the still keyframe")
    motion_prompt: str = Field(description="Under 20 words, one camera or subject move")
    dialogue: str = ""
    duration_sec: float = 5.0


class StoryboardDraft(BaseModel):
    shots: list[ShotPromptDraft] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Persisted models.
# --------------------------------------------------------------------------


class Character(BaseModel):
    id: str
    name: str
    role: str = ""
    static_features: str = ""
    wardrobe: str = ""
    # Path on the artifacts volume. Set exactly once, by the casting stage.
    reference_image_path: str | None = None

    @property
    def has_reference(self) -> bool:
        return bool(self.reference_image_path)

    def prompt_fragment(self) -> str:
        """The verbatim block repeated into every shot prompt this character
        appears in. Repetition is the cheap half of consistency; the locked
        portrait handed to the image model is the expensive half."""
        parts = [f"{self.name}: {self.static_features}".strip().rstrip(":")]
        if self.wardrobe:
            parts.append(f"wearing {self.wardrobe}")
        return ", ".join(p for p in parts if p)


class Shot(BaseModel):
    index: int
    slugline: str = ""
    action: str = ""
    dialogue: str = ""
    character_ids: list[str] = Field(default_factory=list)
    # Empty until the storyboard stage runs — that emptiness IS the resume
    # signal (see pipeline._needs_storyboard).
    visual_prompt: str = ""
    motion_prompt: str = ""
    duration_sec: float = 5.0
    keyframe_path: str | None = None
    clip_path: str | None = None

    @property
    def has_prompts(self) -> bool:
        return bool(self.visual_prompt)

    @property
    def is_rendered(self) -> bool:
        return bool(self.clip_path)


class Screenplay(BaseModel):
    title: str = ""
    logline: str = ""
    beats: list[str] = Field(default_factory=list)
    # 'idea' = written by the screenwriter agent; 'script' = supplied by the
    # caller, which skips (and never re-buys) that stage entirely.
    source: Literal["idea", "script"] = "idea"
    script_text: str = ""

    def as_prompt_text(self) -> str:
        """Flat text handed to the casting + storyboard stages."""
        if self.source == "script" and self.script_text:
            return self.script_text
        lines = []
        if self.title:
            lines.append(f"TITLE: {self.title}")
        if self.logline:
            lines.append(f"LOGLINE: {self.logline}")
        lines.extend(self.beats)
        return "\n".join(lines)


class DramaPlan(BaseModel):
    """The resume checkpoint. Persisted to `micro_dramas.plan` after every
    stage so a transient provider failure on a later stage never re-buys an
    earlier one."""

    screenplay: Screenplay | None = None
    cast: list[Character] = Field(default_factory=list)
    shots: list[Shot] = Field(default_factory=list)
    voiceover_path: str | None = None

    def character_by_id(self, character_id_: str) -> Character | None:
        return next((c for c in self.cast if c.id == character_id_), None)

    def characters_in(self, shot: Shot) -> list[Character]:
        found = [self.character_by_id(cid) for cid in shot.character_ids]
        return [c for c in found if c is not None]

    @property
    def rendered_shots(self) -> list[Shot]:
        return [s for s in self.shots if s.is_rendered]

    @property
    def dialogue_text(self) -> str:
        return " ".join(s.dialogue.strip() for s in self.shots if s.dialogue.strip())


class Drama(BaseModel):
    """The `micro_dramas` row."""

    id: UUID
    user_id: str
    niche_id: UUID
    status: DramaStatus = DramaStatus.queued
    idea: str = ""
    script: str = ""
    shot_count: int = DEFAULT_SHOTS
    aspect: Aspect = "9:16"
    plan: DramaPlan = Field(default_factory=DramaPlan)
    video_path: str | None = None
    duration_sec: float | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = None


# --------------------------------------------------------------------------
# Draft -> persisted conversions.
# --------------------------------------------------------------------------


def cast_from_draft(draft: CastDraft, *, max_cast: int = MAX_CAST) -> list[Character]:
    """Bounded, de-duplicated cast. Two drafts of the same name collapse to
    one character so we never buy two portraits for one actor."""
    out: list[Character] = []
    seen: set[str] = set()
    for c in draft.characters:
        cid = character_id(c.name)
        if not c.name.strip() or cid in seen:
            continue
        seen.add(cid)
        out.append(
            Character(
                id=cid,
                name=c.name.strip(),
                role=c.role,
                static_features=c.static_features,
                wardrobe=c.wardrobe,
            )
        )
        if len(out) >= max_cast:
            break
    return out


def shots_from_screenplay(draft: ScreenplayDraft, *, shot_count: int) -> list[Shot]:
    """Story-level shots, re-indexed 0..n-1 and hard-truncated to the
    requested count (the model's own count is advisory — spend is not)."""
    shots: list[Shot] = []
    for i, s in enumerate(draft.shots[:shot_count]):
        shots.append(
            Shot(
                index=i,
                slugline=s.slugline,
                action=s.action,
                dialogue=s.dialogue,
                character_ids=[character_id(n) for n in s.character_names if n.strip()],
                duration_sec=clamp_duration(s.duration_sec),
            )
        )
    return shots


def merge_storyboard(
    shots: list[Shot],
    draft: StoryboardDraft,
    *,
    cast: list[Character],
    shot_count: int,
) -> list[Shot]:
    """Fold storyboard prompts into the (possibly empty) story shot list.

    When the drama started from a supplied script there are no story shots
    yet, so the storyboard's own shots become the list. When the screenwriter
    already produced shots, only the visual fields are overwritten — the
    dialogue and slugline stay as written so the VO track keeps matching.
    """
    known = {c.id for c in cast}
    by_index = {s.index: s for s in shots}
    limit = min(len(shots) or clamp_shot_count(shot_count), clamp_shot_count(shot_count))
    merged: list[Shot] = []
    for i, d in enumerate(sorted(draft.shots, key=lambda s: s.index)[:limit]):
        base = by_index.get(d.index) or by_index.get(i) or Shot(index=i)
        ids = base.character_ids or [
            character_id(n) for n in d.character_names if n.strip()
        ]
        merged.append(
            base.model_copy(
                update={
                    "index": i,
                    "slugline": base.slugline or d.slugline,
                    "action": base.action or d.action,
                    "dialogue": base.dialogue or d.dialogue,
                    # Drop hallucinated cast members: an id with no locked
                    # portrait would silently disable character steering.
                    "character_ids": [c for c in ids if c in known],
                    "visual_prompt": d.visual_prompt,
                    "motion_prompt": d.motion_prompt,
                    "duration_sec": clamp_duration(d.duration_sec or base.duration_sec),
                }
            )
        )
    return merged
