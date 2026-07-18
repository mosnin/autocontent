"""Keyword research — harvest candidate keywords via one metered LLM call,
and score SERP difficulty via Exa.

Mirrors the article pipeline's plumbing without touching it: the same
OpenAI-client + SpendContext metering contract as ``marketer.articles.llm``
(one call, log usage, let SpendCapExceeded propagate to the route), and the
same Exa fetch as ``marketer.articles.exa.serp_pages`` (imported directly,
not reimplemented) with the same "degrade, don't raise" contract when Exa
isn't configured or the fetch fails.
"""
from __future__ import annotations

from decimal import Decimal
from urllib.parse import urlparse

import openai
from pydantic import BaseModel, ConfigDict, Field

from ..articles.exa import serp_pages
from ..config import settings
from ..logging import get_logger
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext

log = get_logger(__name__)

_client: openai.AsyncOpenAI | None = None
_PROVIDER = "openai"

# Used when the route's request body omits `n` (mirrors how POST
# /press/topics/generate falls back to settings.press_topic_batch — kept
# as a local constant here rather than a new settings field since
# config.py is out of scope for this module).
DEFAULT_HARVEST_N = 15


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


# ---------------------------------------------------------------------------
# Harvest — one metered LLM call proposing new keyword candidates
# ---------------------------------------------------------------------------


class HarvestPick(BaseModel):
    """One candidate keyword from a harvest batch."""

    model_config = ConfigDict(extra="ignore")

    keyword: str
    intent: str = ""
    rationale: str = ""


class HarvestBatch(BaseModel):
    """Wrapper so the structured-output call can request N picks from a
    single response (OpenAI's parse() needs a top-level object, same
    reason articles.llm.TopicProposalBatch wraps TopicProposalPick)."""

    model_config = ConfigDict(extra="ignore")

    keywords: list[HarvestPick] = Field(default_factory=list)


async def _log_usage(resp: object, model: str, spend: SpendContext | None) -> None:
    """Record the response's token cost into the spend ledger. Identical
    contract to articles.llm._log_usage: may raise SpendCapExceeded from
    spend.log() once the entry is recorded."""
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
        provider=_PROVIDER,
        sku=f"llm:{model}",
        units=Decimal(in_tok + out_tok),
        cost_usd=llm_cost(model, in_tok, out_tok),
    )


async def harvest(
    niche,
    brand,
    existing_keywords: list[str],
    n: int,
    *,
    spend: SpendContext | None = None,
) -> list[HarvestPick]:
    """One metered LLM call proposing up to `n` new keyword candidates.

    `niche`/`brand` are duck-typed the same way articles.llm.propose_topics
    takes them (niche needs .title/.description, brand — optional, may be
    None — needs .tone_of_voice), so this module stays decoupled from the
    repo layer.

    Spend-cap failures propagate: ``spend.ensure_can_spend``/``spend.log``
    raise ``SpendCapExceeded`` straight through, same as every other
    metered call in this codebase — the route maps that to 402. Everything
    else is fail-soft: a transport error, an empty response, or a
    malformed parse yields an empty list rather than an unhandled 500,
    since a harvest batch is disposable (nothing downstream depends on a
    non-empty result — the caller just gets fewer candidates than asked
    for and can retry).
    """
    niche_title = getattr(niche, "title", "") or ""
    niche_description = getattr(niche, "description", "") or ""
    tone = (getattr(brand, "tone_of_voice", "") or "") if brand is not None else ""

    system = (
        "You are an SEO keyword researcher. Given a content niche, propose "
        "distinct, winnable keyword candidates a content team could target. "
        "Mix head and long-tail terms and cover a spread of intents "
        "(informational, commercial, transactional, navigational). Each "
        "candidate needs a one-sentence rationale explaining why it's worth "
        "targeting. Never propose a keyword that duplicates one already "
        "harvested. Never use em-dashes or en-dashes."
    )
    user = (
        f"Niche: {niche_title}\n"
        f"Description: {niche_description}\n"
        f"Brand voice: {tone or 'none specified'}\n\n"
        "Already-harvested keywords (do not repeat):\n"
        + "\n".join(f"- {k}" for k in existing_keywords[:100])
        + f"\n\nPropose exactly {n} distinct keyword candidates."
    )

    model = settings.article_writer_model
    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)

    try:
        resp = await _oai().beta.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=HarvestBatch,
            temperature=0.8,
        )
    except openai.OpenAIError as exc:
        log.warning("keyword harvest LLM call failed", extra={"error": str(exc)})
        return []

    # Runs after the try/except (not inside it): a SpendCapExceeded raised
    # here is a real cap trip, not a transport failure, and must propagate.
    await _log_usage(resp, model, spend)

    parsed: HarvestBatch | None = resp.choices[0].message.parsed
    if parsed is None:
        return []
    return parsed.keywords[:n]


