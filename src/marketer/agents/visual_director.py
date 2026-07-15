"""Visual director: enforces a single coherent visual style across scenes.

Runs AFTER the scriptwriter, rewrites `visual_prompt` and `motion_prompt`
fields with a unified style prefix and consistent character/setting tokens.
"""
from __future__ import annotations

from agents import Agent

from ..config import settings
from ..models import Script

VISUAL_DIRECTOR_INSTRUCTIONS = """You are a visual director.
Input is JSON: {"style": "<style brief>", "script": <Script>}.

Rewrite every scene's `visual_prompt` and `motion_prompt` so the resulting
video has a SINGLE, COHESIVE look that matches the supplied style.

Rules:
- Prefix every visual_prompt with the supplied style verbatim.
- If a recurring character appears, give them a fixed description repeated
  verbatim every scene (clothing, hair, build) so DALL-E renders consistently.
- Keep aspect ratio cues for 9:16 vertical.
- motion_prompts should be short (under 20 words), avoid contradictory
  motion (no "fast" + "slow"), and prefer one camera move OR one subject
  move per scene.
Do not change narration or duration_sec.
"""


def build_visual_director_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="VisualDirector",
        instructions=VISUAL_DIRECTOR_INSTRUCTIONS,
        output_type=Script,
    )
