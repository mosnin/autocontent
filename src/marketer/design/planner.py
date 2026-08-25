"""Brief -> plan, via the Agents SDK.

One metered LLM call turns a natural-language design brief into a
``PlanDraft``: the deliverable broken into concrete canvas operations
with explicit dependencies. The draft is then validated into an
executable ``DesignPlan`` — see ``plan.build_plan``.

This stage is written exactly like every other LLM stage in the codebase
(``agents/*.py`` build the Agent, ``orchestrator`` runs it through
``run_metered``), so planning shows up in ``spend_ledger``, obeys the
niche/global caps, and debits prepaid credit like anything else.
"""
from __future__ import annotations

import json

from agents import Agent

from ..config import settings
from ..models import Niche
from ..models.creative_brief import CreativeBrief
from .operations import catalog_lines
from .plan import (
    HARD_MAX_STEPS,
    DesignFormat,
    DesignPlan,
    PlanDraft,
    build_plan,
)

DESIGN_PLANNER_INSTRUCTIONS = """You are a creative director who plans
image deliverables as an explicit, executable graph of canvas
operations. You do NOT generate images; you author the plan another
system executes step by step.

Input JSON: {"brief", "format", "max_steps", "niche", "audience",
"visual_style", "brief_lines": [...], "operations": [...]}

Output a plan whose steps build on each other. The plan is a DAG:
`depends_on` names the ids of earlier steps whose OUTPUT IMAGE this step
consumes. That iteration is the entire value of the format — a plan of
independent `generate` steps is a worse product than a single prompt.

Rules:
- AT MOST max_steps steps. Fewer, better steps beat more steps. Every
  step is a paid image render.
- Start with 1-2 `generate` steps that establish the base plate and the
  art direction. Everything after should refine, combine, or letter
  those plates via `edit`, `compose`, `text_overlay`, `upscale`.
- Use each operation only with its declared depends_on arity. `generate`
  takes none; `edit`/`text_overlay`/`upscale` take exactly one;
  `compose` takes two or more.
- NEVER create a cycle, and never reference a step id you did not define.
- ids: short lowercase slugs, unique, e.g. "base_plate", "hero_edit".
- Each step's `prompt` must be a complete, self-contained image prompt.
  For `edit`/`compose`/`upscale` describe the CHANGE, and restate the
  shared aesthetic verbatim so the look does not drift between steps.
- `text_overlay` is the only place literal copy belongs: put the exact
  words in `text`, and describe placement/weight/treatment in `prompt`.
- `quality`: "low" for throwaway intermediates, "medium" by default.
  Do not ask for "high" — reserve fidelity for a final `upscale`, which
  is pinned to high automatically.
- Exactly ONE step should be the final deliverable (nothing depends on
  it). Say which in `notes`.
- Respect every line of brief_lines verbatim; they are hard constraints.
"""


def build_design_planner_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="DesignPlanner",
        instructions=DESIGN_PLANNER_INSTRUCTIONS,
        output_type=PlanDraft,
    )


def _planner_payload(
    *,
    brief: str,
    fmt: DesignFormat,
    max_steps: int,
    niche: Niche | None,
    creative_brief: CreativeBrief | None,
) -> dict:
    payload: dict = {
        "brief": brief,
        "format": fmt,
        "max_steps": max_steps,
        "operations": catalog_lines(),
    }
    if niche is not None:
        payload["niche"] = f"{niche.title} — {niche.description}"
        payload["audience"] = niche.target_audience
        payload["visual_style"] = niche.visual_style
    # Reuse the existing per-niche CreativeBrief rather than inventing a
    # second brief model: its image_lines() are exactly the still-image
    # constraints (palette, lighting, hard bans) this planner needs.
    cb = creative_brief if creative_brief is not None else (
        niche.creative_brief if niche is not None else None
    )
    if cb is not None:
        lines = cb.image_lines()
        if lines:
            payload["brief_lines"] = lines
    return payload


async def plan_design(
    brief: str,
    *,
    fmt: DesignFormat = "1:1",
    max_steps: int = 8,
    niche: Niche | None = None,
    creative_brief: CreativeBrief | None = None,
    spend=None,
) -> DesignPlan:
    """Plan one design project. Raises ``PlanValidationError`` on a bad plan.

    ``max_steps`` is clamped to ``HARD_MAX_STEPS`` before the model even
    sees it — the prompt asks for a bounded plan, and ``build_plan``
    enforces the same bound on the way back, because a prompt is a
    request and a validator is a guarantee.
    """
    from ..agents.metered import run_metered

    bounded = max(1, min(int(max_steps), HARD_MAX_STEPS))
    payload = _planner_payload(
        brief=brief,
        fmt=fmt,
        max_steps=bounded,
        niche=niche,
        creative_brief=creative_brief,
    )
    result = await run_metered(
        build_design_planner_agent(), json.dumps(payload), spend=spend
    )
    draft = result.final_output_as(PlanDraft)
    return build_plan(draft, fmt=fmt, max_steps=bounded)


__all__ = [
    "DESIGN_PLANNER_INSTRUCTIONS",
    "DesignPlan",
    "build_design_planner_agent",
    "plan_design",
]
