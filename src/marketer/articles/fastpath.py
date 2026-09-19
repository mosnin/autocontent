"""Deterministic article stages — no LLM when code already has the data.

SERP distillation, JSON-LD, internal links, topic candidates, and hero
prompts used to each be a chat completion. Those are classification /
extraction / schema jobs. Jev picks among topic templates; everything
else is Python. Outline + section prose still go through the writer.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from .models import (
    ImagePrompt,
    InterlinkSuggestion,
    SerpAnalysis,
    SerpResult,
    TopicPick,
)

_STOP = {
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at",
    "how", "what", "that", "this", "with", "from", "into", "your", "our",
    "about", "over", "under", "than", "then", "when", "why", "who",
}


def tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w for w in words if len(w) > 2 and w not in _STOP}


def topic_candidates(
    niche_title: str,
    niche_description: str,
    *,
    audience: str = "",
) -> list[TopicPick]:
    title = (niche_title or "this niche").strip() or "this niche"
    who = (audience or "readers").strip() or "readers"
    desc = (niche_description or title).strip()
    short_desc = desc if len(desc) <= 80 else desc[:77].rsplit(" ", 1)[0]
    return [
        TopicPick(
            topic=f"How {title} actually works",
            focusKeyword=f"{title} guide",
            rationale="how-to",
        ),
        TopicPick(
            topic=f"What {who} get wrong about {title}",
            focusKeyword=f"{title} mistakes",
            rationale="mistakes",
        ),
        TopicPick(
            topic=f"{title}: a practical playbook",
            focusKeyword=f"{title} playbook",
            rationale="playbook",
        ),
        TopicPick(
            topic=f"The {title} checklist that actually ships",
            focusKeyword=f"{title} checklist",
            rationale="checklist",
        ),
        TopicPick(
            topic=f"{title} for {who}",
            focusKeyword=f"{title} for beginners",
            rationale="audience",
        ),
        TopicPick(
            topic=f"{short_desc}: first principles",
            focusKeyword=f"{title} basics",
            rationale="principles",
        ),
    ]


def unused_topic_candidates(
    niche_title: str,
    niche_description: str,
    recent_titles: list[str],
    *,
    audience: str = "",
) -> list[TopicPick]:
    recent = " ".join(recent_titles or []).casefold()
    out: list[TopicPick] = []
    for pick in topic_candidates(
        niche_title, niche_description, audience=audience
    ):
        if pick.topic.casefold() in recent:
            continue
        out.append(pick)
    return out or topic_candidates(niche_title, niche_description, audience=audience)


async def pick_topic(
    niche_title: str,
    niche_description: str,
    recent_titles: list[str],
    *,
    audience: str = "",
    spend: Any = None,
) -> TopicPick:
    """Jev chooses among templates. Dark harness / one leftover → first unused.

    LLM ``pick_topic`` is the last resort when every template collides
    with recent titles *and* Jev cannot answer.
    """
    unused = unused_topic_candidates(
        niche_title, niche_description, recent_titles, audience=audience
    )
    if len(unused) == 1:
        return unused[0]
    from ..config import settings
    from ..jev.ask import available
    from ..jev.client import choice

    if settings.jev_enabled and available() and len(unused) >= 2:
        try:
            from ..jev.ask import ask as jev_ask

            criteria = {str(i): p.topic for i, p in enumerate(unused[:8])}
            result = await jev_ask(
                {
                    "niche": niche_title,
                    "description": niche_description,
                    "audience": audience,
                    "recent": recent_titles[:12],
                },
                {
                    "topic": choice(
                        "Which unused article angle should we write next "
                        "for this niche? Prefer a specific, winnable long-tail.",
                        criteria,
                    )
                },
                spend=spend,
            )
            picked = result.choice("topic").choice
            idx = int(picked) if picked.isdigit() else 0
            if 0 <= idx < len(unused):
                return unused[idx]
        except Exception as exc:  # noqa: BLE001 — templates still beat an LLM
            from ..logging import get_logger

            get_logger(__name__).warning(
                "jev.fastpath.topic_pick_failed", extra={"error": str(exc)}
            )
    if unused:
        return unused[0]
    from . import llm

    return await llm.pick_topic(
        niche_title, niche_description, recent_titles, spend=spend
    )


def serp_from_pages(keyword: str, pages: list[dict[str, Any]]) -> SerpAnalysis:
    """Extract SERP structure from Exa rows. No chat completion."""
    results: list[SerpResult] = []
    domains: list[str] = []
    headings: list[str] = []
    topics: list[str] = []
    questions: list[str] = []
    word_counts: list[int] = []
    kw_tokens = tokens(keyword)
    heading_counter: Counter[str] = Counter()
    for page in pages:
        title = str(page.get("title") or "").strip()
        url = str(page.get("url") or "").strip()
        domain = str(page.get("domain") or "").strip()
        highlights = page.get("highlights") or []
        if not isinstance(highlights, list):
            highlights = [str(highlights)]
        highlight_strs = [str(h) for h in highlights if str(h).strip()]
        wc_raw = page.get("wordCountEstimate")
        wc = int(wc_raw) if isinstance(wc_raw, (int, float)) else None
        if wc:
            word_counts.append(wc)
        results.append(
            SerpResult(
                title=title,
                url=url,
                domain=domain,
                wordCountEstimate=wc,
                highlights=highlight_strs,
            )
        )
        if domain:
            domains.append(domain)
        if title:
            headings.append(title)
            topics.extend(sorted(tokens(title)))
            if title.endswith("?"):
                questions.append(title)
            for tok in tokens(title):
                if tok in kw_tokens or len(tok) > 4:
                    heading_counter[tok] += 1
        excerpt = str(page.get("excerpt") or "")
        for line in excerpt.splitlines():
            line = line.strip()
            if line.endswith("?") and 12 <= len(line) <= 140:
                questions.append(line)
    common = [h for h in headings if tokens(h) & kw_tokens]
    avg = int(sum(word_counts) / len(word_counts)) if word_counts else 0
    recommended = max(800, min(4000, int(avg * 1.1) if avg else 1500))
    common_topics = [t for t, _n in heading_counter.most_common(12)]
    return SerpAnalysis(
        topResults=results,
        avgWordCount=avg,
        commonHeadings=(common or headings)[:12],
        commonTopics=common_topics or topics[:12],
        questionsAnswered=list(dict.fromkeys(questions))[:8],
        recommendedWordCount=recommended,
        topDomains=list(dict.fromkeys(domains))[:12],
    )


_H2_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)


def _faq_from_markdown(article_md: str) -> list[tuple[str, str]]:
    text = article_md or ""
    matches = list(_H2_RE.finditer(text))
    faqs: list[tuple[str, str]] = []
    for i, match in enumerate(matches):
        heading = match.group(1).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        body = re.sub(r"^###\s+.*$", "", body, flags=re.MULTILINE).strip()
        para = next((p.strip() for p in body.split("\n\n") if p.strip()), "")
        para = re.sub(r"\s+", " ", para)
        if not para:
            continue
        question = heading if heading.endswith("?") else f"What should I know about {heading}?"
        faqs.append((question, para[:400]))
        if len(faqs) >= 5:
            break
    return faqs


def schema_json(
    *,
    title: str,
    slug: str,
    meta_description: str,
    focus_keyword: str,
    keywords: list[str],
    article_md: str,
) -> str:
    """Article + FAQPage JSON-LD. Deterministic; no LLM."""
    faqs = _faq_from_markdown(article_md)
    graph: list[dict[str, Any]] = [
        {
            "@type": "Article",
            "headline": title,
            "description": meta_description,
            "keywords": ", ".join(keywords) if keywords else focus_keyword,
            "mainEntityOfPage": f"/{slug.lstrip('/')}",
        }
    ]
    if faqs:
        graph.append(
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": question,
                        "acceptedAnswer": {"@type": "Answer", "text": answer},
                    }
                    for question, answer in faqs
                ],
            }
        )
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2)


def interlink_lexical(
    article_md: str,
    candidates: list[dict[str, Any]],
    *,
    limit: int = 5,
) -> list[InterlinkSuggestion]:
    """Token-overlap internal links. No chat completion."""
    body_tokens = tokens(article_md)
    body_lower = (article_md or "").casefold()
    scored: list[InterlinkSuggestion] = []
    for row in candidates:
        title = str(row.get("title") or "").strip()
        slug = str(row.get("slug") or "").strip().lstrip("/")
        if not title or not slug:
            continue
        title_tokens = tokens(title)
        overlap = body_tokens & title_tokens
        if not overlap:
            continue
        score = min(1.0, len(overlap) / max(len(title_tokens), 1))
        anchor = title
        for n in (3, 2, 1):
            parts = title.split()
            for i in range(max(len(parts) - n + 1, 0)):
                phrase = " ".join(parts[i : i + n])
                if phrase and phrase.casefold() in body_lower:
                    anchor = phrase
                    break
            if anchor != title:
                break
        scored.append(
            InterlinkSuggestion(anchor=anchor, targetUrl=f"/{slug}", score=score)
        )
    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[:limit]


def hero_prompt(title: str, keyword: str) -> ImagePrompt:
    subject = (keyword or title or "the topic").strip()
    return ImagePrompt(
        type="hero",
        prompt=(
            f"Photorealistic editorial photograph of {subject}, 50mm lens, "
            "soft natural lighting, shallow depth of field, color graded, "
            "no text, no logos, no watermarks, no celebrity likenesses"
        ),
        altText=f"{subject} editorial photograph",
    )
