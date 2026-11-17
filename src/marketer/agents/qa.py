"""QA agent: reviews the rendered video metadata + transcript for issues.

Not a content moderator — checks for structural problems that block posting:
duration drift, missing captions, weak hook, off-niche drift.
"""
from __future__ import annotations

from pydantic import BaseModel

from agents import Agent

from ..config import settings


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


def build_qa_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="QA",
        instructions=QA_INSTRUCTIONS,
        output_type=QAReport,
    )


async def verify_report(
    report: QAReport,
    *,
    script,
    transcript: str,
    niche_title: str,
    brand_rules: list[str],
    spend=None,
) -> QAReport:
    """Decision point 9 (video): a verify pass after the LLM QA report.

    Only runs when the report passed, since it can only tighten. In enforce a
    single failed check bounces the video as a script problem; scores are
    never averaged. Off, shadow, or a failed call: the report is unchanged."""
    if not report.passed:
        return report
    from ..decisions import points as decision_points

    failures = await decision_points.verify_video(
        script=script,
        transcript=transcript,
        niche_title=niche_title,
        brand_rules=brand_rules,
        rule_passed=report.passed,
        spend=spend,
    )
    if not failures:
        return report
    return report.model_copy(
        update={
            "passed": False,
            "issues": [*report.issues, "verify failed: " + ", ".join(failures)],
            "suggested_action": "regenerate_script",
        }
    )
