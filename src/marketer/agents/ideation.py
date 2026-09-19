"""Ideation: propose the topic, angle, and hook for the next video.

Default path is templates + one Jev Choice. The leftover writer hop is
n==1 with an operator hook lens (Qwen-first when OpenRouter is on).
A 3-way LLM tournament is not reachable on the stock template set.
"""
from __future__ import annotations

from agents import Agent
from pydantic import BaseModel, Field

from ..config import settings
from ..models import Idea
from ..models.creative_brief import CreativeBrief
from ..services.spend_context import SpendContext
from .metered import run_metered

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


def idea_candidates(
    niche_title: str,
    *,
    niche_description: str = "",
    target_audience: str = "",
    platform: str = "",
    recent_topics: list[str] | None = None,
    banned_words: list[str] | None = None,
    limit: int = 5,
) -> list[Idea]:
    """Deterministic idea set — Jev picks, Qwen does not invent three hooks.

    Production ideation used to buy N chat completions before a judge.
    Templates + one Jev composite score is the 70–500ms path.
    """
    title = (niche_title or "this niche").strip() or "this niche"
    audience = (target_audience or "this audience").strip() or "this audience"
    plat = (platform or "short-form").strip()
    recent = {t.strip().casefold() for t in (recent_topics or []) if t.strip()}
    banned = {w.strip().casefold() for w in (banned_words or []) if w.strip()}
    raw = [
        Idea(
            topic=f"The {title} mistake that wastes the first week",
            angle="costly mistake",
            hook=f"You're doing {title} the hard way",
            target_audience=audience,
            why_it_works="loss aversion plus a concrete first-week payoff",
        ),
        Idea(
            topic=f"What {audience} get wrong about {title}",
            angle="contrarian",
            hook=f"{audience} keep getting {title} backwards",
            target_audience=audience,
            why_it_works="identity challenge stops the scroll on " + plat,
        ),
        Idea(
            topic=f"How {title} actually works in 60 seconds",
            angle="curiosity gap",
            hook=f"Nobody explains {title} this simply",
            target_audience=audience,
            why_it_works="open loop plus a promised 60-second payoff",
        ),
        Idea(
            topic=f"The {title} checklist that actually ships",
            angle="practical payoff",
            hook=f"Steal this {title} checklist",
            target_audience=audience,
            why_it_works="tangible artifact the viewer can screenshot",
        ),
        Idea(
            topic=f"Stop treating {title} like a beginner",
            angle="stakes",
            hook=f"This {title} habit is costing you",
            target_audience=audience,
            why_it_works="status plus a hidden cost the niche already feels",
        ),
    ]
    if niche_description:
        raw.append(
            Idea(
                topic=niche_description.strip()[:80],
                angle="first principles",
                hook=f"{title}: the part nobody mentions",
                target_audience=audience,
                why_it_works="pattern interrupt from the niche's own brief",
            )
        )
    out: list[Idea] = []
    for idea in raw:
        blob = f"{idea.topic} {idea.hook}".casefold()
        if idea.topic.casefold() in recent:
            continue
        if any(word in blob for word in banned):
            continue
        out.append(idea)
        if len(out) >= limit:
            break
    return out or raw[:limit]


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
    brief: CreativeBrief | None = None,
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
    if brief is not None:
        lines.extend(brief.ideation_lines())
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
    brief: CreativeBrief | None = None,
    spend: SpendContext | None = None,
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
            brief=brief,
        )

    templates = idea_candidates(
        niche_title,
        niche_description=niche_description,
        target_audience=target_audience,
        platform=platform,
        recent_topics=recent_topics,
        banned_words=banned_words,
        limit=max(n, 4),
    )
    # n==1 is the last writer hop (prompt-injection + a lone operator
    # lens). n≥2 is templates + Jev; a dark harness does not buy a
    # tournament just because four templates exist.
    if n >= 2 and len(templates) >= 2:
        try:
            from ..config import settings as _settings
            from ..jev import available as jev_available
            from ..jev.decisions import judge_ideas

            # Templates + one System One fan-out (Jev or Qwen wrapper).
            if _settings.jev_enabled and jev_available():
                judge_prompt = build_ideation_prompt(
                    niche_title,
                    niche_description=niche_description,
                    target_audience=target_audience,
                    platform=platform,
                )
                pick = await judge_ideas(judge_prompt, templates, spend=spend)
                if 0 <= pick.winner_index < len(templates):
                    return templates[pick.winner_index]
        except Exception as exc:
            from ..repos.spend import SpendCapExceeded

            if isinstance(exc, SpendCapExceeded):
                raise
        # Dark harness / judge miss: first template. Classification is
        # not worth a 3-way writer tournament.
        return templates[0]

    async def _write(prompt: str):
        from ..services import openrouter

        return await run_metered(
            agent,
            prompt,
            spend=spend,
            **openrouter.generation_metered(agent),
        )

    if n == 1:
        # Operator-chosen hook lens still buys one writer shot. Without
        # a lens, a template is the same as dark n≥2 — no invented hook.
        solo_lens = (brief.candidate_lenses() if brief else [])
        if solo_lens:
            result = await _write(_prompt(solo_lens[0]))
            return result.final_output_as(Idea)
        if templates:
            return templates[0]
        result = await _write(_prompt(""))
        return result.final_output_as(Idea)

    # n≥2 with fewer than 2 templates is unreachable on the stock set
    # (limit=max(n, 4)). Do not resurrect a writer tournament.
    if templates:
        return templates[0]
    result = await _write(_prompt(""))
    return result.final_output_as(Idea)
