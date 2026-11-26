"""Scriptwriter agent: turn an Idea into a scene-by-scene Script.

Each Scene carries (narration, visual_prompt, motion_prompt, duration_sec)
so downstream image + animation agents can run in parallel without a
re-planning step.
"""
from __future__ import annotations

import json

from pydantic import BaseModel

from agents import Agent

from ..config import settings
from ..models import Script
from ..services.spend_context import SpendContext  # noqa: TC001 — used in signature
from .metered import run_metered

SCRIPTWRITER_INSTRUCTIONS = """You are a short-form script director.
Convert the supplied Idea into a Script with N scenes targeting T seconds total.

PACING MATH (non-negotiable — the narration becomes real speech):
- Spoken voiceover runs ~2.6 words per second.
- For each scene: narration word count must be between
  2.0 x duration_sec and 3.2 x duration_sec words.
  (A 5s scene gets 10-16 words. Count them.)
- `duration_sec`: between 2.0 and 7.0. The sum across scenes must be
  within 10% of the target T.

RETENTION ARCHITECTURE:
- Scene 0: the hook, verbatim or tightened — plus an OPEN LOOP: name what
  the viewer gets by the end, don't deliver it yet.
- Middle scenes: exactly ONE concrete idea or step each. Escalate:
  each scene should be more specific or surprising than the last.
- Around the midpoint, insert a PATTERN RESET: a sharp question, a "but
  here's the part nobody mentions", or a stakes raise — something that
  re-earns attention.
- Final scene: close the open loop with the payoff. If a `cta` is used it
  must serve retention ("follow for part 2 where...") — never a generic
  "like and subscribe".

VISUALS:
- `visual_prompt`: a vivid, concrete prompt for a STILL keyframe.
  Consistent style across scenes. NEVER ask for text, words, numbers,
  labels, or captions in the image — captions are burned in separately
  and image models garble text.
- `motion_prompt`: under 20 words for an image-to-video model. One camera
  move OR one subject motion, subtle (push-in, parallax, gentle gesture).

Educational rules:
- Avoid filler. No "in this video we'll cover". No greetings.
- Speak directly to the viewer ("you"), present tense, concrete nouns.
"""


def build_scriptwriter_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="Scriptwriter",
        instructions=SCRIPTWRITER_INSTRUCTIONS,
        output_type=Script,
    )


# --- Hook rewrite (decision point 4, enforce only) ------------------------
# One bounded rewrite of the hook and scene 0 when the hook gate judges the
# hook weak. Runs at most once per script, before any visual or TTS spend.

HOOK_REWRITE_INSTRUCTIONS = """You tighten the opening of a short-form video.
Input is JSON: the idea, the current hook, scene 0's narration and duration.
Return a stronger hook and a rewritten scene 0 narration.

- The hook: under 12 words, a specific promise or a concrete number or
  outcome, no greeting or filler ("hey guys", "in this video", "today we").
- Scene 0 says the hook (verbatim or tightened) and opens a loop the rest of
  the video pays off. Keep the same topic and angle.
- Scene 0 narration must have between 2.0 x duration_sec and 3.2 x
  duration_sec words.
"""


class HookRewrite(BaseModel):
    hook: str
    scene0_narration: str


def build_hook_rewriter_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="HookRewriter",
        instructions=HOOK_REWRITE_INSTRUCTIONS,
        output_type=HookRewrite,
    )


async def rewrite_hook(script: Script, *, spend: SpendContext | None = None) -> Script | None:
    """A copy of *script* with a rewritten hook and scene 0, or None when the
    rewrite breaks scene 0's pacing band (word count is checked in code)."""
    if not script.scenes:
        return None
    scene0 = script.scenes[0]
    payload = {
        "idea": script.idea.model_dump(),
        "hook": script.idea.hook,
        "scene0_narration": scene0.narration,
        "duration_sec": scene0.duration_sec,
    }
    result = await run_metered(build_hook_rewriter_agent(), json.dumps(payload), spend=spend)
    out = result.final_output_as(HookRewrite)
    words = len(out.scene0_narration.split())
    if not (2.0 * scene0.duration_sec <= words <= 3.2 * scene0.duration_sec):
        return None
    scenes = [scene0.model_copy(update={"narration": out.scene0_narration}), *script.scenes[1:]]
    return script.model_copy(
        update={"idea": script.idea.model_copy(update={"hook": out.hook}), "scenes": scenes}
    )
