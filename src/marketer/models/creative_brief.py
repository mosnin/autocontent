"""Creative DNA: the per-niche brief that makes every video bespoke.

Every field is optional and defaults to "no opinion" — an empty brief
produces exactly the platform's stock behavior, and each filled field
tightens creative control in one specific place:

- `hooks`      → ideation (and the tournament's candidate lenses)
- `narrative`  → scriptwriter (voice, pacing, language, CTA policy)
- `visual`     → visual director (camera, lighting, palette, bans)
- `audio`      → music selection + burned-caption styling
- `prompt_overrides` → verbatim extra instructions appended to a single
  agent's prompt — the power-user escape hatch when the structured
  fields aren't precise enough.

The brief is stored as JSONB on the niche row and validated here, so a
typo'd field name fails loudly at the API instead of silently steering
nothing.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

HOOK_MECHANISMS = (
    "curiosity_gap",
    "contrarian",
    "mistake_or_stakes",
    "story_cold_open",
    "bold_result",
    "myth_bust",
)

# Prompt fragment per mechanism — used as tournament lenses so candidate
# ideas compete across the user's own preferred hook space.
MECHANISM_LENSES: dict[str, str] = {
    "curiosity_gap": (
        "Hook mechanism for THIS attempt: a curiosity gap — open a specific "
        "question the viewer needs answered."
    ),
    "contrarian": (
        "Hook mechanism for THIS attempt: a contrarian claim — challenge "
        "something this audience believes."
    ),
    "mistake_or_stakes": (
        "Hook mechanism for THIS attempt: a costly mistake or hidden stakes — "
        "'you're losing X' / 'this breaks Y'."
    ),
    "story_cold_open": (
        "Hook mechanism for THIS attempt: a story cold-open — drop the viewer "
        "into the most dramatic second of a true, specific moment."
    ),
    "bold_result": (
        "Hook mechanism for THIS attempt: a bold, concrete result stated "
        "up front — numbers beat adjectives."
    ),
    "myth_bust": (
        "Hook mechanism for THIS attempt: bust a widely repeated myth this "
        "audience has heard a hundred times."
    ),
}


class HookBrief(BaseModel):
    model_config = {"extra": "forbid"}

    # Subset of HOOK_MECHANISMS; when set, tournament candidates compete
    # only across these.
    preferred_mechanisms: list[
        Literal[
            "curiosity_gap", "contrarian", "mistake_or_stakes",
            "story_cold_open", "bold_result", "myth_bust",
        ]
    ] = Field(default_factory=list)
    # Openers banned on top of the built-in list ("hey guys", ...).
    banned_openers: list[str] = Field(default_factory=list)
    # Hooks the user loves — the model emulates their voice, never copies.
    example_hooks: list[str] = Field(default_factory=list, max_length=10)


class NarrativeBrief(BaseModel):
    model_config = {"extra": "forbid"}

    # BCP-47-ish tag or plain name ("es", "Spanish"). Narration, hook, and
    # captions all follow it.
    language: str = ""
    pov: str = ""            # e.g. "first-person operator sharing war stories"
    pacing: str = ""         # e.g. "rapid-fire", "calm and deliberate"
    reading_level: str = ""  # e.g. "5th grade", "expert practitioner"
    cta_policy: str = ""     # e.g. "never", "only 'follow for part 2'"
    must_include: list[str] = Field(default_factory=list)
    must_avoid: list[str] = Field(default_factory=list)


class VisualBrief(BaseModel):
    model_config = {"extra": "forbid"}

    camera_language: str = ""   # e.g. "slow push-ins only, no whip pans"
    lighting: str = ""          # e.g. "golden hour, soft shadows"
    color_palette: str = ""     # e.g. "warm terracotta + cream, no neon"
    # Things that must never appear in a frame.
    negative_visuals: list[str] = Field(default_factory=list)


class CaptionStyle(BaseModel):
    model_config = {"extra": "forbid"}

    font: str = "Arial Black"
    font_size: int = Field(default=96, ge=40, le=160)
    # RRGGBB hex (no '#'), converted to ASS BGR at render time.
    text_hex: str = Field(default="FFFFFF", pattern=r"^[0-9a-fA-F]{6}$")
    outline_hex: str = Field(default="000000", pattern=r"^[0-9a-fA-F]{6}$")
    uppercase: bool = False
    position: Literal["bottom", "center", "top"] = "bottom"


class AudioBrief(BaseModel):
    model_config = {"extra": "forbid"}

    music_enabled: bool = True
    # Overrides the niche-title-derived music search ("lofi hip hop calm").
    music_mood: str = ""
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)


class PromptOverrides(BaseModel):
    """Verbatim extra instructions appended to one agent's prompt each.

    Bounded so a runaway paste can't blow the context (or the token bill)."""

    model_config = {"extra": "forbid"}

    ideation: str = Field(default="", max_length=2000)
    scriptwriter: str = Field(default="", max_length=2000)
    visual_director: str = Field(default="", max_length=2000)
    qa: str = Field(default="", max_length=2000)


