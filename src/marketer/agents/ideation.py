"""Ideation: propose the topic, angle, and hook for the next video.

Two upgrades over the original single-shot, title-only version:

1. **Full context.** The prompt carries the whole niche brief (description,
   audience, platform), the account brand voice, a do-not-repeat list of
   recent topics, and the performance context (top/bottom performers) —
   the agent used to see only the niche *title*.
2. **Tournament.** `settings.ideation_candidates` ideas are generated in
   parallel, each forced through a different hook lens (curiosity gap /
   contrarian / mistake-or-stakes), then a single judge call picks the
   strongest. Ideation tokens are the cheapest in the pipeline and the
   idea is the highest-leverage decision, so this trades pennies for the
   pick of three instead of a single draw.
"""
from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

from agents import Agent

from ..config import settings
from .metered import run_metered
from ..models import Idea
from ..services.spend_context import SpendContext  # noqa: TC001 — used in signature

IDEATION_INSTRUCTIONS = """You are an expert short-form content strategist.
Given a niche brief, produce ONE Idea optimized for educational short-form video.

Rules for the hook (first 3 seconds):
- Under 12 words. Spoken-word natural, not clickbait.
- Implies a specific payoff the rest of the video must deliver.
- Never open with "hey guys", "in this video", "today we", or any greeting.

The angle should be a SPECIFIC, NON-OBVIOUS take — not a generic overview.
The audience should be precisely scoped (not "everyone").
`why_it_works` should reference a concrete cognitive or platform mechanic.
Respect the brand voice when one is given. Never propose a topic on the
do-not-repeat list, or a near-duplicate of one.
"""

# Each candidate is pushed through a different hook mechanism so the
# tournament compares genuinely different ideas, not three near-clones.
CANDIDATE_LENSES = [
    "Hook mechanism for THIS attempt: a curiosity gap — open a specific "
    "question the viewer needs answered.",
    "Hook mechanism for THIS attempt: a contrarian claim — challenge "
    "something this audience believes.",
    "Hook mechanism for THIS attempt: a costly mistake or hidden stakes — "
    "'you're losing X' / 'this breaks Y'.",
]

_PERF_PREAMBLE = (
    "Use the performance context below to inform your idea — "
    "lean into the angles and topics that worked, "
    "avoid the patterns that flopped, "
    "and look for adjacent unexplored angles.\n\n"
)


class IdeaVerdict(BaseModel):
    """Judge output: which candidate wins and why."""

    winner_index: int = Field(ge=0)
    reasoning: str


JUDGE_INSTRUCTIONS = """You judge short-form video ideas for a niche.
Input is JSON: the niche brief plus a numbered list of candidate Ideas.

Pick the ONE candidate most likely to earn high completion rate and
shares from this exact audience. Weigh, in order:
1. Hook strength — would a scroller stop within 1 second?
2. Payoff clarity — does the angle promise something concrete the video
   can actually deliver in under a minute?
3. Freshness — penalize anything generic or likely already seen.
Return the winning index (0-based) and one sentence of reasoning.
"""


def build_ideation_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="Ideation",
        instructions=IDEATION_INSTRUCTIONS,
        output_type=Idea,
    )


def build_idea_judge_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="IdeaJudge",
        instructions=JUDGE_INSTRUCTIONS,
        output_type=IdeaVerdict,
    )


def build_ideation_prompt(
    niche_title: str,
    *,
    performance_context: str = "",
    niche_description: str = "",
    target_audience: str = "",
    platform: str = "",
    brand_voice: str = "",
    banned_words: list[str] | None = None,
    recent_topics: list[str] | None = None,
    lens: str = "",
) -> str:
    """Construct the user-turn prompt for the ideation agent.

    Only ``niche_title`` is required; every enrichment degrades to absent
    lines so cold-start niches (or old callers/tests) behave identically
    to the previous title-only prompt.
    """
    lines: list[str] = []
    if performance_context:
        lines.append(f"{_PERF_PREAMBLE}{performance_context}\n")
    lines.append(f"Niche: {niche_title}")
    if niche_description:
        lines.append(f"About: {niche_description}")
    if target_audience:
        lines.append(f"Audience: {target_audience}")
    if platform:
        lines.append(f"Platform: {platform}")
    if brand_voice:
        lines.append(f"Brand voice: {brand_voice}")
    if banned_words:
        lines.append(f"Never use these words: {', '.join(banned_words)}")
    if recent_topics:
        lines.append(
            "Do-not-repeat list (recent videos):\n- " + "\n- ".join(recent_topics)
        )
    if lens:
        lines.append(lens)
    return "\n".join(lines)


async def run_ideation(
    niche_title: str,
    *,
    performance_context: str = "",
    niche_description: str = "",
    target_audience: str = "",
    platform: str = "",
    brand_voice: str = "",
    banned_words: list[str] | None = None,
    recent_topics: list[str] | None = None,
    spend: "SpendContext | None" = None,
) -> Idea:
    """Generate `settings.ideation_candidates` ideas and return the winner.

    With 1 candidate this is the original single-shot call (no judge).
    Judge failures fall back to the first candidate — the tournament is
    an upgrade, never a new failure mode.
    """
    agent = build_ideation_agent()
    n = max(1, settings.ideation_candidates)

    def _prompt(lens: str) -> str:
        return build_ideation_prompt(
            niche_title,
            performance_context=performance_context,
            niche_description=niche_description,
            target_audience=target_audience,
            platform=platform,
            brand_voice=brand_voice,
            banned_words=banned_words,
            recent_topics=recent_topics,
            lens=lens,
        )

    if n == 1:
        result = await run_metered(agent, _prompt(""), spend=spend)
        return result.final_output_as(Idea)

    lenses = [CANDIDATE_LENSES[i % len(CANDIDATE_LENSES)] for i in range(n)]
    results = await asyncio.gather(
        *[run_metered(agent, _prompt(lens), spend=spend) for lens in lenses],
        # Tolerate partial failure: one bad candidate must not abort the
        # tournament while its awaited siblings' spend is already logged.
        return_exceptions=True,
    )
    if any(isinstance(r, asyncio.CancelledError) for r in results):
        raise asyncio.CancelledError

    from ..repos.spend import SpendCapExceeded

    errors = [r for r in results if isinstance(r, BaseException)]
    # A cap breach anywhere ends the run — money safety beats tournament
    # completeness, and the next stage would refuse to spend anyway.
    for e in errors:
        if isinstance(e, SpendCapExceeded):
            raise e

    candidates: list[Idea] = []
    for r in results:
        if isinstance(r, BaseException):
            continue
        try:
            candidates.append(r.final_output_as(Idea))
        except Exception:  # noqa: BLE001 — one malformed candidate is survivable
            continue
    if not candidates:
        raise errors[0] if errors else RuntimeError("ideation produced no candidates")
    if len(candidates) == 1:
        return candidates[0]

    try:
        judge_payload = build_ideation_prompt(
            niche_title,
            niche_description=niche_description,
            target_audience=target_audience,
            platform=platform,
        ) + "\n\nCandidates:\n" + "\n".join(
            f"{i}: {c.model_dump_json()}" for i, c in enumerate(candidates)
        )
        verdict_result = await run_metered(
            build_idea_judge_agent(), judge_payload, spend=spend
        )
        verdict = verdict_result.final_output_as(IdeaVerdict)
        if 0 <= verdict.winner_index < len(candidates):
            return candidates[verdict.winner_index]
    except Exception as exc:  # noqa: BLE001 — tournament never becomes a failure mode
        from ..repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise  # cap breach must propagate; only judge failures fall back
    return candidates[0]
