"""Visual director: enforces a single coherent visual style across scenes.

Runs AFTER the scriptwriter, rewrites `visual_prompt` and `motion_prompt`
fields with a unified style prefix and consistent character/setting tokens.
"""
from __future__ import annotations

from agents import Agent

from ..config import settings
from ..models import Script
from ..models.creative_brief import CreativeBrief
from ..jev.planner import MOTION_PROMPT_MIN, VISUAL_PROMPT_MIN

_MOTIONS = (
    "slow push-in on the subject",
    "gentle parallax across the desk",
    "subtle handheld drift to the right",
    "slow pull-back revealing the setup",
    "soft tilt up across the object",
)


def should_template_visuals(
    *,
    brief: CreativeBrief | None = None,
    design_kit: str = "",
) -> bool:
    """True when a deterministic style stamp is enough.

    A filled design kit or visual brief still buys the LLM. Empty
    defaults must not — scriptwriter already emitted still + motion.
    """
    if (design_kit or "").strip():
        return False
    if brief is not None and brief.visual_director_brief():
        return False
    return True


def template_visual_director(
    script: Script,
    *,
    visual_style: str,
    character_description: str = "",
) -> Script:
    """Stamp style + fill short prompts. Never rewrite narration.

    Used when every scene is missing a usable still/motion pair and the
    operator did not pin a design kit or visual brief. No invented stats.
    """
    style = (
        (visual_style or "").strip()
        or "clean editorial still, soft daylight, 9:16 vertical"
    )
    idea = getattr(script, "idea", None)
    subject = (getattr(idea, "topic", "") or "").strip() or "the subject"
    cast = (character_description or "").strip()
    scenes = []
    for i, scene in enumerate(script.scenes or []):
        visual = (scene.visual_prompt or "").strip()
        motion = (scene.motion_prompt or "").strip()
        if len(visual) < VISUAL_PROMPT_MIN:
            visual = (
                f"{style}. Concrete still of {subject} as a physical object, "
                "9:16 vertical, no text, no words, no numbers, no labels, "
                "no captions."
            )
        else:
            if style.casefold() not in visual.casefold():
                visual = f"{style}. {visual}"
            if "no text" not in visual.casefold():
                visual = (
                    f"{visual.rstrip('.')}. No text, no words, no numbers, "
                    "no labels, no captions."
                )
            if "9:16" not in visual and "vertical" not in visual.casefold():
                visual = f"{visual.rstrip('.')}. 9:16 vertical."
        if cast and cast.casefold() not in visual.casefold():
            visual = f"{visual.rstrip('.')}. {cast}."
        if len(motion) < MOTION_PROMPT_MIN:
            motion = _MOTIONS[i % len(_MOTIONS)]
        scenes.append(
            scene.model_copy(update={"visual_prompt": visual, "motion_prompt": motion})
        )
    return script.model_copy(update={"scenes": scenes})

VISUAL_DIRECTOR_INSTRUCTIONS = """You are a visual director.
Input is JSON: {"style": "<style brief>", "character": "<canonical cast or empty>",
"script": <Script>, "creative_brief": <optional constraints>,
"design_kit": <optional direction system>}.

When `design_kit` is present it is the creator's personal direction
system — shot grammar, transitions, framing habits, signature touches.
Apply it to every scene as if the creator were directing over your
shoulder. Precedence on conflict: creative_brief `never_show` and
`cast_mode` are ABSOLUTE and outrank everything, including design_kit;
otherwise design_kit > creative_brief > these defaults.

When `creative_brief` is present, obey every key it contains:
- `cast_mode: "none"`: this video has NO characters at all. Never
  introduce a person, mascot, or creature. Instead, pick the video's
  SUBJECT (the object/environment the idea is about — e.g. "a single
  white paper airplane with a creased left wing") and repeat that exact
  subject description verbatim in every scene so the subject stays
  identical across shots. Continuity lives in the subject, light, and
  palette, not a cast.
- `camera_language`: the ONLY camera moves allowed in motion_prompts.
- `lighting` / `color_palette`: bake into every visual_prompt verbatim.
- `never_show`: hard bans — rewrite any scene that would show one.
- `extra_instructions`: verbatim directives from the creator; they win
  over these defaults on any conflict.

Rewrite every scene's `visual_prompt` and `motion_prompt` so the resulting
video has a SINGLE, COHESIVE look that matches the supplied style.

Rules:
- Prefix every visual_prompt with the supplied style verbatim.
- When `character` is non-empty it is the CANONICAL cast (it matches a
  reference sheet the image model receives): repeat that description
  verbatim in every scene that shows a character. Never invent a
  different protagonist or change their wardrobe/species/build.
- When `character` is empty and a recurring character appears, write one
  fixed description yourself and repeat it verbatim every scene.
- NEVER request text, words, numbers, labels, signage, or captions inside
  the image — captions are burned in separately and image models garble
  text. Rewrite any such request into a purely pictorial equivalent.
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
