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


QA_INSTRUCTIONS = """You are a QA reviewer for short-form video.
Given the script, transcript, and metadata (duration, hook, niche),
return a QAReport.

Fail (passed=false) only when:
- Duration is >20% off target.
- Hook is generic ("hey guys", "in today's video", >12 words).
- Transcript drifts off the stated niche.
- Captions are missing or empty.

Otherwise pass. Be strict but not pedantic.
"""


def build_qa_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="QA",
        instructions=QA_INSTRUCTIONS,
        output_type=QAReport,
    )
