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
from .agents.ideation import run_ideation as run_ideation  # re-exported for pipeline
from .models import Idea, Niche, Script
from .agents.qa import QAReport


async def run_scriptwriter(idea: Idea, *, scene_count: int, target_duration_sec: int) -> Script:
    agent = build_scriptwriter_agent()
    prompt = (
        f"Idea:\n{idea.model_dump_json(indent=2)}\n\n"
        f"Target: {scene_count} scenes, {target_duration_sec}s total."
    )
    result = await Runner.run(agent, input=prompt)
    return result.final_output_as(Script)


async def run_visual_director(script: Script, *, visual_style: str) -> Script:
    agent = build_visual_director_agent()
    payload = {"style": visual_style, "script": script.model_dump()}
    import json
    result = await Runner.run(agent, input=json.dumps(payload))
    return result.final_output_as(Script)


async def run_qa(
    script: Script,
    transcript: str,
    duration_sec: float,
    *,
    niche: Niche,
) -> QAReport:
    agent = build_qa_agent()
    payload = {
        "script": script.model_dump(),
        "transcript": transcript,
        "duration_sec": duration_sec,
        "target_duration_sec": niche.target_duration_sec,
        "niche": niche.title,
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