class CreativeBrief(BaseModel):
    model_config = {"extra": "forbid"}

    hooks: HookBrief = Field(default_factory=HookBrief)
    narrative: NarrativeBrief = Field(default_factory=NarrativeBrief)
    visual: VisualBrief = Field(default_factory=VisualBrief)
    audio: AudioBrief = Field(default_factory=AudioBrief)
    prompt_overrides: PromptOverrides = Field(default_factory=PromptOverrides)

    def is_default(self) -> bool:
        return self == CreativeBrief()

    # ---------------------------------------------------------------- prompt fragments

    def ideation_lines(self) -> list[str]:
        """Extra prompt lines for the ideation agent."""
        lines: list[str] = []
        if self.narrative.language:
            lines.append(
                f"Write the hook and all Idea fields in: {self.narrative.language}."
            )
        if self.hooks.banned_openers:
            lines.append(
                "Additionally banned hook openers: "
                + ", ".join(f'"{b}"' for b in self.hooks.banned_openers)
            )
        if self.hooks.example_hooks:
            lines.append(
                "Hooks this creator loves — match their voice and energy "
                "WITHOUT copying them:\n- " + "\n- ".join(self.hooks.example_hooks)
            )
        if self.narrative.must_avoid:
            lines.append("Never touch these topics/angles: " + ", ".join(self.narrative.must_avoid))
        if self.prompt_overrides.ideation:
            lines.append(self.prompt_overrides.ideation)
        return lines

    def candidate_lenses(self) -> list[str]:
        """Tournament lenses restricted to the user's preferred mechanisms
        (empty = platform default set)."""
        return [
            MECHANISM_LENSES[m]
            for m in self.hooks.preferred_mechanisms
            if m in MECHANISM_LENSES
        ]

    def scriptwriter_lines(self) -> list[str]:
        n = self.narrative
        lines: list[str] = []
        if n.language:
            lines.append(
                f"Write ALL narration in {n.language} (visual/motion prompts stay in English)."
            )
        if n.pov:
            lines.append(f"Narrative point of view: {n.pov}.")
        if n.pacing:
            lines.append(f"Pacing: {n.pacing}.")
        if n.reading_level:
            lines.append(f"Write for this comprehension level: {n.reading_level}.")
        if n.cta_policy:
            lines.append(f"CTA policy (overrides defaults): {n.cta_policy}.")
        if n.must_include:
            lines.append("Must include: " + ", ".join(n.must_include))
        if n.must_avoid:
            lines.append("Must avoid: " + ", ".join(n.must_avoid))
        if self.prompt_overrides.scriptwriter:
            lines.append(self.prompt_overrides.scriptwriter)
        return lines

    def visual_director_brief(self) -> dict:
        """Structured block for the visual director payload (empty keys
        dropped so the model never sees blank constraints)."""
        v = self.visual
        out: dict = {}
        if v.camera_language:
            out["camera_language"] = v.camera_language
        if v.lighting:
            out["lighting"] = v.lighting
        if v.color_palette:
            out["color_palette"] = v.color_palette
        if v.negative_visuals:
            out["never_show"] = v.negative_visuals
        if self.prompt_overrides.visual_director:
            out["extra_instructions"] = self.prompt_overrides.visual_director
        return out

    def qa_lines(self) -> list[str]:
        lines: list[str] = []
        if self.narrative.language:
            lines.append(
                f"The narration is intentionally in {self.narrative.language} — "
                "do not flag the language as drift."
            )
        if self.narrative.must_avoid:
            lines.append(
                "Fail the video if it touches: " + ", ".join(self.narrative.must_avoid)
            )
        if self.prompt_overrides.qa:
            lines.append(self.prompt_overrides.qa)
        return lines
