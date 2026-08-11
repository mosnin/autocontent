"""Performance context builder.

Fetches top and bottom performing jobs for a niche from the last N days,
loads the associated script ideas, and returns a markdown block that the
ideation agent can use to tune its suggestions.

Depends on:
- ``post_metrics.top_performers_for_niche`` / ``bottom_performers_for_niche``
  (provided by the analytics-ingestion + performance-attribution PRs).
- ``jobs_repo.get`` to hydrate job_id → Script.idea.

Cold-start: if no metrics exist yet, returns ``""`` so the ideation agent
falls back to its default priors unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from ..repos import jobs as jobs_repo
from ..repos import post_metrics


@dataclass
class WinnerLoser:
    job_id: UUID
    hook: str
    topic: str
    views: int
    completion_rate: float | None = None


async def build_performance_context(
    *,
    niche_id: UUID,
    user_id: str,
    lookback_days: int = 30,
    top_n: int = 5,
    bottom_n: int = 5,
) -> str:
    """Return a markdown block summarising top and bottom performers.

    Returns an empty string when no metrics are available yet (cold-start).
    Jobs that no longer exist or that were never scripted are silently skipped.
    """
    top_pairs = await post_metrics.top_performers_for_niche(
        niche_id, user_id=user_id, limit=top_n, days=lookback_days
    )
    bottom_pairs = await post_metrics.bottom_performers_for_niche(
        niche_id, user_id=user_id, limit=bottom_n, days=lookback_days
    )

    if not top_pairs and not bottom_pairs:
        return ""

    async def _hydrate(pairs) -> list[WinnerLoser]:
        # Tolerates (job_id, views) pairs and (job_id, views, completion)
        # triples so older callers/fixtures keep working.
        results: list[WinnerLoser] = []
        for job_id, views, *rest in pairs:
            completion = rest[0] if rest else None
            job = await jobs_repo.get(job_id, user_id=user_id)
            if job is None:
                continue
            if job.script is None or job.script.idea is None:
                continue
            results.append(
                WinnerLoser(
                    job_id=job_id,
                    hook=job.script.idea.hook,
                    topic=job.script.idea.topic,
                    views=views,
                    completion_rate=float(completion) if completion is not None else None,
                )
            )
        return results

    winners = await _hydrate(top_pairs)
    losers = await _hydrate(bottom_pairs)

    if not winners and not losers:
        return ""

    lines: list[str] = []

    def _fmt(w: WinnerLoser) -> str:
        completion = (
            f", completion: {w.completion_rate:.0%}"
            if w.completion_rate is not None
            else ""
        )
        return f'"{w.hook}" — topic: {w.topic}, views: {w.views:,}{completion}'

    if winners:
        lines.append(
            f"## What's working in this niche (top performers by completion, last {lookback_days} days)"
        )
        for i, w in enumerate(winners, 1):
            lines.append(f"{i}. {_fmt(w)}")

    if losers:
        lines.append("## What's flopped (bottom performers)")
        for i, lo in enumerate(losers, 1):
            lines.append(f"{i}. {_fmt(lo)}")

    return "\n".join(lines)
