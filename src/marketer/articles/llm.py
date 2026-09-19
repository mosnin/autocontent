"""LLM calls for the article pipeline (structured outputs + prose).

Every function takes a ``spend`` context and logs the exact token cost of
the call into spend_ledger before returning — the same money contract as
every media provider in the video pipeline. A call that trips a cap
raises SpendCapExceeded from ``spend.log`` after recording.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal

import openai

from ..config import settings
from ..services import provider_fallback
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext
from .models import (
    ArticleMetadata,
    ImagePrompt,
    InterlinkSuggestion,
    Outline,
    QualityScore,
    SectionContext,
    SerpAnalysis,
    SocialSnippet,
    TopicPick,
)

_client: openai.AsyncOpenAI | None = None

PROVIDER = "openai"


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        from ..services.openai_shared import shared_client

        _client = shared_client()
    return _client


def resolve_article_writer_model() -> str:
    """Qwen via OpenRouter when the operator did not pin a different writer."""
    from ..jev.harness import default_generation_model
    from ..services import openrouter

    pinned = settings.article_writer_model
    if openrouter.get_model(pinned) is not None and openrouter.enabled():
        return pinned
    if pinned == settings.agent_model and openrouter.enabled():
        return default_generation_model()
    return pinned


def _chat_client(model: str):
    from ..services import openrouter

    if openrouter.get_model(model) is not None and openrouter.enabled():
        return openrouter.chat_client()
    return _oai()


def strip_ai_dashes(text: str) -> str:
    """Deterministic backstop for the no-em/en-dash style rule: prompts
    forbid them but models drift. Numeric ranges keep a plain hyphen;
    other dashes become a comma pause."""
    if not text:
        return text
    text = re.sub(r"(\d)\s*[–—]\s*(\d)", r"\1-\2", text)
    text = re.sub(r"\s+[–—]\s+", ", ", text)
    return re.sub(r"[–—]", ", ", text)


async def _log_usage(resp: object, model: str, spend: SpendContext | None) -> None:
    """Record the response's token cost into the spend ledger."""
    if spend is None:
        return
    u = getattr(resp, "usage", None)
    if u is None:
        return
    in_tok = int(getattr(u, "prompt_tokens", None) or getattr(u, "input_tokens", 0) or 0)
    out_tok = int(
        getattr(u, "completion_tokens", None) or getattr(u, "output_tokens", 0) or 0
    )
    from ..services import openrouter

    or_model = openrouter.get_model(model)
    if or_model is not None:
        cost = openrouter.llm_cost(or_model, in_tok, out_tok)
        provider = openrouter.PROVIDER
    else:
        cost = llm_cost(model, in_tok, out_tok)
        provider = PROVIDER
    await spend.log(
        provider=provider,
        sku=f"llm:{model}",
        units=Decimal(in_tok + out_tok),
        cost_usd=cost,
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


async def _json_call(
    *, model: str, system: str, user: str, temperature: float,
    spend: SpendContext | None,
) -> dict:
    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)
    resp = await _oai().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    await _log_usage(resp, model, spend)
    raw = resp.choices[0].message.content or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


# ---------------------------------------------------------------------------
# Topic selection
# ---------------------------------------------------------------------------


async def pick_topic(
    niche_title: str,
    niche_description: str,
    recent_titles: list[str],
    *,
    spend: SpendContext | None = None,
) -> TopicPick:
    """Choose the next article topic + focus keyword for a niche."""
    system = (
        "You are an SEO content strategist. Given a content niche, propose "
        "ONE article topic with a specific, winnable focus keyword. Prefer "
        "specific long-tail angles over generic overviews. Avoid topics that "
        "duplicate the recent titles provided. Never use em-dashes or "
        "en-dashes."
    )
    user = (
        f"Niche: {niche_title}\n"
        f"Description: {niche_description}\n\n"
        f"Recent article titles (avoid duplicating):\n"
        + "\n".join(f"- {t}" for t in recent_titles[:25])
        + "\n\nReturn a TopicPick."
    )
    return await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=TopicPick, temperature=0.8, spend=spend,
    )


