"""Trend research for a niche: what to make next, and in which format.

One report answers three questions for a niche: which THEMES are live
right now, which HOOKS open a loop on them, and which ANGLES are worth a
video (each already matched to a `formats.registry` format, because
"5 mistakes" and "what actually happens when…" are different videos).

How it is grounded
------------------
Search grounding reuses `articles.exa` — the one research vendor this
product has. When `MARKETER_EXA_API_KEY` is unset (or Exa errors), Exa
returns `[]` and this module degrades to the model's own knowledge with
``grounded=False`` on the report and a note saying so, exactly as the
article pipeline does. A trend report without citations still beats a
failed job, and the flag means the UI never presents ungrounded output
as sourced.

Sources on the report are taken from the Exa results themselves, never
from the model. A model asked to cite will invent plausible URLs, and an
invented citation is worse than none.

Money
-----
The single LLM call goes through `agents.metered.run_metered`, which
calls `SpendContext.ensure_can_spend` before and `SpendContext.log`
after — the same contract every other paid call in this product honors.
Exa is not metered here for the same reason the article pipeline does
not meter it: it is a flat-rate research vendor, not a per-unit
generation provider.

This is the only module in the format/trends feature that does I/O.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field

from agents import Agent

from ..articles import exa
from ..config import settings
from ..evals.script_checks import HOOK_MAX_WORDS
from ..formats import registry
from ..logging import get_logger
from ..models import Niche
from ..services.spend_context import SpendContext  # noqa: TC001 — used in signature

log = get_logger(__name__)

# How many Exa results to pull per query. Three queries x 6 results is
# enough signal to spot a repeated theme without paying for a context
# window full of near-duplicate SERP text.
RESULTS_PER_QUERY = 6
# Excerpt budget per source in the prompt. Whole pages would triple the
# token cost of the call for material the model only needs to skim.
EXCERPT_CHARS = 700
MAX_SOURCES = 12


class TrendTheme(BaseModel):
    """A subject the niche's audience is engaging with right now."""

    theme: str
    # Why it is live *now* — a theme without timing is just a topic, and
    # the whole point of trend research is the timing.
    why_now: str
    # What in the research (or in the model's knowledge) supports it.
    evidence: str = ""


class TrendHook(BaseModel):
    """One scroll-stopping first line, with the loop it opens."""

    hook: str
    # What question the hook leaves open. A hook whose loop cannot be
    # named is a statement, and statements do not survive the swipe.
    open_loop: str
    theme: str = ""


class TrendAngle(BaseModel):
    """A specific video worth making, already matched to a format."""

    title: str
    # Key into `formats.registry`. Normalized after the model answers —
    # an unknown key would otherwise blow up at script time.
    format_key: str = registry.DEFAULT_FORMAT_KEY
    why: str = ""
    hook: str = ""


class TrendSource(BaseModel):
    """One page the research actually saw. Never model-authored."""

    title: str
    url: str
    domain: str = ""


class TrendFindings(BaseModel):
    """The model's half of the report (structured LLM output)."""

    themes: list[TrendTheme] = Field(default_factory=list)
    hooks: list[TrendHook] = Field(default_factory=list)
    angles: list[TrendAngle] = Field(default_factory=list)


