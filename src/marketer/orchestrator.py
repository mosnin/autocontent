"""OpenAI Agents SDK wiring.

Sequenced agent flow (handoff per stage):
    Ideation → Scriptwriter → VisualDirector → QA

Each stage produces a typed pydantic output that the next stage consumes.
Deterministic media steps (image gen, animation, TTS, edit) live in
`pipeline.py`; agents are reserved for steps that require LLM judgement.

Every stage accepts a ``spend`` context: agent calls are real provider
spend and go through the same cap/ledger gate as image, TTS, and video
generation (see ``agents.metered.run_metered``).
"""
from __future__ import annotations

import json

from agents import Agent

from .agents import (
    build_ideation_agent,
    build_scriptwriter_agent,
    build_visual_director_agent,
    build_qa_agent,
)
from .agents.ideation import run_ideation as run_ideation  # re-exported for pipeline
from .agents.metered import run_metered
from .models import Idea, Niche, Script
from .models.creative_brief import CreativeBrief
from .agents.qa import QAReport
from .services.spend_context import SpendContext


async def run_scriptwriter(
    idea: Idea,
    *,
    scene_count: int,
    target_duration_sec: int,
    audience_context: str = "",
    brief: CreativeBrief | None = None,
    spend: SpendContext | None = None,
) -> Script:
    agent = build_scriptwriter_agent()
    prompt = (
        f"Idea:\n{idea.model_dump_json(indent=2)}\n\n"
        f"Target: {scene_count} scenes, {target_duration_sec}s total."
    )
    if audience_context:
        prompt += f"\n{audience_context}"
    if brief is not None:
        for line in brief.scriptwriter_lines():
            prompt += f"\n{line}"
    result = await run_metered(agent, prompt, spend=spend)
    return result.final_output_as(Script)


async def run_visual_director(
    script: Script,
    *,
    visual_style: str,
    character_description: str = "",
    brief: CreativeBrief | None = None,
    spend: SpendContext | None = None,
) -> Script:
    agent = build_visual_director_agent()
    payload = {
        "style": visual_style,
        "character": character_description or "",
        "script": script.model_dump(),
    }
    if brief is not None:
        vd_brief = brief.visual_director_brief()
        if vd_brief:
            payload["creative_brief"] = vd_brief
    result = await run_metered(agent, json.dumps(payload), spend=spend)
    return result.final_output_as(Script)


async def run_qa(
    script: Script,
    transcript: str,
    duration_sec: float,
    *,
    niche: Niche,
    spend: SpendContext | None = None,
) -> QAReport:
    agent = build_qa_agent()
    payload = {
        "script": script.model_dump(),
        "transcript": transcript,
        "duration_sec": duration_sec,
        "target_duration_sec": niche.target_duration_sec,
        "niche": niche.title,
    }
    qa_constraints = niche.creative_brief.qa_lines()
    if qa_constraints:
        payload["creative_constraints"] = qa_constraints
    result = await run_metered(agent, json.dumps(payload), spend=spend)
    return result.final_output_as(QAReport)


def all_agents() -> list[Agent]:
    return [
        build_ideation_agent(),
        build_scriptwriter_agent(),
        build_visual_director_agent(),
        build_qa_agent(),
    ]
