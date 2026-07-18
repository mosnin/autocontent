"""Content intelligence — cluster planning (LLM), corpus audit, and
cannibalization detection (both deterministic, no LLM). Owned by Team
Content-Intel; persistence goes through repos/content_intel.py.

`plan_cluster` mirrors the metered-call shape of `marketer.articles.llm`
(`_parse_call` + `_log_usage`, same SpendContext contract: pre-flight
`ensure_can_spend`, post-call `spend.log`, `SpendCapExceeded` propagates to
the caller exactly like every other agent call in the pipeline) rather than
importing it, since articles/llm.py is owned by another team and this repo's
convention is to duplicate the tiny call helper per module rather than share
a mutable dependency across team boundaries (see routes/press.py for the
same pattern one layer up: it calls `llm.propose_topics` and translates
`SpendCapExceeded` to a 402 itself).

`audit_corpus` and `detect_cannibalization` never touch the network — they
score/compare data already sitting in Postgres via
`articles_repo.list_for_intel`.
"""
from __future__ import annotations

import itertools
from datetime import datetime, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any

import openai
from pydantic import BaseModel, ConfigDict, Field

from ..config import settings
from ..repos import articles as articles_repo
from ..repos import content_intel as repo
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext

_client: openai.AsyncOpenAI | None = None


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


# ---------------------------------------------------------------------------
# (a) plan_cluster — one metered LLM call
# ---------------------------------------------------------------------------


class ClusterSpokePick(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str
    focusKeyword: str


class ClusterPlanBatch(BaseModel):
    """Wrapper so the single structured-output call can return the pillar
    title plus every spoke in one shot (OpenAI's parse() needs a top-level
    object, same reason TopicProposalBatch wraps propose_topics)."""

    model_config = ConfigDict(extra="ignore")

    pillarTitle: str = ""
    spokes: list[ClusterSpokePick] = Field(default_factory=list)


class ClusterPlanSpoke(BaseModel):
    title: str
    focus_keyword: str
    covered: bool


class ClusterPlanResult(BaseModel):
    pillar_title: str
    spokes: list[ClusterPlanSpoke]


# Minimum SEQUENCE_MATCHER ratio (over lowercased titles) for an LLM-proposed
# spoke to be considered already covered by an existing corpus title. Higher
# than the cannibalization threshold below because a false "covered" mark
# silently drops a spoke from the plan, so it should take a near-exact title
# match, not just topical overlap.
CLUSTER_COVERAGE_THRESHOLD = 0.82

# Minimum/maximum spokes requested from the model per plan.
MIN_SPOKES = 6
MAX_SPOKES = 10


async def _log_usage(resp: object, model: str, spend: SpendContext | None) -> None:
    if spend is None:
        return
    u = getattr(resp, "usage", None)
    if u is None:
        return
    in_tok = int(getattr(u, "prompt_tokens", None) or getattr(u, "input_tokens", 0) or 0)
    out_tok = int(
        getattr(u, "completion_tokens", None) or getattr(u, "output_tokens", 0) or 0
    )
    await spend.log(
        provider="openai",
        sku=f"llm:{model}",
        units=Decimal(in_tok + out_tok),
        cost_usd=llm_cost(model, in_tok, out_tok),
    )


async def _parse_call(
    *, model: str, system: str, user: str, response_format, temperature: float,
    spend: SpendContext | None,
):
    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)
    resp = await _oai().beta.chat.completions.parse(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format=response_format,
        temperature=temperature,
    )
    await _log_usage(resp, model, spend)
    parsed = resp.choices[0].message.parsed
    if parsed is None:
        raise RuntimeError(f"{response_format.__name__}: model returned no parsed payload")
    return parsed


def _title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").strip().lower(), (b or "").strip().lower()).ratio()


