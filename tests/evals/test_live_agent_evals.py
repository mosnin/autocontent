"""LIVE evals: exercise the real agent pipeline over golden niches.

These hit the OpenAI API and cost real money, so they are gated behind
``MARKETER_RUN_LIVE_EVALS`` and never run in CI:

    MARKETER_RUN_LIVE_EVALS=1 uv run pytest tests/evals/ -q

Each golden niche runs ideation -> scriptwriter -> visual director (with
``spend=None``, so no cap/ledger wiring is needed), then scores the result
with the deterministic checks from ``marketer.evals``. A separate LLM-judge
test scores the script 1-10 on hook strength, retention structure, and
clarity with a >=7 pass threshold.
"""
from __future__ import annotations

import os

import pytest
from pydantic import BaseModel, Field

from agents import Agent

from marketer.agents.ideation import run_ideation
from marketer.agents.metered import run_metered
from marketer.config import settings
from marketer.evals import check_hook, score_script
from marketer.models import Script
from marketer.orchestrator import run_scriptwriter, run_visual_director

pytestmark = pytest.mark.skipif(
    not os.environ.get("MARKETER_RUN_LIVE_EVALS"),
    reason="live agent evals cost real API spend; set MARKETER_RUN_LIVE_EVALS=1 to run",
)

TARGET_DURATION_SEC = 30
SCENE_COUNT = 5

GOLDEN_NICHES = [
    pytest.param(
        "Personal finance habits for beginners",
        "3D claymation, soft studio lighting, pastel palette, 9:16 vertical",
        id="claymation-personal-finance",
    ),
    pytest.param(
        "Productivity systems for remote workers",
        "isometric 3D infographic, clean vector shapes, muted blues, 9:16 vertical",
        id="isometric-productivity",
    ),
    pytest.param(
        "Travel hacks for budget long-haul flights",
        "cinematic photo, golden hour, shallow depth of field, 9:16 vertical",
        id="cinematic-travel-hacks",
    ),
]


async def _run_pipeline(niche_title: str, visual_style: str) -> Script:
    idea = await run_ideation(niche_title, spend=None)
    script = await run_scriptwriter(
        idea,
        scene_count=SCENE_COUNT,
        target_duration_sec=TARGET_DURATION_SEC,
        spend=None,
    )
    return await run_visual_director(script, visual_style=visual_style, spend=None)


@pytest.mark.parametrize(("niche_title", "visual_style"), GOLDEN_NICHES)
async def test_pipeline_produces_passing_script(niche_title: str, visual_style: str):
    script = await _run_pipeline(niche_title, visual_style)

    hook_issues = check_hook(script.idea)
    assert not hook_issues, f"hook checks failed for {niche_title!r}: {hook_issues}"

    result = score_script(script, target_duration_sec=TARGET_DURATION_SEC)
    assert result["passed"], (
        f"script checks failed for {niche_title!r}: "
        f"{result['issues']}\nmetrics={result['metrics']}"
    )


# ------------------------------------------------------------- LLM judge


class JudgeVerdict(BaseModel):
    hook_strength: int = Field(ge=1, le=10)
    retention_structure: int = Field(ge=1, le=10)
    clarity: int = Field(ge=1, le=10)
    rationale: str


JUDGE_INSTRUCTIONS = """You are a harsh short-form video script judge.
Given a Script (idea + scenes with narration), score it 1-10 on:

- hook_strength: does scene 0 + the idea's hook earn the first 3 seconds?
  Pattern interrupt, curiosity gap, or contrarian claim; no generic openers.
- retention_structure: does each scene create an open loop or payoff that
  pulls the viewer to the next scene? Penalize filler and flat listicles.
- clarity: is each scene teaching ONE concrete idea in plain spoken language?

7 means genuinely good; reserve 9-10 for exceptional. Explain briefly in
`rationale`.
"""

JUDGE_PASS_THRESHOLD = 7


def build_judge_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="ScriptJudge",
        instructions=JUDGE_INSTRUCTIONS,
        output_type=JudgeVerdict,
    )


async def test_llm_judge_scores_pipeline_script():
    niche_title, visual_style = (
        "Personal finance habits for beginners",
        "3D claymation, soft studio lighting, pastel palette, 9:16 vertical",
    )
    script = await _run_pipeline(niche_title, visual_style)

    judge = build_judge_agent()
    result = await run_metered(judge, script.model_dump_json(indent=2), spend=None)
    verdict = result.final_output_as(JudgeVerdict)

    scores = {
        "hook_strength": verdict.hook_strength,
        "retention_structure": verdict.retention_structure,
        "clarity": verdict.clarity,
    }
    failing = {k: v for k, v in scores.items() if v < JUDGE_PASS_THRESHOLD}
    assert not failing, (
        f"LLM judge scored below {JUDGE_PASS_THRESHOLD}: {failing} "
        f"(all scores={scores}, rationale={verdict.rationale!r})"
    )
