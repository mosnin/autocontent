"""OpenAI Agents SDK wiring.

Sequenced agent flow (handoff per stage):
    Ideation → Scriptwriter → VisualDirector → QA

Each stage produces a typed pydantic output that the next stage consumes.
Deterministic media steps (image gen, animation, TTS, edit) live in
`pipeline.py`; agents are reserved for steps that require LLM judgement.
"""
from __future__ import annotations

from agents import Agent, Runner

from .agents import (
    build_ideation_agent,
    build_scriptwriter_agent,
    build_visual_director_agent,
    build_qa_agent,
)
from .config import settings
from .models import Idea, Script
from .agents.qa import QAReport


async def run_ideation(niche: str) -> Idea:
    agent = build_ideation_agent()
    result = await Runner.run(agent, input=f"Niche: {niche}")
    return result.final_output_as(Idea)


async def run_scriptwriter(idea: Idea) -> Script:
    agent = build_scriptwriter_agent()
    prompt = (
        f"Idea:\n{idea.model_dump_json(indent=2)}\n\n"
        f"Target: {settings.scene_count} scenes, "
        f"{settings.target_duration_sec}s total."
    )
    result = await Runner.run(agent, input=prompt)
    return result.final_output_as(Script)


async def run_visual_director(script: Script) -> Script:
    agent = build_visual_director_agent()
    result = await Runner.run(agent, input=script.model_dump_json())
    return result.final_output_as(Script)


async def run_qa(script: Script, transcript: str, duration_sec: float) -> QAReport:
    agent = build_qa_agent()
    payload = {
        "script": script.model_dump(),
        "transcript": transcript,
        "duration_sec": duration_sec,
        "target_duration_sec": settings.target_duration_sec,
        "niche": settings.niche,
    }
    import json

    result = await Runner.run(agent, input=json.dumps(payload))
    return result.final_output_as(QAReport)


def all_agents() -> list[Agent]:
    return [
        build_ideation_agent(),
        build_scriptwriter_agent(),
        build_visual_director_agent(),
        build_qa_agent(),
    ]
