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
    TopicProposalBatch,
    TopicProposalPick,
)

_client: openai.AsyncOpenAI | None = None

PROVIDER = "openai"


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


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
    await spend.log(
        provider=PROVIDER,
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


async def propose_topics(
    niche,
    brand,
    recent_titles: list[str],
    n: int,
    *,
    spend: SpendContext | None = None,
) -> list[TopicProposalPick]:
    """Propose `n` candidate article topics for a niche's approval queue.

    Unlike `pick_topic` (which picks ONE topic and hands it straight to the
    pipeline), this seeds the human approval loop: every candidate gets a
    focus keyword, a one-line rationale, and a 0-1 confidence score so an
    operator can triage the batch at a glance.

    `niche` and `brand` are duck-typed (same contract the pipeline already
    relies on via niches_repo.get / brand_kit_repo.get) rather than typed
    imports, so this module stays decoupled from the repo layer — `niche`
    needs `.title`/`.description`, `brand` (optional, may be None) needs
    `.tone_of_voice`.
    """
    niche_title = getattr(niche, "title", "") or ""
    niche_description = getattr(niche, "description", "") or ""
    tone = (getattr(brand, "tone_of_voice", "") or "") if brand is not None else ""

    system = (
        "You are an SEO content strategist building a topic backlog for "
        "editorial approval. Given a content niche, propose distinct "
        "article topics with specific, winnable long-tail focus keywords. "
        "Each proposal needs a one-sentence rationale (why this topic, why "
        "now) and a 0-1 score reflecting how strong the opportunity is "
        "(search intent match, ranking difficulty, audience fit). Avoid "
        "topics that duplicate the recent titles provided, and avoid "
        "duplicating each other. Never use em-dashes or en-dashes."
    )
    user = (
        f"Niche: {niche_title}\n"
        f"Description: {niche_description}\n"
        f"Brand voice: {tone or 'none specified'}\n\n"
        f"Recent article titles (avoid duplicating):\n"
        + "\n".join(f"- {t}" for t in recent_titles[:25])
        + f"\n\nPropose exactly {n} distinct topic proposals."
    )
    batch: TopicProposalBatch = await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=TopicProposalBatch, temperature=0.8, spend=spend,
    )
    return batch.proposals[:n]


# ---------------------------------------------------------------------------
# Research summarization (SERP texts → structured analysis)
# ---------------------------------------------------------------------------


async def summarize_serp(
    keyword: str, pages: list[dict], *, spend: SpendContext | None = None
) -> SerpAnalysis:
    """Distill raw SERP page content into a SerpAnalysis the outline and
    writer can use (common headings/topics, questions answered)."""
    system = (
        "You are an SEO SERP analyst. Given the focus keyword and excerpts "
        "of the current top-ranking pages, produce a SerpAnalysis: the "
        "commonHeadings and commonTopics shared across results, the concrete "
        "questionsAnswered, and a recommendedWordCount (between 800 and 4000) "
        "based on what currently ranks. Echo the provided topResults, "
        "avgWordCount, and topDomains unchanged. Never use em-dashes or "
        "en-dashes."
    )
    user = (
        f"Focus keyword: {keyword}\n\n"
        f"SERP pages (JSON, excerpts may be truncated):\n"
        f"{json.dumps(pages, separators=(',', ':'))[:12000]}\n\n"
        "Return the SerpAnalysis."
    )
    return await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=SerpAnalysis, temperature=0.4, spend=spend,
    )


# ---------------------------------------------------------------------------
# Outline
# ---------------------------------------------------------------------------


async def generate_outline(
    topic: str, keyword: str, research: dict, tone: str, audience: str,
    *, spend: SpendContext | None = None,
) -> Outline:
    """Produce a structured Outline (one H1, 5-10 H2s, 0-3 H3s per H2)."""
    system = (
        "You are an expert SEO content strategist. Produce a structured article "
        "outline that ranks and serves the reader. Rules: exactly one H1 "
        "(level=1) as the first section, 5 to 10 H2 sections (level=2), and 0 "
        "to 3 H3 sections (level=3) immediately under each H2. Every section "
        "must include concrete notes the writer can follow. Never use em-dashes "
        "or en-dashes in headings or notes. Every heading must be unique within "
        "the outline and phrased differently from the H1."
    )
    research_summary = json.dumps(research or {}, separators=(",", ":"))[:6000]
    user = (
        f"Topic: {topic}\n"
        f"Focus keyword: {keyword}\n"
        f"Tone: {tone}\n"
        f"Target audience: {audience}\n\n"
        f"Research (JSON, may be truncated):\n{research_summary}\n\n"
        "Return the outline as structured JSON matching the Outline schema."
    )
    return await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=Outline, temperature=0.7, spend=spend,
    )


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
        "no code fences around the whole section."
    )
    user = (
        f"Article title: {context.title}\n"
        f"Topic: {context.topic}\n"
        f"Focus keyword: {context.focusKeyword}\n"
        f"Tone: {context.tone or 'professional, clear'}\n"
        f"Target audience: {context.targetAudience or 'general readers'}\n"
        f"{revision_block}\n"
        f"Section heading: {heading}\n"
        f"Section notes: {notes}\n\n"
        f"Previously written sections (tail, for tonal continuity):\n{prev_tail}\n\n"
        f"Start the section with `{hashes} {heading}` on its own line, then "
        "write the body in well-structured paragraphs (and bullet lists where "
        "appropriate). Do not include any other headings. Remember: no "
        "em-dashes or en-dashes anywhere."
    )
    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)
    model = settings.article_writer_model
    resp = await _oai().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.7,
    )
    await _log_usage(resp, model, spend)
    return strip_ai_dashes((resp.choices[0].message.content or "").strip())


