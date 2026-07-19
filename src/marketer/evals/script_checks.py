"""Pure, deterministic checks for a generated :class:`~marketer.models.Script`.

These mirror the failure modes the QA agent looks for, but run offline —
no network, no DB — so they can gate CI and score live agent evals
cheaply and reproducibly. Every check returns a list of human-readable
issue strings; an empty list means the check passed.
"""
from __future__ import annotations

import re
from typing import Any

from ..models import Idea, Script

# Hook rules (first 3 seconds of the video).
HOOK_MAX_WORDS = 12
BANNED_OPENERS = ("hey guys", "in this video", "today we", "welcome back")

# Spoken VO pacing: comfortable narration lands in this band.
MIN_WORDS_PER_SEC = 1.6
MAX_WORDS_PER_SEC = 3.4

# Duration rules.
DURATION_TOLERANCE_FRAC = 0.20
SCENE_MIN_SEC = 2.0
SCENE_MAX_SEC = 7.0

# Visual prompt rules. Image models garble rendered text; captions are
# burned in separately, so a visual_prompt must never ask for on-screen
# words.
MOTION_PROMPT_MAX_WORDS = 20
STYLE_PREFIX_WORDS = 6
_TEXT_RENDER_RE = re.compile(
    r"\b(?:"
    r"text|words?|captions?|subtitles?|labels?|labeled|labelled|typography|"
    r"lettering|font|headline|title\s+card|writing|written|says?|reading|reads|"
    r"sign\s+that\s+says|speech\s+bubble|word\s+art|slogan|quote\s+overlay"
    r")\b",
    re.IGNORECASE,
)


def _word_count(text: str) -> int:
    return len(text.split())


def check_hook(idea: Idea) -> list[str]:
    """Flag hooks that are too long or open with a banned generic phrase."""
    issues: list[str] = []
    hook = idea.hook.strip()
    words = _word_count(hook)
    if words > HOOK_MAX_WORDS:
        issues.append(f"hook is {words} words (max {HOOK_MAX_WORDS}): {hook!r}")
    lowered = hook.lower()
    for opener in BANNED_OPENERS:
        if opener in lowered:
            issues.append(f"hook uses banned generic opener {opener!r}: {hook!r}")
    return issues


def check_pacing(script: Script) -> list[str]:
    """Flag scenes whose narration pace falls outside spoken-VO range."""
    issues: list[str] = []
    for scene in script.scenes:
        if scene.duration_sec <= 0:
            issues.append(f"scene {scene.index}: non-positive duration {scene.duration_sec}s")
            continue
        wps = _word_count(scene.narration) / scene.duration_sec
        if not MIN_WORDS_PER_SEC <= wps <= MAX_WORDS_PER_SEC:
            issues.append(
                f"scene {scene.index}: pacing {wps:.2f} words/sec outside "
                f"{MIN_WORDS_PER_SEC}-{MAX_WORDS_PER_SEC}"
            )
    return issues


def check_duration(script: Script, target_duration_sec: float) -> list[str]:
    """Flag total-duration drift beyond tolerance and out-of-band scenes."""
    issues: list[str] = []
    total = sum(s.duration_sec for s in script.scenes)
    if target_duration_sec > 0:
        drift = abs(total - target_duration_sec) / target_duration_sec
        if drift > DURATION_TOLERANCE_FRAC:
            issues.append(
                f"total duration {total:.1f}s is {drift:.0%} off target "
                f"{target_duration_sec:.0f}s (max {DURATION_TOLERANCE_FRAC:.0%})"
            )
    for scene in script.scenes:
        if not SCENE_MIN_SEC <= scene.duration_sec <= SCENE_MAX_SEC:
            issues.append(
                f"scene {scene.index}: duration {scene.duration_sec}s outside "
                f"{SCENE_MIN_SEC}-{SCENE_MAX_SEC}s"
            )
    return issues


def check_visual_prompts(script: Script) -> list[str]:
    """Flag prompts asking for rendered on-screen text and bad motion prompts."""
    issues: list[str] = []
    for scene in script.scenes:
        match = _TEXT_RENDER_RE.search(scene.visual_prompt)
        if match:
            issues.append(
                f"scene {scene.index}: visual_prompt asks for rendered text "
                f"({match.group(0)!r}) — image models garble text, captions are burned separately"
            )
        motion_words = _word_count(scene.motion_prompt)
        if motion_words == 0:
            issues.append(f"scene {scene.index}: empty motion_prompt")
        elif motion_words > MOTION_PROMPT_MAX_WORDS:
            issues.append(
                f"scene {scene.index}: motion_prompt is {motion_words} words "
                f"(max {MOTION_PROMPT_MAX_WORDS})"
            )
    return issues


def check_style_cohesion(script: Script) -> list[str]:
    """Flag scenes whose visual_prompt breaks from scene 0's style prefix."""
    if len(script.scenes) < 2:
        return []
    issues: list[str] = []
    prefix = script.scenes[0].visual_prompt.lower().split()[:STYLE_PREFIX_WORDS]
    for scene in script.scenes[1:]:
        scene_prefix = scene.visual_prompt.lower().split()[: len(prefix)]
        if scene_prefix != prefix:
            issues.append(
                f"scene {scene.index}: visual_prompt does not share scene 0's "
                f"style prefix {' '.join(prefix)!r}"
            )
    return issues


def score_script(script: Script, *, target_duration_sec: float) -> dict[str, Any]:
    """Aggregate all checks into ``{"issues", "passed", "metrics"}``."""
    issues = [
        *check_hook(script.idea),
        *check_pacing(script),
        *check_duration(script, target_duration_sec),
        *check_visual_prompts(script),
        *check_style_cohesion(script),
    ]
    total_duration = sum(s.duration_sec for s in script.scenes)
    total_words = sum(_word_count(s.narration) for s in script.scenes)
    metrics: dict[str, Any] = {
        "scene_count": len(script.scenes),
        "total_duration_sec": total_duration,
        "avg_words_per_sec": (total_words / total_duration) if total_duration > 0 else 0.0,
        "duration_drift_frac": (
            abs(total_duration - target_duration_sec) / target_duration_sec
            if target_duration_sec > 0
            else 0.0
        ),
        "hook_word_count": _word_count(script.idea.hook),
        "issue_count": len(issues),
    }
    return {"issues": issues, "passed": not issues, "metrics": metrics}