# ---------------------------------------------------------------------------
# Research summarization (SERP texts → structured analysis)
# ---------------------------------------------------------------------------


async def summarize_serp(
    keyword: str, pages: list[dict], *, spend: SpendContext | None = None
) -> SerpAnalysis:
    """SERP distillation is extraction, not prose. Fastpath owns it."""
    from .fastpath import serp_from_pages

    return serp_from_pages(keyword, pages)


# ---------------------------------------------------------------------------
# Outline
# ---------------------------------------------------------------------------


async def generate_outline(
    topic: str, keyword: str, research: dict, tone: str, audience: str,
    *, spend: SpendContext | None = None,
) -> Outline:
    """Outline is structure. Fastpath builds it from SERP headings."""
    from .fastpath import outline_from_research
    from .models import SerpAnalysis

    serp = None
    if isinstance(research, SerpAnalysis):
        serp = research
    elif isinstance(research, dict) and research:
        try:
            raw = research.get("serp", research)
            serp = SerpAnalysis.model_validate(raw)
        except Exception:  # noqa: BLE001 — empty research still gets a playbook
            serp = None
    return outline_from_research(topic, keyword, serp)


# ---------------------------------------------------------------------------
# Section writing
# ---------------------------------------------------------------------------


async def write_section(
    heading: str, notes: str, context: SectionContext,
    *, spend: SpendContext | None = None,
) -> str:
    """Return a markdown section (H2 or H3 based on outline level)."""
    level = 2
    for sec in context.outline.sections:
        if sec.heading.strip().lower() == heading.strip().lower():
            level = 3 if sec.level >= 3 else 2
            break
    hashes = "###" if level == 3 else "##"

    prev_tail = "\n\n---\n\n".join(context.previousSections[-2:])[-4000:]
    revision_block = ""
    if context.revisionNotes:
        revision_block = (
            "\nEditorial corrections from QA (address these):\n"
            + "\n".join(f"- {n}" for n in context.revisionNotes[:8])
            + "\n"
        )
    system = (
        "You are a senior long-form content writer producing SEO-optimized "
        "articles with first-hand, E-E-A-T-strong prose. Write natural, "
        "human copy. Absolute rules: NEVER use em-dashes or en-dashes. Use "
        "commas, periods, or parentheses instead. Maintain tonal continuity "
        "with the previously-written sections. Include the focus keyword "
        "naturally (do not stuff). Output pure markdown only; no front-matter, "
        "no code fences around the whole section. Never invent studies, "
        "percentages, quotes, or citations that are not in the grounding sources."
    )
    from ..jev.grounding import research_grounding_block

    ground = research_grounding_block(context.research)
    ground_block = f"\n{ground}\n" if ground else "\n"
    user = (
        f"Article title: {context.title}\n"
        f"Topic: {context.topic}\n"
        f"Focus keyword: {context.focusKeyword}\n"
        f"Tone: {context.tone or 'professional, clear'}\n"
        f"Target audience: {context.targetAudience or 'general readers'}\n"
        f"{revision_block}{ground_block}\n"
        f"Section heading: {heading}\n"
        f"Section notes: {notes}\n\n"
        f"Previously written sections (tail, for tonal continuity):\n{prev_tail}\n\n"
        f"Start the section with `{hashes} {heading}` on its own line, then "
        "write the body in well-structured paragraphs (and bullet lists where "
        "appropriate). Do not include any other headings. Remember: no "
        "em-dashes or en-dashes anywhere."
    )
    async def _call(model: str) -> str:
        if spend is not None:
            await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)
        resp = await _chat_client(model).chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.7,
        )
        await _log_usage(resp, model, spend)
        return strip_ai_dashes((resp.choices[0].message.content or "").strip())

    # A persistent failure of the configured writer model (rotated/expired
    # key, deprecated model id, extended outage — the model's own transient
    # retries already ran inside the OpenAI SDK) must not kill the whole
    # article. Fall back to the stock agent_model, same philosophy as
    # provider_fallback.synthesize_vo_with_fallback for video voiceover.
    chain = provider_fallback.writer_model_fallback_chain(
        resolve_article_writer_model()
    )
    # Cascade: a QA rewrite does not retry the same cheap writer first.
    if context.revisionNotes and len(chain) > 1:
        chain = chain[1:] + chain[:1]
    text, _model_used = await provider_fallback.call_with_model_fallback(
        _call, chain, log_event="article.writer.fallback",
    )
    return text


