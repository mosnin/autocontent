"""QA agent: reviews the rendered video metadata + transcript for issues.

Not a content moderator — checks for structural problems that block posting:
duration drift, missing captions, weak hook, off-niche drift.
"""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel

from agents import Agent

from ..config import settings

_GENERIC_HOOKS = (
    "hey guys",
    "hey everybody",
    "hey everyone",
    "what's up",
    "whats up",
    "in today's video",
    "in this video",
    "welcome back",
    "hi everyone",
    "hello everyone",
)


class QAReport(BaseModel):
    passed: bool
    issues: list[str]
    suggested_action: str  # "publish" | "regenerate_script" | "rerender" | "reject"
    # Rubric scores, 0-10 each. Advisory except where the instructions
    # define a hard floor; logged for eval/telemetry either way.
    hook_score: int = 5
    retention_score: int = 5
    clarity_score: int = 5


QA_INSTRUCTIONS = """You are a QA reviewer for short-form video.
Given the script, transcript, and metadata (real rendered duration, hook,
niche), return a QAReport.

Score three dimensions 0-10:
- hook_score: would a scroller stop in the first second? Specific promise,
  under 12 words, no greeting.
- retention_score: open loop in scene 0, one idea per scene, a mid-video
  pattern reset, payoff at the end.
- clarity_score: could the target viewer restate the takeaway in one
  sentence?

Fail (passed=false) when ANY of these hold:
- Duration is >20% off target.
- Hook is generic ("hey guys", "in today's video", >12 words) or
  hook_score <= 3.
- Transcript drifts off the stated niche.
- Captions are missing or empty.
- clarity_score <= 3 (the video teaches nothing concrete).

suggested_action:
- "regenerate_script" for content problems (weak hook, no payoff, drift) —
  a fresh script could pass.
- "rerender" only for delivery problems (duration off, captions).
- "publish" when passed.
Be strict but not pedantic — 6/10 content ships; broken content doesn't.
"""


def heuristic_qa_report(payload: dict[str, Any]) -> QAReport:
    """Deterministic video QA when Jev is dark. Classification, not prose.

    Encodes the same hard floors as QA_INSTRUCTIONS so a dark harness does
    not spend 2–8s on an editorial LLM that invents rubric numbers.
    """
    hook = str(payload.get("hook") or "").strip()
    transcript = str(payload.get("transcript") or "").strip()
    narration = str(payload.get("narration") or "").strip()
    niche = str(payload.get("niche") or "").strip()
    try:
        duration = float(payload.get("duration_sec") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    try:
        target = float(payload.get("target_duration_sec") or 0)
    except (TypeError, ValueError):
        target = 0.0

    issues: list[str] = []
    action = "publish"
    hook_words = [w for w in hook.split() if w]
    hook_l = hook.casefold()
    hook_score = 7
    if not hook_words:
        issues.append("missing hook")
        hook_score = 2
        action = "regenerate_script"
    elif len(hook_words) > 12 or any(g in hook_l for g in _GENERIC_HOOKS):
        issues.append("weak or generic hook")
        hook_score = 3
        action = "regenerate_script"

    if target > 0 and duration > 0 and abs(duration - target) / target > 0.20:
        issues.append("Duration is more than 20% off target")
        action = "rerender"
    if not transcript:
        issues.append("Captions are missing or empty")
        if action == "publish":
            action = "rerender"

    spoken_words = re.findall(
        r"[a-z0-9]+", f"{narration} {transcript}".casefold()
    )
    spoken_tokens = {w for w in spoken_words if len(w) > 2}
    niche_tokens = {
        w for w in re.findall(r"[a-z0-9]+", niche.casefold()) if len(w) > 3
    }
    # Short-form transcripts are too small to judge drift until there is
    # enough language to compare. Skip rather than false-fail.
    if (
        niche_tokens
        and len(spoken_words) >= 12
        and not (niche_tokens & spoken_tokens)
    ):
        issues.append("transcript drifts off niche")
        if action == "publish":
            action = "regenerate_script"

    clarity = 7 if hook_words and (narration or transcript) else 3
    if clarity <= 3:
        issues.append("no concrete takeaway")
        if action == "publish":
            action = "regenerate_script"

    retention = 7 if narration and transcript else 5
    passed = not issues
    if passed:
        action = "publish"
    return QAReport(
        passed=passed,
        issues=issues,
        suggested_action=action,
        hook_score=hook_score,
        retention_score=retention,
        clarity_score=clarity,
    )


def build_qa_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="QA",
        instructions=QA_INSTRUCTIONS,
        output_type=QAReport,
    )