# ---------------------------------------------------------------------------
# Metadata / schema
# ---------------------------------------------------------------------------


async def generate_metadata(
    topic: str, keyword: str, article_md: str, tone: str,
    *, spend: SpendContext | None = None,
) -> ArticleMetadata:
    """SEO metadata: title 50-60 chars, kebab-case slug, meta 150-160 chars."""
    system = (
        "You are an SEO metadata specialist. Generate concise, high-CTR "
        "metadata. Strict constraints: title 50-60 characters, slug in "
        "kebab-case (lowercase, hyphen-separated, no punctuation), meta "
        "description 150-160 characters. Include the focus keyword naturally "
        "in the title and meta description. Never use em-dashes or en-dashes."
    )
    excerpt = article_md[:6000]
    user = (
        f"Topic: {topic}\n"
        f"Focus keyword: {keyword}\n"
        f"Tone: {tone}\n\n"
        f"Article (may be truncated):\n{excerpt}\n\n"
        "Return metadata as structured JSON matching the ArticleMetadata schema."
    )
    parsed: ArticleMetadata = await _parse_call(
        model=settings.agent_model, system=system, user=user,
        response_format=ArticleMetadata, temperature=0.5, spend=spend,
    )
    parsed.title = strip_ai_dashes(parsed.title)
    parsed.metaDescription = strip_ai_dashes(parsed.metaDescription)
    return parsed


async def generate_schema_json(
    *, title: str, slug: str, meta_description: str, focus_keyword: str,
    keywords: list[str], article_md: str, spend: SpendContext | None = None,
) -> str:
    """Return a JSON-LD string (Article + FAQPage in @graph)."""
    system = (
        "You are a schema.org JSON-LD expert. Produce a JSON-LD document that "
        "combines an Article entry and an FAQPage entry under a single @graph "
        "array. Use https://schema.org as @context. The Article needs "
        "headline, description, keywords, author (Person), datePublished, "
        "dateModified, publisher (Organization), mainEntityOfPage, and image. "
        "The FAQPage must include 3-5 realistic Question/Answer pairs drawn "
        "from the article. Optimize for Google rich results. Return a JSON "
        "object with a single key 'schema' whose value is the JSON-LD object."
    )
    user = (
        f"Title: {title}\n"
        f"Slug: {slug}\n"
        f"Meta description: {meta_description}\n"
        f"Focus keyword: {focus_keyword}\n"
        f"Keywords: {', '.join(keywords)}\n\n"
        f"Article markdown (may be truncated):\n{article_md[:8000]}\n\n"
        'Return {"schema": { ...JSON-LD... }}.'
    )
    parsed = await _json_call(
        model=settings.agent_model, system=system, user=user,
        temperature=0.5, spend=spend,
    )
    payload = parsed.get("schema", parsed)
    return json.dumps(payload, indent=2) if payload else ""


# ---------------------------------------------------------------------------
# Interlinking
# ---------------------------------------------------------------------------


