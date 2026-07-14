"""Ideation agent: given a niche, propose a topic, angle, and hook.

Output: `Idea` schema. Optimized for short-form hook patterns
(curiosity gap, contrarian claim, "you've been doing X wrong", etc).

When ``performance_context`` is provided to :func:`build_ideation_prompt`,
the prompt is prepended with a markdown block summarising recent top and
bottom performers so the model can avoid flopped patterns and double down on
angles that already resonated.
"""
from __future__ import annotations

from agents import Agent

from ..config import settings
from .metered import run_metered
from ..models import Idea
from ..services.spend_context import SpendContext  # noqa: TC001 — used in signature

IDEATION_INSTRUCTIONS = """You are an expert short-form content strategist.
Given a niche, produce ONE Idea optimized for educational short-form video.

Rules for the hook (first 3 seconds):
- Pattern interrupt OR curiosity gap OR contrarian claim.
- Under 12 words. Spoken-word natural, not clickbait.
- Implies a payoff the rest of the video must deliver.

The angle should be a SPECIFIC, NON-OBVIOUS take — not a generic overview.
The audience should be precisely scoped (not "everyone").
`why_it_works` should reference a concrete cognitive or platform mechanic.
"""

_PERF_PREAMBLE = (
    "Use the performance context below to inform your idea — "
    "lean into the angles and topics that worked, "
    "avoid the patterns that flopped, "
    "and look for adjacent unexplored angles.\n\n"
)


def build_ideation_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="Ideation",
        instructions=IDEATION_INSTRUCTIONS,
        output_type=Idea,
    )


def build_ideation_prompt(niche_title: str, *, performance_context: str = "") -> str:
    """Construct the user-turn prompt for the ideation agent.

    When *performance_context* is non-empty the prompt is prefixed with a
    preamble directing the model to use the data, followed by the context
    block itself.  When empty the prompt is ``"Niche: <title>"`` — identical
    to the previous stateless behaviour.
    """
    base = f"Niche: {niche_title}"
    if not performance_context:
        return base
    return f"{_PERF_PREAMBLE}{performance_context}\n\n{base}"


async def run_ideation(
    niche_title: str,
    *,
    performance_context: str = "",
    spend: "SpendContext | None" = None,
) -> Idea:
    """Run the ideation agent and return a single :class:`~marketer.models.Idea`.

    When *performance_context* is non-empty (built by
    :func:`~marketer.agents.performance_context.build_performance_context`),
    the prompt is enriched with top/bottom performer data so the model can
    tune its suggestions toward proven angles.  When empty the call is
    identical to the original stateless behaviour — safe for cold-start niches.
    """
    agent = build_ideation_agent()
    prompt = build_ideation_prompt(niche_title, performance_context=performance_context)
    result = await run_metered(agent, prompt, spend=spend)
    return result.final_output_as(Idea)