async def plan_cluster(
    niche,
    brand,
    corpus_titles: list[str],
    pillar_keyword: str,
    *,
    spend: SpendContext | None = None,
) -> ClusterPlanResult:
    """Build a pillar + 6-10 spoke topic cluster around `pillar_keyword`.

    `niche`/`brand` are duck-typed exactly like `articles.llm.propose_topics`
    (`niche` needs `.title`/`.description`, `brand` optional needs
    `.tone_of_voice`) so this stays decoupled from the repo layer.

    Spokes whose title is a near-duplicate (>= CLUSTER_COVERAGE_THRESHOLD
    SequenceMatcher ratio) of an existing corpus title are marked
    `covered=True` rather than dropped, so the caller can persist them as
    already-satisfied cluster items instead of silently losing the slot.
    """
    niche_title = getattr(niche, "title", "") or ""
    niche_description = getattr(niche, "description", "") or ""
    tone = (getattr(brand, "tone_of_voice", "") or "") if brand is not None else ""

    system = (
        "You are an SEO content strategist building a topic cluster around "
        "one pillar keyword. Propose a pillar article title, then "
        f"{MIN_SPOKES} to {MAX_SPOKES} distinct spoke article titles, each "
        "with its own specific long-tail focus keyword that supports the "
        "pillar without duplicating it or each other. Never use em-dashes "
        "or en-dashes."
    )
    user = (
        f"Niche: {niche_title}\n"
        f"Description: {niche_description}\n"
        f"Brand voice: {tone or 'none specified'}\n"
        f"Pillar keyword: {pillar_keyword}\n\n"
        f"Existing article titles (avoid duplicating; mark nothing, just "
        f"don't repeat these):\n"
        + "\n".join(f"- {t}" for t in corpus_titles[:25])
        + f"\n\nReturn a pillarTitle plus {MIN_SPOKES} to {MAX_SPOKES} spokes."
    )
    batch: ClusterPlanBatch = await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=ClusterPlanBatch, temperature=0.8, spend=spend,
    )

    spokes: list[ClusterPlanSpoke] = []
    for pick in batch.spokes[:MAX_SPOKES]:
        covered = any(
            _title_similarity(pick.title, existing) >= CLUSTER_COVERAGE_THRESHOLD
            for existing in corpus_titles
        )
        spokes.append(
            ClusterPlanSpoke(title=pick.title, focus_keyword=pick.focusKeyword, covered=covered)
        )

    return ClusterPlanResult(pillar_title=batch.pillarTitle or pillar_keyword, spokes=spokes)


# ---------------------------------------------------------------------------
# (b) audit_corpus — NO LLM, scored from stored data
# ---------------------------------------------------------------------------

# Score is a 0-100 sum of five weighted components. Each component is
# independently capped at its weight so a missing/bad signal on one axis
# never drags the others down.
QUALITY_WEIGHT = Decimal("40")
FRESHNESS_WEIGHT = Decimal("20")
HERO_WEIGHT = Decimal("15")
META_WEIGHT = Decimal("15")
LINKS_WEIGHT = Decimal("10")

# Freshness: full credit through FRESHNESS_FULL_DAYS, linear decay to zero
# credit at FRESHNESS_ZERO_DAYS.
FRESHNESS_FULL_DAYS = 90
FRESHNESS_ZERO_DAYS = 365

# Meta description: full credit at/above this length (chars); partial
# credit below it, proportional to length.
META_MIN_CHARS = 50

# Internal links: full credit at/above this many stored link_suggestions;
# partial credit below it, proportional to count.
LINKS_FULL_COUNT = 5

# Below this score, an article gets a "needs attention" finding of its own
# (in addition to the per-component findings that produced the low score).
LOW_SCORE_THRESHOLD = 50.0


def _score_article(article: dict[str, Any], *, now: datetime) -> tuple[float, list[dict]]:
    findings: list[dict] = []

    quality = article.get("quality") or {}
    overall = quality.get("overall") if isinstance(quality, dict) else None
    if overall is None:
        quality_pts = Decimal("0")
        findings.append({
            "code": "no_quality_score", "severity": "medium",
            "message": "no stored quality score for this article",
        })
    else:
        overall = max(0.0, min(1.0, float(overall)))
        quality_pts = QUALITY_WEIGHT * Decimal(str(overall))
        if overall < 0.6:
            findings.append({
                "code": "low_quality_score", "severity": "high",
                "message": f"quality score {overall:.2f} is below 0.6",
            })

    created_at = article.get("created_at")
    if created_at is None:
        age_days = FRESHNESS_ZERO_DAYS
    else:
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age_days = max(0, (now - created_at).days)

    if age_days <= FRESHNESS_FULL_DAYS:
        freshness_pts = FRESHNESS_WEIGHT
    elif age_days >= FRESHNESS_ZERO_DAYS:
        freshness_pts = Decimal("0")
        findings.append({
            "code": "stale", "severity": "high",
            "message": f"article is {age_days} days old and due for a refresh",
        })
    else:
        span = FRESHNESS_ZERO_DAYS - FRESHNESS_FULL_DAYS
        frac = Decimal(span - (age_days - FRESHNESS_FULL_DAYS)) / Decimal(span)
        freshness_pts = FRESHNESS_WEIGHT * frac
        findings.append({
            "code": "aging", "severity": "medium",
            "message": f"article is {age_days} days old; consider a refresh",
        })

    if article.get("hero_image_path"):
        hero_pts = HERO_WEIGHT
    else:
        hero_pts = Decimal("0")
        findings.append({
            "code": "missing_hero", "severity": "medium",
            "message": "no hero image on file",
        })

    meta = article.get("meta_description") or ""
    if len(meta) >= META_MIN_CHARS:
        meta_pts = META_WEIGHT
    elif meta:
        meta_pts = META_WEIGHT * Decimal(len(meta)) / Decimal(META_MIN_CHARS)
        findings.append({
            "code": "weak_meta_description", "severity": "low",
            "message": f"meta description is {len(meta)} chars (want >= {META_MIN_CHARS})",
        })
    else:
        meta_pts = Decimal("0")
        findings.append({
            "code": "missing_meta_description", "severity": "medium",
            "message": "no meta description on file",
        })

    links = article.get("link_suggestions") or []
    link_count = len(links)
    links_pts = LINKS_WEIGHT * Decimal(min(link_count, LINKS_FULL_COUNT)) / Decimal(LINKS_FULL_COUNT)
    if link_count == 0:
        findings.append({
            "code": "no_internal_links", "severity": "medium",
            "message": "no internal link suggestions on file",
        })

    score = float((quality_pts + freshness_pts + hero_pts + meta_pts + links_pts).quantize(Decimal("0.01")))
    if score < LOW_SCORE_THRESHOLD:
        findings.insert(0, {
            "code": "needs_attention", "severity": "high",
            "message": f"overall score {score:.1f} is below {LOW_SCORE_THRESHOLD:.0f}",
        })
    return score, findings