class TrendReport(BaseModel):
    """A finished report: findings + the sources and caveats behind them."""

    niche_title: str = ""
    queries: list[str] = Field(default_factory=list)
    themes: list[TrendTheme] = Field(default_factory=list)
    hooks: list[TrendHook] = Field(default_factory=list)
    angles: list[TrendAngle] = Field(default_factory=list)
    sources: list[TrendSource] = Field(default_factory=list)
    # False when Exa was unconfigured or failed: the findings are model
    # knowledge only. The UI must not present these as sourced.
    grounded: bool = False
    # Human-readable caveats (ungrounded run, over-long hooks, …).
    notes: list[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


INSTRUCTIONS = """You are a short-form content strategist doing trend research.

You are given a niche brief, optionally some recent search results, and a
do-not-repeat list of topics this account has already covered.

Return:
- THEMES: subjects this audience is engaging with now. Each needs a
  reason it is live *now* — a theme with no timing is just a topic.
- HOOKS: first lines, under 12 spoken words, that open a loop. Every
  hook must name the specific thing (not "your body" but "the gum you
  swallowed"), and you must be able to state the question it leaves
  open. Never open with a greeting or "in this video".
- ANGLES: specific videos worth making. Each names the format that fits
  its shape, from this list only:
{format_menu}

Rules:
- Prefer the concrete and checkable over the broad and safe.
- Never propose a topic on the do-not-repeat list, or a near-duplicate.
- If the search results do not support a theme, do not invent support
  for it; say what you actually know.
- Never output URLs or citations. Sources are attached separately from
  the real search results, and an invented citation is worse than none.
"""


def build_agent() -> Agent:
    """The research agent. Built per call so the format menu stays fresh."""
    menu = "\n".join(
        f"  - {f.key}: {f.label} — {f.description} "
        f"({f.contract.summary()}; ~{f.target_duration_sec}s)"
        for f in registry.FORMATS
    )
    return Agent(
        model=settings.agent_model,
        name="TrendResearcher",
        instructions=INSTRUCTIONS.format(format_menu=menu),
        output_type=TrendFindings,
    )


def research_queries(niche: Niche) -> list[str]:
    """Search queries for a niche. Pure — the caller does the fetching.

    Three complementary angles rather than one broad query: "trends"
    surfaces what is being published, "why/how" surfaces the questions
    people actually type (which is where hooks come from), and the
    audience query keeps the results in this account's lane instead of
    the topic's most generic version.
    """
    title = (niche.title or "").strip()
    if not title:
        return []
    audience = (niche.target_audience or "").strip()
    queries = [
        f"{title} trending topics this month",
        f"{title} questions people ask",
    ]
    if audience:
        queries.append(f"{title} for {audience} what people are talking about")
    return queries


def _dedupe_sources(pages: list[dict]) -> list[dict]:
    """Drop repeats by URL, keeping first-seen order (rank order)."""
    seen: set[str] = set()
    out: list[dict] = []
    for page in pages:
        url = (page.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(page)
    return out


def _research_block(pages: list[dict]) -> str:
    lines: list[str] = []
    for i, page in enumerate(pages, start=1):
        excerpt = (page.get("excerpt") or "")[:EXCERPT_CHARS]
        highlights = " ".join(page.get("highlights") or [])[:EXCERPT_CHARS]
        lines.append(
            f"[{i}] {page.get('title') or 'untitled'} ({page.get('domain') or ''})\n"
            f"{highlights or excerpt}"
        )
    return "\n\n".join(lines)


def build_prompt(
    niche: Niche,
    *,
    pages: list[dict],
    recent_topics: list[str],
) -> str:
    """Assemble the research prompt. Pure, so it is testable for free."""
    parts = [
        "NICHE BRIEF",
        f"Title: {niche.title}",
        f"Description: {niche.description}",
        f"Audience: {niche.target_audience}",
        f"Platforms: {', '.join(niche.platforms)}",
        f"Typical runtime: {niche.target_duration_sec}s in {niche.scene_count} scenes",
    ]
    if recent_topics:
        parts.append(
            "DO NOT REPEAT (already covered):\n"
            + "\n".join(f"- {t}" for t in recent_topics[:20])
        )
    if pages:
        parts.append("SEARCH RESULTS\n" + _research_block(pages))
    else:
        # Told explicitly, so the model reports what it knows instead of
        # dressing up model knowledge as if it had read something.
        parts.append(
            "SEARCH RESULTS: none available (search is not configured). "
            "Work from your own knowledge and say so where it matters."
        )
    return "\n\n".join(parts)


def _word_count(text: str) -> int:
    return len(text.split())


def _normalize(findings: TrendFindings) -> tuple[TrendFindings, list[str]]:
    """Repair what the model got wrong, and note what could not be repaired.

    Two things go wrong reliably: an angle names a format key that does
    not exist (which would raise at script time, long after the user
    approved the angle), and a hook runs past the 12-word / 3-second
    budget the whole product is built around. The first is repaired
    silently to the default format; the second is kept but flagged,
    because shortening someone's hook changes what the video is about.
    """
    notes: list[str] = []
    angles: list[TrendAngle] = []
    for angle in findings.angles:
        if registry.get_format(angle.format_key) is None:
            notes.append(
                f"angle {angle.title!r} named unknown format "
                f"{angle.format_key!r}; defaulted to {registry.DEFAULT_FORMAT_KEY}"
            )
            angle = angle.model_copy(update={"format_key": registry.DEFAULT_FORMAT_KEY})
        angles.append(angle)

    long_hooks = [h.hook for h in findings.hooks if _word_count(h.hook) > HOOK_MAX_WORDS]
    if long_hooks:
        notes.append(
            f"{len(long_hooks)} hook(s) exceed {HOOK_MAX_WORDS} words and will "
            "not land inside the first 3 seconds; tighten before use"
        )
    return findings.model_copy(update={"angles": angles}), notes


async def gather_sources(niche: Niche) -> tuple[list[dict], list[str]]:
    """Run the niche's queries through Exa. Returns (pages, queries).

    Degrades to `[]` rather than raising: `exa.serp_pages` already
    swallows an unconfigured key and a vendor outage, and a trend report
    from model knowledge beats a failed run.
    """
    queries = research_queries(niche)
    pages: list[dict] = []
    for query in queries:
        pages.extend(await exa.serp_pages(query, num_results=RESULTS_PER_QUERY))
    return _dedupe_sources(pages)[:MAX_SOURCES], queries


async def research_trends(
    niche: Niche,
    *,
    spend: SpendContext | None = None,
    recent_topics: list[str] | None = None,
) -> TrendReport:
    """Produce one trend report for a niche (one metered LLM call)."""
    from ..agents.metered import run_metered

    pages, queries = await gather_sources(niche)
    grounded = bool(pages)
    if not grounded:
        log.info("trend research running ungrounded (no search results)")

    prompt = build_prompt(niche, pages=pages, recent_topics=recent_topics or [])
    result = await run_metered(build_agent(), prompt, spend=spend, sku="llm:trend-research")
    findings, notes = _normalize(result.final_output_as(TrendFindings))

    if not grounded:
        notes.insert(
            0,
            "Search was unavailable, so these findings are model knowledge "
            "only and carry no sources.",
        )
    return TrendReport(
        niche_title=niche.title,
        queries=queries,
        themes=findings.themes,
        hooks=findings.hooks,
        angles=findings.angles,
        sources=[
            TrendSource(
                title=p.get("title") or "",
                url=p.get("url") or "",
                domain=p.get("domain") or "",
            )
            for p in pages
        ],
        grounded=grounded,
        notes=notes,
    )


async def run_trend_research(*, user_id: str, report_id: UUID) -> dict:
    """Drive one stored trend report to a terminal state.

    queued -> researching -> done | failed. This is what the Modal
    entrypoint calls. Every failure lands on the row as `failed` with a
    message: a report stuck in `researching` is invisible to the user and
    un-retryable.
    """
    from ..repos import jobs as jobs_repo
    from ..repos import niches as niches_repo
    from ..repos import trend_reports as reports_repo
    from ..services.spend_context import default_context

    row = await reports_repo.get(report_id, user_id=user_id)
    if row is None:
        raise ValueError(f"trend report {report_id} not found for {user_id}")

    niche = await niches_repo.get(row["niche_id"], user_id=user_id)
    if niche is None:
        return await reports_repo.fail(report_id, user_id=user_id, error="niche not found")

    await reports_repo.set_status(report_id, user_id=user_id, status="researching")
    spend = await default_context(
        user_id=user_id,
        niche_id=niche.id,
        job_id=None,
        cap_usd=niche.daily_spend_cap_usd,
    )
    try:
        recent = await jobs_repo.recent_topics_for_niche(niche.id, user_id=user_id, limit=20)
    except Exception:  # noqa: BLE001 — dedupe context is a nicety, not a gate
        log.warning("could not load recent topics for trend dedupe")
        recent = []

    try:
        report = await research_trends(niche, spend=spend, recent_topics=recent)
    except Exception as exc:  # noqa: BLE001 — every failure must land on the row
        log.exception("trend research failed")
        return await reports_repo.fail(report_id, user_id=user_id, error=str(exc))

    return await reports_repo.complete(
        report_id,
        user_id=user_id,
        report=report.model_dump(mode="json"),
        grounded=report.grounded,
    )
