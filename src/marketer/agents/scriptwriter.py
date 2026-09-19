"""Scriptwriter agent: turn an Idea into a scene-by-scene Script.

Each Scene carries (narration, visual_prompt, motion_prompt, duration_sec)
so downstream image + animation agents can run in parallel without a
re-planning step.
"""
from __future__ import annotations

from agents import Agent

from ..config import settings
from ..models import Idea, Scene, Script
from ..models.creative_brief import CreativeBrief

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
- Never invent studies, percentages, dollar figures, or citation years.
  If a number is not in the brief, speak qualitatively.
"""

_WORDS_PER_SEC = 2.6
_DURATION_MIN = 2.0
_DURATION_MAX = 7.0
_SCENE_CAP = 12
# Qualitative pad only — no %, $, or years. Fact-lock stays a no-op.
_PAD = (
    "right now this week start here do this next stay with this "
    "keep it simple make it concrete skip the extra steps "
    "focus on the next move you can use today"
).split()
_MOTIONS = (
    "slow push-in on the subject",
    "gentle parallax across the desk",
    "subtle handheld drift to the right",
    "slow pull-back revealing the setup",
    "soft tilt up across the object",
)


def should_template_script(
    *,
    script_model: str = "",
    brief: CreativeBrief | None = None,
) -> bool:
    """True when a deterministic script is enough.

    An operator-pinned writer model or a narrative brief still buys the
    LLM. Empty defaults must not.
    """
    if (script_model or "").strip():
        return False
    if brief is not None and brief.scriptwriter_lines():
        return False
    return True


def _fit_words(text: str, count: int) -> str:
    words = [w for w in (text or "").split() if w]
    if not words:
        words = ["Stay", "with", "this"]
    if len(words) >= count:
        return " ".join(words[:count])
    out = list(words)
    i = 0
    while len(out) < count:
        out.append(_PAD[i % len(_PAD)])
        i += 1
    return " ".join(out)


def _scene_count(scene_count: int, target_duration_sec: int) -> tuple[int, float]:
    n = max(1, min(_SCENE_CAP, int(scene_count or 1)))
    t = max(8, int(target_duration_sec or 15))
    if n * _DURATION_MAX < t * 0.9:
        n = min(_SCENE_CAP, max(n, int((t * 0.9 + _DURATION_MAX - 0.01) // _DURATION_MAX)))
    if n * _DURATION_MIN > t * 1.1:
        n = max(1, min(n, int(t * 1.1 // _DURATION_MIN)))
    return n, float(t)


def template_script(
    idea: Idea,
    *,
    scene_count: int,
    target_duration_sec: int,
    visual_style: str = "",
) -> Script:
    """Deterministic scenes. Jev/code pick the idea; images still render.

    Pacing matches the writer contract (~2.6 wps, 2–7s scenes, sum within
    10% of T). Every scene ships a still + motion prompt long enough that
    Visual Director is skipped. No invented stats.
    """
    n, target = _scene_count(scene_count, target_duration_sec)
    raw = target / n
    durations = [max(_DURATION_MIN, min(_DURATION_MAX, raw)) for _ in range(n)]
    durations[-1] = max(
        _DURATION_MIN,
        min(_DURATION_MAX, durations[-1] + (target - sum(durations))),
    )
    topic = (idea.topic or "this").strip() or "this"
    hook = (idea.hook or f"You're doing {topic} the hard way").strip()
    angle = (idea.angle or "the part nobody mentions").strip()
    audience = (idea.target_audience or "you").strip() or "you"
    why = (idea.why_it_works or "a concrete payoff you can use").strip()
    style = (
        visual_style.strip()
        or "clean editorial still, soft daylight, shallow depth of field"
    )
    beats = [
        f"{hook}. Stay to the end and you will know how {topic} actually works",
        f"{audience}: {angle} is the move that changes {topic}",
        f"Here is the part nobody mentions about {topic}. {angle}",
        f"Do this next. Apply {topic} the simple way. {why}",
        f"Close the loop on {topic}. {why}. Follow for part two where we go deeper",
    ]
    scenes: list[Scene] = []
    for i, duration in enumerate(durations):
        lo = max(4, int(2.0 * duration))
        hi = max(lo, int(3.2 * duration))
        word_count = max(lo, min(hi, int(round(_WORDS_PER_SEC * duration))))
        if i == 0:
            source = beats[0]
        elif i == n - 1:
            source = beats[4]
        elif i == max(1, n // 2):
            source = beats[2]
        else:
            source = beats[1]
        narration = _fit_words(source, word_count)
        visual = (
            f"{style}. Concrete still of {topic} as a physical object on a "
            "desk, no text, no words, no numbers, no labels, no captions."
        )
        scenes.append(
            Scene(
                index=i,
                narration=narration,
                visual_prompt=visual,
                motion_prompt=_MOTIONS[i % len(_MOTIONS)],
                duration_sec=round(duration, 2),
            )
        )
    total = round(sum(s.duration_sec for s in scenes), 2)
    return Script(
        idea=idea,
        scenes=scenes,
        total_duration_sec=total,
        cta=f"Follow for part two on {topic}",
    )


def build_scriptwriter_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="Scriptwriter",
        instructions=SCRIPTWRITER_INSTRUCTIONS,
        output_type=Script,
    )