async def interlink_suggest(
    article_md: str, candidates: list[dict], *, spend: SpendContext | None = None
) -> list[InterlinkSuggestion]:
    """Suggest up to 5 internal links into the user's prior articles."""
    if not candidates:
        return []
    system = (
        "You recommend high-relevance internal links. Given a new article and "
        "a list of the user's existing articles (title + slug), pick up to 5 "
        "targets that a reader would genuinely want to follow. For each pick, "
        "propose a short natural anchor phrase that appears (or could appear) "
        'in the article body and score the relevance 0 to 1. Return JSON: '
        '{"suggestions": [{"anchor": str, "targetUrl": str, "score": number}]}. '
        "targetUrl must be the slug prefixed with '/'."
    )
    user = (
        f"New article (may be truncated):\n{article_md[:6000]}\n\n"
        f"Existing articles (JSON):\n{json.dumps(candidates, separators=(',', ':'))}\n\n"
        "Return up to 5 suggestions, highest score first."
    )
    parsed = await _json_call(
        model=settings.agent_model, system=system, user=user,
        temperature=0.5, spend=spend,
    )
    out: list[InterlinkSuggestion] = []
    for item in (parsed.get("suggestions") or [])[:5]:
        try:
            out.append(InterlinkSuggestion.model_validate(item))
        except Exception:  # noqa: BLE001 — skip malformed suggestions
            continue
    return out


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

    system = (
        "You are an editorial QA evaluator. Score the article for E-E-A-T "
        "(experience, expertise, authoritativeness, trustworthiness) and "
        "readability on a 0-1 scale. Also return a weighted overall 0-1 "
        'score. Return JSON of shape {"overall": number, "eeatScore": '
        'number, "readability": number, "notes": [string]}. Notes should '
        "list concrete improvement observations."
    )
    user = (
        f"Focus keyword: {focus_keyword}\n"
        f"Computed word count: {word_count}\n"
        f"Computed keyword density: {density:.4f}\n\n"
        f"Article (may be truncated):\n{article_md[:8000]}\n\n"
        "Return the scored JSON object."
    )
    parsed = await _json_call(
        model=settings.agent_model, system=system, user=user,
        temperature=0.5, spend=spend,
    )

    notes = list(parsed.get("notes") or [])
    if em_count or en_count:
        notes.append(
            f"Em/en-dash usage detected: {em_count} em-dash(es), "
            f"{en_count} en-dash(es). Replace with commas or periods."
        )

    return QualityScore(
        overall=float(parsed.get("overall", 0.0) or 0.0),
        keywordDensity=float(density),
        eeatScore=float(parsed.get("eeatScore", 0.0) or 0.0),
        readability=float(parsed.get("readability", 0.0) or 0.0),
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Hero image prompt
# ---------------------------------------------------------------------------


async def generate_hero_prompt(
    title: str, keyword: str, article_md: str, *, spend: SpendContext | None = None
) -> ImagePrompt | None:
    """One photorealistic editorial hero-image prompt for the article."""
    system = (
        "You design photorealistic, cinematic image prompts for editorial "
        "articles. Describe a single scene: hyper-realistic photograph, 50mm "
        "lens, soft natural lighting, shallow depth of field, color graded, "
        "editorial style. Do not include text, logos, watermarks, or celebrity "
        "likenesses. The altText must mention the focus keyword naturally. "
        'Return JSON of shape {"images": [{"type": "hero", "prompt": str, '
        '"altText": str}]}.'
    )
    user = (
        f"Title: {title}\n"
        f"Focus keyword: {keyword}\n\n"
        f"Article (may be truncated):\n{article_md[:5000]}\n\n"
        "Return exactly 1 image spec."
    )
    parsed = await _json_call(
        model=settings.agent_model, system=system, user=user,
        temperature=0.7, spend=spend,
    )
    for item in (parsed.get("images") or [])[:1]:
        try:
            return ImagePrompt.model_validate(item)
        except Exception:  # noqa: BLE001
            return None
    return None


# ---------------------------------------------------------------------------
# Content repurposing: article -> platform-native social snippets
# ---------------------------------------------------------------------------

_PLATFORM_GUIDANCE = {
    "twitter": "A single punchy tweet under 280 characters. Hook first. 1-2 hashtags.",
    "linkedin": "A professional LinkedIn post: a strong first line, 3-5 short lines of "
                "insight, a soft CTA. 3-5 hashtags.",
    "instagram": "An Instagram caption: warm, first-person, a hook line then value, "
                 "5-10 relevant hashtags.",
    "facebook": "A conversational Facebook post: 2-4 sentences, a question to drive "
                "comments. 0-2 hashtags.",
    "newsletter": "A short newsletter blurb: a subject-line-style hook, 2-3 sentences, "
                  "and a read-more nudge. No hashtags.",
}


async def generate_social_snippets(
    title: str,
    article_md: str,
    platforms: list[str],
    *,
    spend: SpendContext | None = None,
) -> list[SocialSnippet]:
    """Repurpose a finished article into platform-native social posts. One
    metered LLM call produces all requested platforms at once."""

    wanted = [p for p in platforms if p in _PLATFORM_GUIDANCE] or list(_PLATFORM_GUIDANCE)
    guidance = "\n".join(f"- {p}: {_PLATFORM_GUIDANCE[p]}" for p in wanted)
    system = (
        "You are a social media editor. Given an article, write native posts "
        "for each requested platform that drive clicks back to the article. "
        "Match each platform's norms exactly. Never use em-dashes or en-dashes. "
        "Do not invent facts not in the article. Return JSON of shape "
        '{"snippets": [{"platform": str, "body": str, "hashtags": [str]}]} '
        "with exactly one entry per requested platform.\n\nPlatform rules:\n"
        f"{guidance}"
    )
    user = (
        f"Article title: {title}\n"
        f"Requested platforms: {', '.join(wanted)}\n\n"
        f"Article (may be truncated):\n{article_md[:7000]}\n\n"
        "Return the snippets JSON."
    )
    parsed = await _json_call(
        model=settings.agent_model, system=system, user=user,
        temperature=0.7, spend=spend,
    )
    out: list[SocialSnippet] = []
    for item in parsed.get("snippets") or []:
        try:
            snip = SocialSnippet.model_validate(item)
            snip.body = strip_ai_dashes(snip.body)
            out.append(snip)
        except Exception:  # noqa: BLE001 — skip malformed
            continue
    return out