# ---------------------------------------------------------------------------
# Difficulty scoring — Exa SERP fetch + a domain/title/URL heuristic
# ---------------------------------------------------------------------------

# Domains that out-rank almost any query on raw domain authority alone,
# regardless of how well a new page targets the keyword. A SERP dominated
# by these is hard to break into with fresh content.
_BIG_BRAND_DOMAINS = (
    "wikipedia.org", "reddit.com", "quora.com", "medium.com", "youtube.com",
    "amazon.com", "forbes.com", "nytimes.com", "linkedin.com", "pinterest.com",
    "shopify.com", "hubspot.com", "moz.com", "semrush.com", "ahrefs.com",
    "webmd.com", "healthline.com",
)


class KeywordDifficulty(BaseModel):
    keyword: str
    difficulty: float | None = None
    top_domains: list[str] = Field(default_factory=list)


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.removeprefix("www.")
    except Exception:  # noqa: BLE001
        return ""


def _is_homepage(url: str) -> bool:
    try:
        path = urlparse(url).path
    except Exception:  # noqa: BLE001
        return False
    return path in ("", "/")


def score_from_pages(keyword: str, pages: list[dict]) -> KeywordDifficulty:
    """Heuristic 0-100 difficulty from a SERP page list (the shape
    `articles.exa.serp_pages` returns: title/url/domain/... dicts).

    There's no backlink/page-rank data available without a paid SEO API,
    so this leans on three signals visible straight from the SERP itself:

      1. Big-brand share (up to 50 pts) — each of the top results coming
         from a domain in `_BIG_BRAND_DOMAINS` adds 10 points, capped at
         50. These sites rank on raw domain authority for almost any
         query, so a SERP full of them is hard competition regardless of
         content quality.
      2. Exact-title matches (up to 30 pts) — each result whose title
         contains the keyword phrase verbatim (case-insensitive) adds 6
         points, capped at 30. Pages already optimized for the exact
         phrase are the direct competition a new article has to out-write,
         as opposed to results that merely rank tangentially.
      3. Homepage share (up to 20 pts) — each result that IS a domain's
         homepage (path "" or "/") rather than a dedicated article/product
         page adds 10 points, capped at 20. A homepage ranking for a
         specific keyword means the whole site's authority is anchoring
         that term; a single new page rarely displaces a homepage.

    The three sub-scores are summed and clamped to [0, 100]. Returns
    difficulty=None when `pages` is empty — that's "no signal to score",
    not "difficulty of zero" (an empty SERP is not the same as an easy
    one; see `score_difficulty`, which is what actually decides when an
    empty list means "unconfigured" vs. "fetch came back empty").
    """
    if not pages:
        return KeywordDifficulty(keyword=keyword, difficulty=None, top_domains=[])

    needle = keyword.strip().lower()
    domains = [p.get("domain") or _domain(p.get("url") or "") for p in pages]

    big_brand_hits = sum(1 for d in domains if any(b in d for b in _BIG_BRAND_DOMAINS))
    exact_title_hits = sum(
        1 for p in pages if needle and needle in (p.get("title") or "").lower()
    )
    homepage_hits = sum(1 for p in pages if _is_homepage(p.get("url") or ""))

    score = (
        min(big_brand_hits * 10, 50)
        + min(exact_title_hits * 6, 30)
        + min(homepage_hits * 10, 20)
    )
    difficulty = float(min(100, max(0, score)))
    return KeywordDifficulty(keyword=keyword, difficulty=difficulty, top_domains=domains[:5])


async def score_difficulty(keyword: str, *, num_results: int = 10) -> KeywordDifficulty:
    """Fail-soft SERP difficulty lookup.

    Returns difficulty=None (never raises) when MARKETER_EXA_API_KEY isn't
    configured — same degrade-to-empty contract `serp_pages` itself uses —
    or when the fetch raises for any other reason, so a scoring failure
    never blocks the track/dismiss/promote flow around it.
    """
    if not settings.exa_api_key:
        return KeywordDifficulty(keyword=keyword, difficulty=None, top_domains=[])
    try:
        pages = await serp_pages(keyword, num_results=num_results)
    except Exception as exc:  # noqa: BLE001 — degrade, never block the caller
        log.warning("keyword difficulty SERP fetch failed", extra={"error": str(exc)})
        return KeywordDifficulty(keyword=keyword, difficulty=None, top_domains=[])
    return score_from_pages(keyword, pages)
