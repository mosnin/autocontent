"""Exa-backed SERP research (direct API, async).

The upstream harness proxied these calls through its web app; here we
call Exa directly. When MARKETER_EXA_API_KEY is unset, `serp_pages`
returns [] and the pipeline degrades to model-knowledge-only research
instead of failing.
"""
from __future__ import annotations

from urllib.parse import urlparse

import httpx

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

_EXA_URL = "https://api.exa.ai/search"
_TIMEOUT = 30.0


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.removeprefix("www.")
    except Exception:  # noqa: BLE001
        return ""


async def serp_pages(keyword: str, num_results: int = 8) -> list[dict]:
    """Top-ranking pages for `keyword` with text excerpts.

    Returns a list of {title, url, domain, wordCountEstimate, highlights,
    excerpt} dicts ready for `llm.summarize_serp`. Empty list when Exa is
    not configured or the request fails (research degrades gracefully —
    an article without SERP data beats a failed run).
    """
    if not settings.exa_api_key:
        log.info("exa not configured; skipping SERP research")
        return []

    payload = {
        "query": keyword,
        "numResults": num_results,
        "type": "auto",
        "contents": {
            "text": {"maxCharacters": 2500},
            "highlights": {"numSentences": 2, "highlightsPerUrl": 3},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _EXA_URL,
                json=payload,
                headers={"x-api-key": settings.exa_api_key},
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("exa search failed; continuing without SERP data", extra={"error": str(exc)})
        return []

    pages: list[dict] = []
    for r in data.get("results", []) or []:
        text = r.get("text") or ""
        pages.append(
            {
                "title": r.get("title") or "",
                "url": r.get("url") or "",
                "domain": _domain(r.get("url") or ""),
                # Excerpts are capped; scale the estimate up when the cap
                # was clearly hit so recommendedWordCount isn't anchored low.
                "wordCountEstimate": max(len(text.split()), 300) if text else None,
                "highlights": r.get("highlights") or [],
                "excerpt": text[:2500],
            }
        )
    return pages
