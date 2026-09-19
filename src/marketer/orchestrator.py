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
from .agents.scriptwriter import should_template_script, template_script
from .agents.visual_director import should_template_visuals, template_visual_director
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
    script_model: str = "",
    spend: SpendContext | None = None,
) -> Script:
    # Default / dark path: templates, not a 5–20s writer. Operator-pinned
    # script_model and a narrative brief still buy the LLM.
    if should_template_script(script_model=script_model, brief=brief):
        return template_script(
            idea,
            scene_count=scene_count,
            target_duration_sec=target_duration_sec,
        )
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

    # Per-niche writer via OpenRouter. Unknown ids or a missing key
    # keep the stock agent. Empty dropdown still prefers Qwen.
    from .services import openrouter

    result = await run_metered(
        agent,
        prompt,
        spend=spend,
        **openrouter.generation_metered(agent, script_model),
    )
    return result.final_output_as(Script)


async def run_visual_director(
    script: Script,
    *,
    visual_style: str,
    character_description: str = "",
    brief: CreativeBrief | None = None,
    design_kit: str = "",
    spend: SpendContext | None = None,
) -> Script:
    if should_template_visuals(brief=brief, design_kit=design_kit):
        return template_visual_director(
            script,
            visual_style=visual_style,
            character_description=character_description,
        )
    agent = build_visual_director_agent()
    payload = {
        "style": visual_style,
        "character": character_description or "",
        "script": script.model_dump(),
    }
    if design_kit:
        payload["design_kit"] = design_kit
    if brief is not None:
        vd_brief = brief.visual_director_brief()
        if vd_brief:
            payload["creative_brief"] = vd_brief

    # Same Qwen-first hop as scriptwriter when the operator actually
    # bought Visual Director (design kit / visual brief). Templates
    # already skipped this function.
    from .services import openrouter

    result = await run_metered(
        agent,
        json.dumps(payload),
        spend=spend,
        **openrouter.generation_metered(agent),
    )
    return result.final_output_as(Script)


def qa_payload(
    script: Script,
    transcript: str,
    duration_sec: float,
    niche: Niche,
) -> dict:
    """Slim state for Jev / heuristic video QA. Shared so the pipeline can
    fan-out judge_video with Foreman in one RTT."""
    scenes = getattr(script, "scenes", None) or []
    payload = {
        "hook": (scenes[0].narration if scenes else ""),
        "narration": " ".join(str(getattr(s, "narration", "") or "") for s in scenes),
        "transcript": (transcript or "")[:1500],
        "duration_sec": duration_sec,
        "target_duration_sec": niche.target_duration_sec,
        "niche": niche.title,
    }
    qa_constraints = niche.creative_brief.qa_lines()
    if qa_constraints:
        payload["creative_constraints"] = qa_constraints
    return payload


async def resolve_video_qa(
    payload: dict,
    heuristic: QAReport,
    *,
    spend: SpendContext | None = None,
) -> QAReport:
    """Jev when live; otherwise the already-computed heuristic. Never a writer.

    Hard rerender floors (duration / empty captions) stay with the
    heuristic — Jev has no clock and must not publish a broken render.
    """
    from .agents.qa import is_hard_rerender
    from .config import settings as _settings
    from .jev import available as jev_available
    from .jev.decisions import judge_video

    if is_hard_rerender(heuristic):
        return heuristic
    if _settings.jev_enabled and jev_available():
        try:
            verdict = await judge_video(payload, spend=spend)
            return verdict.report
        except Exception as exc:  # noqa: BLE001 — Jev is an upgrade, never a new fail
            from .repos.spend import SpendCapExceeded

            if isinstance(exc, SpendCapExceeded):
                raise
    return heuristic


async def run_qa(
    script: Script,
    transcript: str,
    duration_sec: float,
    *,
    niche: Niche,
    spend: SpendContext | None = None,
) -> QAReport:
    from .agents.qa import heuristic_qa_report

    payload = qa_payload(script, transcript, duration_sec, niche)
    heuristic = heuristic_qa_report(payload)
    return await resolve_video_qa(payload, heuristic, spend=spend)


def all_agents() -> list[Agent]:
    return [
        build_ideation_agent(),
        build_scriptwriter_agent(),
        build_visual_director_agent(),
        build_qa_agent(),
    ]