async def audit_corpus(user_id: str) -> list[repo.ArticleAudit]:
    """Score every 'done' article in the user's corpus from stored data
    (no LLM call) and persist one article_audits row per article."""
    from ..articles.models import ArticleStatus

    articles = await articles_repo.list_for_intel(user_id, status=ArticleStatus.done)
    now = datetime.now(timezone.utc)
    out: list[repo.ArticleAudit] = []
    for article in articles:
        score, findings = _score_article(article, now=now)
        out.append(
            await repo.save_audit(
                user_id=user_id, article_id=article["id"], score=score, findings=findings
            )
        )
    return out


# ---------------------------------------------------------------------------
# (c) detect_cannibalization — NO LLM, difflib SequenceMatcher
# ---------------------------------------------------------------------------

# A pair is flagged when the blended similarity below meets/exceeds this
# ratio. 0.72 is deliberately conservative: two articles with genuinely
# distinct long-tail keywords rarely blend above ~0.5-0.6 even when their
# titles share several common SEO words ("best", "guide", "2026"), while
# true near-duplicates (same keyword, reworded title) land at 0.8+. Tuned
# against the reference cannibalization_resolver.py's 0.85 pure-embedding
# threshold, lowered slightly because SequenceMatcher on raw strings is a
# noisier signal than cosine similarity over embeddings.
CANNIBALIZATION_THRESHOLD = 0.72

# Blend weights for the two signals that make up a pair's similarity score.
TITLE_WEIGHT = 0.6
KEYWORD_WEIGHT = 0.4


def _pair_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    title_a = (a.get("title") or a.get("topic") or "").strip().lower()
    title_b = (b.get("title") or b.get("topic") or "").strip().lower()
    title_sim = SequenceMatcher(None, title_a, title_b).ratio()

    kw_a = (a.get("focus_keyword") or "").strip().lower()
    kw_b = (b.get("focus_keyword") or "").strip().lower()
    if kw_a and kw_b:
        keyword_sim = SequenceMatcher(None, kw_a, kw_b).ratio()
    else:
        # No focus keyword on one/both sides — fall back to the title
        # signal alone rather than letting an empty-string comparison
        # (which SequenceMatcher scores as a perfect, meaningless 1.0)
        # distort the blend.
        keyword_sim = title_sim

    return title_sim * TITLE_WEIGHT + keyword_sim * KEYWORD_WEIGHT


async def detect_cannibalization(user_id: str) -> list[repo.CannibalizationFinding]:
    """Pairwise-compare every 'done' article's title + focus keyword and
    persist a finding for each pair at/above CANNIBALIZATION_THRESHOLD.
    Pairs are ordered by string id (article_a < article_b) so a re-scan
    upserts the same row instead of creating the reverse duplicate."""
    from ..articles.models import ArticleStatus

    articles = await articles_repo.list_for_intel(user_id, status=ArticleStatus.done)
    out: list[repo.CannibalizationFinding] = []
    for a, b in itertools.combinations(articles, 2):
        similarity = _pair_similarity(a, b)
        if similarity < CANNIBALIZATION_THRESHOLD:
            continue
        id_a, id_b = a["id"], b["id"]
        first, second = (a, b) if str(id_a) < str(id_b) else (b, a)
        keyword = first.get("focus_keyword") or second.get("focus_keyword") or ""
        out.append(
            await repo.upsert_finding(
                user_id=user_id,
                article_a=first["id"],
                article_b=second["id"],
                keyword=keyword,
                similarity=round(similarity, 4),
            )
        )
    return out
