"""Scriptwriter agent: turn an Idea into a scene-by-scene Script.

Each Scene carries (narration, visual_prompt, motion_prompt, duration_sec)
so downstream image + animation agents can run in parallel without a
re-planning step.
"""
from __future__ import annotations

from agents import Agent

from ..config import settings
from ..models import Script

SCRIPTWRITER_INSTRUCTIONS = """You are a short-form script director.
Convert the supplied Idea into a Script with N scenes targeting T seconds total.

Constraints per scene:
- `narration`: spoken-word, conversational, 1-2 sentences. Hook lives in scene 0.
- `visual_prompt`: a vivid, concrete DALL-E 3 prompt for a STILL keyframe.
  Specify style ("3D claymation", "isometric infographic", "cinematic photo",
  etc.) consistently across scenes for visual cohesion.
- `motion_prompt`: a short instruction for an image-to-video model
  (Grok Imagine) describing camera move + subject motion. Keep motion subtle —
  push-in, parallax, gentle hand gesture — not chaotic.
- `duration_sec`: between 2.0 and 7.0. Sum must equal target.

Educational rules:
- Each scene should teach ONE concrete idea or step.
- Avoid filler. No "in this video we'll cover".
- End with `cta` only if it serves retention (e.g. "follow for part 2").
"""


def build_scriptwriter_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="Scriptwriter",
        instructions=SCRIPTWRITER_INSTRUCTIONS,
        output_type=Script,
    )
