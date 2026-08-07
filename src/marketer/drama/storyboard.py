"""Storyboard stage: per-shot keyframe prompts, steered by the locked cast.

Two halves:

1. `design_storyboard` — one metered LLM call turning the screenplay (or a
   caller-supplied script) into exactly `shot_count` visual prompts. The
   locked cast is injected into the prompt verbatim so the model describes
   the SAME people it was told about rather than inventing new ones.

2. `render_keyframe` — the actual still for one shot. This is where character
   consistency is bought: the shot's primary character's LOCKED portrait is
   passed to gpt-image-1 as the reference image, so the render is an edit of
   that established face rather than a fresh interpretation of a text
   description. Shots with no cast member fall back to the niche style sheet,
   which keeps the art direction stable even in empty-frame shots.
"""
from __future__ import annotations

import json
from pathlib import Path

from agents import Agent

from ..agents.metered import run_metered
from ..config import settings
from ..models import Niche
from ..services import openai_images, provider_limits
from ..services.spend_context import SpendContext
from .schemas import (
    MAX_SHOT_SEC,
    MIN_SHOT_SEC,
    Character,
    Screenplay,
    Shot,
    StoryboardDraft,
    clamp_shot_count,
    merge_storyboard,
)

STORYBOARD_INSTRUCTIONS = f"""You are a storyboard artist and cinematographer
for vertical micro-drama.

Input is JSON: {{"screenplay", "shots", "cast", "shot_count", "aspect",
"visual_style"}}.

Return EXACTLY `shot_count` shots, indexed 0..shot_count-1, in story order.

If `shots` is non-empty it is the writer's shot list: keep its order,
sluglines, action, and dialogue, and only add the visual craft. If `shots` is
empty, break `screenplay` into `shot_count` filmable shots yourself.

For each shot:
- `visual_prompt`: a single still frame, 80-140 words. Location, time of day,
  lighting, lens/framing (wide / medium / close-up / over-the-shoulder),
  character placement, mood, palette. Open with the supplied `visual_style`
  verbatim. Compose for a {{aspect}} vertical frame.
- For every cast member present, repeat their `static_features` and
  `wardrobe` from `cast` VERBATIM inside `visual_prompt`. Never re-describe,
  age, undress, or re-style them; the same actor must be recognisable in
  every shot they appear in.
- `character_names`: exactly the cast names visible in the frame, spelled as
  they appear in `cast`.
- `motion_prompt`: under 20 words for an image-to-video model. ONE camera
  move OR one subject action. No contradictions ("slow fast push"), no cuts,
  no scene changes — a shot is one continuous move.
- `duration_sec`: {MIN_SHOT_SEC}-{MAX_SHOT_SEC}.

Hard bans: no on-screen text, captions, subtitles, signage, logos, numbers or
lettering of any kind — image models garble text and dialogue is delivered as
voiceover instead.
"""


# gpt-image-1 only renders three shapes; map the drama's aspect onto the
# nearest one so the keyframe isn't letterboxed twice (once by the image
# model, again by ffmpeg's scale+pad in the stitch).
_SIZE_BY_ASPECT = {
    "9:16": "1024x1536",
    "16:9": "1536x1024",
    "1:1": "1024x1024",
}


def size_for_aspect(aspect: str) -> str:
    return _SIZE_BY_ASPECT.get(aspect, openai_images.SIZE_9_16)


def build_storyboard_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="DramaStoryboardArtist",
        instructions=STORYBOARD_INSTRUCTIONS,
        output_type=StoryboardDraft,
    )


async def design_storyboard(
    screenplay: Screenplay,
    *,
    shots: list[Shot],
    cast: list[Character],
    shot_count: int,
    niche: Niche,
    aspect: str = "9:16",
    spend: SpendContext | None = None,
) -> list[Shot]:
    """One metered LLM call -> the shot list with visual/motion prompts."""
    shot_count = clamp_shot_count(shot_count)
    payload = {
        "screenplay": screenplay.as_prompt_text(),
        "shots": [
            {
                "index": s.index,
                "slugline": s.slugline,
                "action": s.action,
                "dialogue": s.dialogue,
                "character_names": [
                    c.name for c in cast if c.id in s.character_ids
                ],
                "duration_sec": s.duration_sec,
            }
            for s in shots
        ],
        "cast": [
            {
                "name": c.name,
                "role": c.role,
                "static_features": c.static_features,
                "wardrobe": c.wardrobe,
            }
            for c in cast
        ],
        "shot_count": shot_count,
        "aspect": aspect,
        "visual_style": niche.visual_style,
    }
    result = await run_metered(
        build_storyboard_agent(),
        json.dumps(payload),
        spend=spend,
        sku=f"llm:{settings.agent_model}:drama_storyboard",
    )
    draft = result.final_output_as(StoryboardDraft)
    return merge_storyboard(shots, draft, cast=cast, shot_count=shot_count)


def reference_for_shot(
    shot: Shot, *, cast: list[Character], fallback: Path | None
) -> Path | None:
    """The image reference that steers this shot.

    The first cast member in the shot who has a locked portrait wins. That
    biases consistency toward the shot's subject; gpt-image-1 takes a single
    reference, so a two-hander anchors on the lead and relies on the verbatim
    description of the other for the rest. When nobody is on screen (or a
    portrait is missing) we fall back to the niche style sheet so the LOOK
    stays consistent even when the CAST isn't in frame.
    """
    for cid in shot.character_ids:
        c = next((x for x in cast if x.id == cid and x.has_reference), None)
        if c is not None and c.reference_image_path:
            path = Path(c.reference_image_path)
            if path.exists():
                return path
    return fallback


def _keyframe_prompt(shot: Shot, *, cast: list[Character], niche: Niche) -> str:
    present = [c for c in cast if c.id in shot.character_ids]
    parts = [shot.visual_prompt]
    if present:
        # Repeated verbatim next to the reference image: the portrait pins the
        # face, this pins wardrobe/build for anyone the single reference image
        # can't cover.
        parts.append(
            "Characters in frame (render exactly as described): "
            + "; ".join(c.prompt_fragment() for c in present)
            + "."
        )
    parts.append(f"Art direction: {niche.visual_style}.")
    parts.append("No text, captions, subtitles, signage, or watermarks.")
    return " ".join(p for p in parts if p)


async def render_keyframe(
    shot: Shot,
    *,
    root: Path,
    cast: list[Character],
    niche: Niche,
    aspect: str = "9:16",
    style_reference: Path | None = None,
    spend: SpendContext | None = None,
) -> Path:
    """Render (or adopt) this shot's keyframe.

    An existing file is reused untouched — same resume economics as a locked
    portrait: a retry after a video-provider blip must not re-buy images that
    already rendered.
    """
    path = root / "keyframes" / f"shot_{shot.index:02d}.png"
    if path.exists():
        return path
    reference = reference_for_shot(shot, cast=cast, fallback=style_reference)
    async with provider_limits.slot("openai_images"):
        await openai_images.generate_keyframe(
            _keyframe_prompt(shot, cast=cast, niche=niche),
            path,
            quality=niche.image_quality,
            size=size_for_aspect(aspect),
            reference_image_path=reference,
            spend=spend,
        )
    return path
