"""Deterministic article stages — no LLM when code already has the data.

SERP distillation, JSON-LD, internal links, topic candidates, and hero
prompts used to each be a chat completion. Those are classification /
extraction / schema jobs. Jev picks among topic templates; everything
else is Python. Playbook and leftover SERP H2s stitch highlights; the
writer only runs when research is too thin to ground a section.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from .models import (
    ArticleMetadata,
    ImagePrompt,
    InterlinkSuggestion,
    Outline,
    OutlineSection,
    QualityScore,
    SerpAnalysis,
    SerpResult,
    SocialSnippet,
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


def outline_from_research(
    topic: str,
    keyword: str,
    serp: SerpAnalysis | None = None,
) -> Outline:
    """H1 + 5-10 H2s from SERP headings / questions / a default playbook."""
    title = (topic or keyword or "Untitled").strip()
    seen: set[str] = set()
    h2s: list[OutlineSection] = []

    def add(heading: str, notes: str) -> None:
        clean = re.sub(r"\s+", " ", (heading or "").strip().rstrip("?"))
        if not clean:
            return
        key = clean.casefold()
        if key in seen or key == title.casefold():
            return
        seen.add(key)
        h2s.append(OutlineSection(level=2, heading=clean, notes=notes))

    analysis = serp or SerpAnalysis()
    focus = keyword or topic
    for heading in analysis.commonHeadings:
        add(heading, f"Cover what ranking pages say about {heading}. Stay specific to {focus}.")
    for question in analysis.questionsAnswered:
        add(question, f"Answer the searcher question: {question}")
    for heading, notes in (
        (f"What {focus} actually is", "Define in concrete terms. No fluff."),
        (f"Why {focus} matters now", "Stakes for the target reader."),
        (f"How to start with {focus}", "Step-by-step, first-hand."),
        (f"Mistakes to avoid with {focus}", "Specific failure modes."),
        (f"{focus} checklist", "A scannable list the reader can ship."),
        ("FAQ", "Answer leftover searcher questions without inventing studies."),
    ):
        if len(h2s) >= 8:
            break
        add(heading, notes)
    while len(h2s) < 5:
        add(f"{focus} in practice {len(h2s) + 1}", "Concrete examples from the brief.")
    return Outline(
        title=title,
        sections=[OutlineSection(level=1, heading=title, notes="H1")] + h2s[:10],
    )


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:80] or "article"


def metadata_from_article(
    topic: str,
    keyword: str,
    article_md: str,
) -> ArticleMetadata:
    """Title / slug / meta from the article itself. No chat completion."""
    from .llm import strip_ai_dashes

    heading = topic.strip() or keyword.strip() or "Untitled"
    if len(heading) < 40:
        heading = f"{heading}: a practical guide"
    title = strip_ai_dashes(heading)[:60].rstrip(" :,-")
    paras = [
        p.strip()
        for p in re.split(r"\n\s*\n", article_md or "")
        if p.strip() and not p.lstrip().startswith("#")
    ]
    first = strip_ai_dashes(paras[0] if paras else f"A practical guide to {keyword or topic}.")
    first = re.sub(r"\s+", " ", first)
    meta = first[:157]
    if len(first) > 157:
        meta = meta.rsplit(" ", 1)[0].rstrip(".,;:") + "."
    kws = [keyword] if keyword else []
    for tok in sorted(tokens(topic)):
        if tok not in {k.casefold() for k in kws}:
            kws.append(tok)
        if len(kws) >= 8:
            break
    return ArticleMetadata(
        title=title,
        slug=_slugify(keyword or topic),
        metaDescription=meta[:160],
        focusKeyword=keyword or topic,
        keywords=kws,
    )


def metadata_is_publishable(title: str, meta: str, keyword: str) -> bool:
    """Skip the pagegrade Jev hop when title/meta already satisfy the brief."""
    kw = (keyword or "").strip().casefold()
    heading = (title or "").strip()
    description = (meta or "").strip()
    if not kw or not heading or not description:
        return False
    return (
        kw in heading.casefold()
        and 40 <= len(heading) <= 70
        and 80 <= len(description) <= 160
    )


def _research_highlights(research: SerpAnalysis | None) -> list[str]:
    if research is None:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for row in research.topResults:
        for raw in row.highlights or []:
            item = str(raw).strip()
            if not item:
                continue
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
    return out


def faq_section_from_research(heading: str, research: SerpAnalysis | None) -> str | None:
    """Write the FAQ H2 from SERP questions + highlights. No chat completion."""
    key = (heading or "").strip().casefold()
    if key not in {"faq", "frequently asked questions"} and not key.startswith("faq"):
        return None
    if research is None or len(research.questionsAnswered) < 2:
        return None
    highlights = _research_highlights(research)
    lines = [f"## {(heading or 'FAQ').strip()}\n"]
    fallback_topic = (research.commonTopics[0] if research.commonTopics else "the basics")
    for question in research.questionsAnswered[:5]:
        q_tokens = tokens(question)
        answer = next((h for h in highlights if tokens(h) & q_tokens), "")
        if not answer and highlights:
            answer = highlights[0]
        if not answer:
            answer = (
                f"Start from {fallback_topic} in the sections above rather than "
                "a generic overview."
            )
        lines.append(f"**{question.strip()}**\n\n{answer[:280]}\n")
    return "\n".join(lines)


def checklist_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """Scannable checklist H2 from distinct SERP highlights. No chat completion."""
    key = (heading or "").strip().casefold()
    if "checklist" not in key:
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 3:
        return None
    lines = [f"## {(heading or 'Checklist').strip()}\n"]
    for item in highlights[:8]:
        lines.append(f"- {item.rstrip('.')[:180]}")
    return "\n".join(lines) + "\n"


def definition_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """'What X actually is' H2 from SERP highlights. No invented definition."""
    key = (heading or "").strip().casefold()
    if not key.startswith("what ") or "actually is" not in key:
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 2:
        return None
    title = (heading or "Definition").strip()
    body = "\n\n".join(h[:280] for h in highlights[:4])
    return f"## {title}\n\n{body}\n"


def stakes_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """'Why X matters now' from SERP highlights. No invented stakes."""
    key = (heading or "").strip().casefold()
    if not key.startswith("why ") or "matters" not in key:
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 2:
        return None
    title = (heading or "Why it matters").strip()
    body = "\n\n".join(h[:280] for h in highlights[:4])
    return f"## {title}\n\n{body}\n"


def _playbook_heading(key: str) -> bool:
    """Headings owned by a dedicated template. Do not steal their shape."""
    if key in {"faq", "frequently asked questions"} or key.startswith("faq"):
        return True
    if "checklist" in key:
        return True
    if key.startswith("what ") and "actually is" in key:
        return True
    if key.startswith("why ") and "matters" in key:
        return True
    if key.startswith("how to start"):
        return True
    if "in practice" in key:
        return True
    return "mistake" in key


def _is_searcher_question(heading: str, research: SerpAnalysis | None) -> bool:
    key = (heading or "").strip().casefold().rstrip("?")
    if not key or _playbook_heading(key):
        return False
    if (heading or "").strip().endswith("?"):
        return True
    questions = (research.questionsAnswered if research is not None else []) or []
    return any(q.strip().rstrip("?").casefold() == key for q in questions)


def serp_heading_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """SERP-derived H2 from highlights that share tokens with the heading.

    commonHeadings land first in the outline. When two or more highlights
    already talk about that heading, stitching them is grounded and skips
    a writer hop. Thin overlap still buys prose.
    """
    key = (heading or "").strip().casefold()
    if not key or _playbook_heading(key):
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 2:
        return None
    h_tokens = tokens(heading)
    if not h_tokens:
        return None
    matched = [h for h in highlights if tokens(h) & h_tokens]
    if len(matched) < 2:
        return None
    title = (heading or "").strip()
    body = "\n\n".join(h[:280] for h in matched[:4])
    return f"## {title}\n\n{body}\n"


def practice_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """'{focus} in practice N' filler H2s from SERP highlights. No invented examples."""
    key = (heading or "").strip().casefold()
    if "in practice" not in key:
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 2:
        return None
    title = (heading or "In practice").strip()
    body = "\n\n".join(h[:280] for h in highlights[:4])
    return f"## {title}\n\n{body}\n"


def question_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """A single SERP question H2 from overlapping highlights. No invented answer."""
    if not _is_searcher_question(heading, research):
        return None
    highlights = _research_highlights(research)
    if not highlights:
        return None
    h_tokens = tokens(heading)
    matched = [h for h in highlights if h_tokens and tokens(h) & h_tokens]
    answers = matched[:3] if matched else highlights[:2]
    if not answers:
        return None
    title = (heading or "").strip()
    body = "\n\n".join(h[:280] for h in answers)
    return f"## {title}\n\n{body}\n"


def grounded_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """Last-resort leftover H2 from SERP highlights. No invented prose.

    Playbook templates and token-overlapping SERP stitch win first.
    Thin SERP (fewer than 2 highlights) still buys the writer.
    """
    key = (heading or "").strip().casefold()
    if not key or _playbook_heading(key):
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 2:
        return None
    h_tokens = tokens(heading)
    matched = [h for h in highlights if h_tokens and tokens(h) & h_tokens]
    body_src = matched[:4] if len(matched) >= 2 else highlights[:3]
    title = (heading or "").strip()
    body = "\n\n".join(h[:280] for h in body_src)
    return f"## {title}\n\n{body}\n"


def how_to_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """'How to start with X' as numbered SERP highlights. No invented steps."""
    key = (heading or "").strip().casefold()
    if not key.startswith("how to start"):
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 3:
        return None
    lines = [f"## {(heading or 'How to start').strip()}\n"]
    for i, item in enumerate(highlights[:6], 1):
        lines.append(f"{i}. {item.rstrip('.')[:180]}")
    return "\n".join(lines) + "\n"


def mistakes_section_from_research(
    heading: str, research: SerpAnalysis | None
) -> str | None:
    """'Mistakes to avoid' as SERP highlight bullets. No invented failure modes."""
    key = (heading or "").strip().casefold()
    if "mistake" not in key:
        return None
    highlights = _research_highlights(research)
    if len(highlights) < 3:
        return None
    lines = [f"## {(heading or 'Mistakes to avoid').strip()}\n"]
    for item in highlights[:6]:
        lines.append(f"- {item.rstrip('.')[:180]}")
    return "\n".join(lines) + "\n"


def heuristic_quality(
    article_md: str,
    focus_keyword: str,
    *,
    word_count: int,
    density: float,
    em_count: int = 0,
    en_count: int = 0,
) -> QualityScore:
    """Deterministic QA when Jev is dark. Classification, not prose.

    Replaces an 8k-token editorial LLM that invented scores. Metrics are
    already computed; notes stay checkable (length, density, dashes).
    """
    notes: list[str] = []
    if word_count < 600:
        notes.append(
            f"Short article ({word_count} words); readers expect more depth."
        )
        length_score = 0.45
    elif word_count < 1200:
        length_score = 0.7
    else:
        length_score = 0.85
    if density < 0.004:
        notes.append(
            "Focus keyword appears rarely; add it to one more heading or paragraph."
        )
        density_score = 0.5
    elif density > 0.035:
        notes.append("Keyword density is high; it may read as stuffed.")
        density_score = 0.55
    else:
        density_score = 0.85
    sentences = [s for s in re.split(r"[.!?]+", article_md or "") if s.strip()]
    avg_len = (word_count / len(sentences)) if sentences else 0.0
    readability = 0.8 if 8 <= avg_len <= 28 else 0.55
    if sentences and not (8 <= avg_len <= 28):
        notes.append("Sentence length is uneven; mix short and medium sentences.")
    eeat = min(1.0, (length_score + density_score) / 2)
    overall = (eeat + readability) / 2
    if em_count or en_count:
        notes.append(
            f"Em/en-dash usage detected: {em_count} em-dash(es), "
            f"{en_count} en-dash(es). Replace with commas or periods."
        )
        overall = max(0.0, overall - 0.08)
    return QualityScore(
        overall=max(0.0, min(1.0, overall)),
        keywordDensity=float(density),
        eeatScore=max(0.0, min(1.0, eeat)),
        readability=max(0.0, min(1.0, readability)),
        notes=notes,
    )


_SOCIAL_PLATFORMS = (
    "twitter",
    "linkedin",
    "instagram",
    "facebook",
    "newsletter",
)


def template_social_snippets(
    title: str,
    article_md: str,
    platforms: list[str] | None = None,
) -> list[SocialSnippet]:
    """Extract platform posts from the article. No invented facts, no LLM."""
    from .llm import strip_ai_dashes

    wanted = [p for p in (platforms or []) if p in _SOCIAL_PLATFORMS] or list(
        _SOCIAL_PLATFORMS
    )
    heading = strip_ai_dashes((title or "").strip()) or "New article"
    paras = [
        p.strip()
        for p in re.split(r"\n\s*\n", article_md or "")
        if p.strip() and not p.lstrip().startswith("#")
    ]
    excerpt = strip_ai_dashes(
        re.sub(r"\s+", " ", paras[0] if paras else heading)
    )
    tags = [t for t in sorted(tokens(heading)) if len(t) > 3][:5]
    bodies = {
        "twitter": (f"{heading}: {excerpt}")[:277],
        "linkedin": f"{heading}\n\n{excerpt[:420]}\n\nRead the full piece.",
        "instagram": f"{heading}\n\n{excerpt[:320]}\n\nSave this for later.",
        "facebook": f"{heading}. {excerpt[:280]} What would you add?",
        "newsletter": f"{heading}\n\n{excerpt[:320]}\n\nRead more in the article.",
    }
    return [
        SocialSnippet(
            platform=p,
            body=bodies[p],
            hashtags=[f"#{t}" for t in tags[:3]] if p != "newsletter" else [],
        )
        for p in wanted
    ]


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