# ---------------------------------------------------------------------------
# Metadata / schema
# ---------------------------------------------------------------------------


async def generate_metadata(
    topic: str, keyword: str, article_md: str, tone: str,
    *, spend: SpendContext | None = None,
) -> ArticleMetadata:
    """Title/slug/meta are extracts, not prose."""
    from .fastpath import metadata_from_article

    return metadata_from_article(topic, keyword, article_md)


async def generate_schema_json(
    *, title: str, slug: str, meta_description: str, focus_keyword: str,
    keywords: list[str], article_md: str, spend: SpendContext | None = None,
) -> str:
    """JSON-LD is structure. Fastpath owns the @graph."""
    from .fastpath import schema_json

    return schema_json(
        title=title,
        slug=slug,
        meta_description=meta_description,
        focus_keyword=focus_keyword,
        keywords=keywords,
        article_md=article_md,
    )


# ---------------------------------------------------------------------------
# Interlinking
# ---------------------------------------------------------------------------


async def interlink_suggest(
    article_md: str, candidates: list[dict], *, spend: SpendContext | None = None
) -> list[InterlinkSuggestion]:
    """Internal links are lexical overlap, not a chat completion."""
    from .fastpath import interlink_lexical

    return interlink_lexical(article_md, candidates)


# ---------------------------------------------------------------------------
# QA / scoring
# ---------------------------------------------------------------------------


async def score_article(
    article_md: str, focus_keyword: str, *, spend: SpendContext | None = None
) -> QualityScore:
    """Score E-E-A-T + readability; compute density; flag em/en-dashes."""
    words = [w for w in article_md.split() if w.strip()]
    word_count = len(words)
    needle = focus_keyword.strip()
    occurrences = (
        len(re.findall(rf"\b{re.escape(needle)}\b", article_md, flags=re.IGNORECASE))
        if needle
        else 0
    )
    density = (occurrences / word_count) if word_count else 0.0

    em_count = article_md.count("—")
    en_count = article_md.count("–")

    from ..jev import available as jev_available
    from ..jev.decisions import judge_article

    if settings.jev_enabled and jev_available():
        try:
            verdict = await judge_article(
                article_md, focus_keyword,
                word_count=word_count, density=density, spend=spend,
            )
            quality = verdict.quality
            if em_count or en_count:
                quality.notes.append(
                    f"Em/en-dash usage detected: {em_count} em-dash(es), "
                    f"{en_count} en-dash(es). Replace with commas or periods."
                )
            return quality
        except Exception as exc:  # noqa: BLE001 — Jev is an upgrade
            from ..repos.spend import SpendCapExceeded

            if isinstance(exc, SpendCapExceeded):
                raise

    from .fastpath import heuristic_quality

    return heuristic_quality(
        article_md,
        focus_keyword,
        word_count=word_count,
        density=density,
        em_count=em_count,
        en_count=en_count,
    )


# ---------------------------------------------------------------------------
# Hero image prompt
# ---------------------------------------------------------------------------


async def generate_hero_prompt(
    title: str, keyword: str, article_md: str, *, spend: SpendContext | None = None
) -> ImagePrompt | None:
    """Hero still is a template. gpt-image-1 still renders."""
    from .fastpath import hero_prompt

    return hero_prompt(title, keyword)


# ---------------------------------------------------------------------------
# Content repurposing: article -> platform-native social snippets
# ---------------------------------------------------------------------------

async def generate_social_snippets(
    title: str,
    article_md: str,
    platforms: list[str],
    *,
    spend: SpendContext | None = None,
) -> list[SocialSnippet]:
    """Repurpose a finished article into platform posts from the article text.

    This is extraction, not generation — Jev cannot write captions, and an
    LLM here invented hooks that were not in the piece.
    """
    from .fastpath import template_social_snippets

    return template_social_snippets(title, article_md, platforms)
