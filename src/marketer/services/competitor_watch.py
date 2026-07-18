"""Hourly competitor monitoring scan (Team Competitors).

Wired into the nightly/hourly scheduler via modal_app.press_growth_cron;
must stay a cheap no-op when MARKETER_COMPETITOR_WATCH_ENABLED is off or
Exa is unconfigured — the cron calls it unconditionally every hour.

For each tracked competitor domain, fetches recent pages via Exa
(domain-filtered search — reusing the same client pattern as
``marketer.articles.exa.serp_pages``, not a copy of it), diffs the results
against ``competitor_articles``, records new finds, and raises an
``competitor_activity`` alert (info severity) when a newly-found article's
title overlaps one of the user's niche focus areas (title/description/
hashtags) — a cheap keyword-overlap heuristic, not an LLM call, so the scan
stays fast and free to run hourly.

Per-competitor isolation: one competitor's fetch/parse failure is logged and
skipped rather than aborting the whole pass (each competitor belongs to one
user, so this doubles as per-user isolation).
"""
from __future__ import annotations

import re

import httpx

from ..articles.exa import _EXA_URL, _TIMEOUT
from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

_WORD_RE = re.compile(r"[a-zA-Z]{4,}")
_STOPWORDS = {
    "this", "that", "with", "from", "your", "what", "when", "where", "will",
    "have", "into", "about", "them", "they", "then", "than", "best", "guide",
}


async def _fetch_domain_pages(domain: str, *, num_results: int = 10) -> list[dict]:
    """Recent pages Exa has indexed for `domain`. Returns
    [{url, title, published_hint}, ...]; empty list on any failure or when
    Exa is unconfigured (degrade, never raise — the same contract as
    articles/exa.py's serp_pages)."""
    if not settings.exa_api_key:
        return []

    payload = {
        "query": domain,
        "numResults": num_results,
        "type": "auto",
        "includeDomains": [domain],
        "contents": {"text": {"maxCharacters": 200}},
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _EXA_URL, json=payload, headers={"x-api-key": settings.exa_api_key}
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning(
            "exa domain search failed; skipping competitor",
            extra={"domain": domain, "error": str(exc)},
        )
        return []

    pages: list[dict] = []
    for r in data.get("results", []) or []:
        url = r.get("url") or ""
        if not url:
            continue
        pages.append({
            "url": url,
            "title": r.get("title") or "",
            "published_hint": r.get("publishedDate") or "",
        })
    return pages


def _keywords(*texts: str, extra: list[str] | None = None) -> set[str]:
    words: set[str] = set()
    for text in texts:
        words.update(w.lower() for w in _WORD_RE.findall(text or ""))
    for h in extra or []:
        h = h.lstrip("#").strip().lower()
        if h:
            words.add(h)
    return words - _STOPWORDS


def _matching_niche(article_title: str, niches: list[dict]) -> dict | None:
    """The first of `niches` whose title/description/hashtag keywords
    overlap the article's title, or None. A cheap heuristic (word overlap,
    no LLM call) so the hourly scan stays fast."""
    title_words = _keywords(article_title)
    if not title_words:
        return None
    for niche in niches:
        focus = _keywords(niche.get("title") or "", niche.get("description") or "",
                           extra=niche.get("hashtags") or [])
        if title_words & focus:
            return niche
    return None


async def run() -> dict:
    if not settings.competitor_watch_enabled:
        return {"skipped": "disabled", "competitors_scanned": 0, "found": 0, "alerts_raised": 0}
    if not settings.exa_api_key:
        log.info("competitor watch: exa not configured; no-op")
        return {
            "skipped": "exa not configured", "competitors_scanned": 0, "found": 0,
            "alerts_raised": 0,
        }

    from ..repos import competitors as competitors_repo

    tracked = await competitors_repo.list_active()
    if not tracked:
        return {"competitors_scanned": 0, "found": 0, "alerts_raised": 0}

    all_niches = await competitors_repo.all_niches_for_focus_match()

    scanned = 0
    found = 0
    alerts_raised = 0
    for comp in tracked:
        try:
            pages = await _fetch_domain_pages(comp.domain)
            scanned += 1
            if not pages:
                continue

            urls = [p["url"] for p in pages]
            already = await competitors_repo.seen_urls(comp.id, urls)
            new_pages = [p for p in pages if p["url"] not in already]
            if not new_pages:
                continue

            inserted = await competitors_repo.insert_articles(comp.id, new_pages)
            found += len(inserted)

            focus_niches = [
                n for n in all_niches
                if n["user_id"] == comp.user_id
                and (comp.niche_id is None or n["id"] == comp.niche_id)
            ]
            for article in inserted:
                niche = _matching_niche(article.title, focus_niches)
                if niche is None:
                    continue
                label = comp.label or comp.domain
                message = (
                    f'{label} published "{article.title}" — overlaps your '
                    f'"{niche["title"]}" niche focus'
                )
                if await competitors_repo.has_unacknowledged(
                    comp.user_id, kind="competitor_activity", message=message
                ):
                    continue
                await competitors_repo.create_alert(
                    user_id=comp.user_id, kind="competitor_activity", severity="info",
                    message=message,
                    context={
                        "competitor_id": str(comp.id), "domain": comp.domain,
                        "url": article.url, "niche_id": str(niche["id"]),
                    },
                )
                alerts_raised += 1
        except Exception:  # noqa: BLE001 — one competitor's failure must not sink the scan
            log.exception(
                "competitor watch failed", extra={"domain": comp.domain, "user_id": comp.user_id}
            )
            continue

    return {"competitors_scanned": scanned, "found": found, "alerts_raised": alerts_raised}
