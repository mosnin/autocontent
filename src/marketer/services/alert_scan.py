"""Performance alert scan over synced metrics (Team Competitors).

Wired into the hourly scheduler via modal_app.press_growth_cron; must stay
a cheap no-op when MARKETER_PERFORMANCE_ALERTS_ENABLED is off — the cron
calls it unconditionally every hour.

Three independent rules, each isolated so one failing rule (or one
failing user within a rule) never blocks the others:

  * cadence_slip   — a niche with a nonzero weekly article cadence that
                      has produced 0 articles in the last 10+ days.
  * quality_drop   — a user's latest scored article falls more than
                      _QUALITY_MARGIN below their trailing average.
  * ranking_drop   — a query's average position worsened by more than 5
                      spots week-over-week. ONLY runs if Team GSC's
                      gsc_daily table exists yet (checked via
                      `to_regclass`, never by importing their code — they
                      ship it concurrently and it may not land first).

All three dedupe against `performance_alerts`: an identical unacknowledged
alert (same user, kind, message) is not re-raised.
"""
from __future__ import annotations

from ..logging import get_logger

log = get_logger(__name__)

# Latest score must trail the average of the prior articles by at least
# this much (both on QualityScore's 0-1 `overall` scale) to count as a drop.
_QUALITY_MARGIN = 0.15
# Need at least this many trailing (pre-latest) scored articles before a
# "trailing average" is meaningful enough to alert against.
_QUALITY_MIN_TRAILING = 3
_CADENCE_SLIP_DAYS = 10
# Cap how many ranking_drop alerts one scan raises per user, so a single
# bad week for a high-query-count account doesn't flood the inbox.
_RANKING_DROP_MAX_PER_USER = 5


async def _scan_cadence_slip() -> int:
    from ..repos import competitors as competitors_repo

    raised = 0
    for niche in await competitors_repo.niches_with_cadence():
        try:
            days = await competitors_repo.latest_article_days_since(niche["id"])
            if days is not None and days < _CADENCE_SLIP_DAYS:
                continue

            when = (
                "has never produced an article"
                if days is None
                else f"produced 0 articles in the last {int(days)} days"
            )
            message = f'"{niche["title"]}" {when} (target: {niche["articles_per_week"]}/week)'
            if await competitors_repo.has_unacknowledged(
                niche["user_id"], kind="cadence_slip", message=message
            ):
                continue

            severity = "critical" if (days is None or days >= 30) else "warn"
            await competitors_repo.create_alert(
                user_id=niche["user_id"], kind="cadence_slip", severity=severity,
                message=message,
                context={
                    "niche_id": str(niche["id"]), "days_since": days,
                    "articles_per_week": niche["articles_per_week"],
                },
            )
            raised += 1
        except Exception:  # noqa: BLE001 — one niche's failure must not sink the scan
            log.exception("cadence_slip scan failed", extra={"niche_id": str(niche.get("id"))})
            continue
    return raised


async def _scan_quality_drop() -> int:
    from ..repos import competitors as competitors_repo

    raised = 0
    for user_id in await competitors_repo.distinct_users_with_scored_articles():
        try:
            rows = await competitors_repo.quality_scores_for_user(user_id)
            rows = [r for r in rows if r.get("overall") is not None]
            if len(rows) < _QUALITY_MIN_TRAILING + 1:
                continue  # not enough history for a meaningful trailing average

            latest, trailing = rows[0], rows[1:]
            avg_trailing = sum(r["overall"] for r in trailing) / len(trailing)
            if avg_trailing - latest["overall"] < _QUALITY_MARGIN:
                continue

            message = (
                f"Latest article quality ({latest['overall']:.2f}) is below your "
                f"trailing average ({avg_trailing:.2f})"
            )
            if await competitors_repo.has_unacknowledged(
                user_id, kind="quality_drop", message=message
            ):
                continue

            await competitors_repo.create_alert(
                user_id=user_id, kind="quality_drop", severity="warn", message=message,
                context={
                    "article_id": str(latest["id"]),
                    "niche_id": str(latest["niche_id"]) if latest.get("niche_id") else None,
                    "latest_overall": latest["overall"], "trailing_avg": avg_trailing,
                },
            )
            raised += 1
        except Exception:  # noqa: BLE001 — one user's failure must not sink the scan
            log.exception("quality_drop scan failed", extra={"user_id": user_id})
            continue
    return raised


async def _scan_ranking_drop() -> int:
    from ..repos import competitors as competitors_repo

    # Team GSC ships gsc_daily concurrently; probe rather than import their
    # code so this scan degrades cleanly if it hasn't landed yet.
    if not await competitors_repo.gsc_daily_exists():
        return 0

    raised = 0
    for user_id in await competitors_repo.distinct_gsc_users():
        try:
            drops = await competitors_repo.ranking_drops_for_user(user_id)
            for d in drops[:_RANKING_DROP_MAX_PER_USER]:
                message = (
                    f'Ranking for "{d["query"]}" worsened from position '
                    f'{d["prior_position"]:.1f} to {d["current_position"]:.1f}'
                )
                if await competitors_repo.has_unacknowledged(
                    user_id, kind="ranking_drop", message=message
                ):
                    continue
                await competitors_repo.create_alert(
                    user_id=user_id, kind="ranking_drop", severity="warn", message=message,
                    context={
                        "query": d["query"], "prior_position": float(d["prior_position"]),
                        "current_position": float(d["current_position"]),
                    },
                )
                raised += 1
        except Exception:  # noqa: BLE001 — one user's failure must not sink the scan
            log.exception("ranking_drop scan failed", extra={"user_id": user_id})
            continue
    return raised


async def run() -> dict:
    from ..config import settings

    if not settings.performance_alerts_enabled:
        return {"skipped": "disabled", "cadence_slip": 0, "quality_drop": 0, "ranking_drop": 0}

    results: dict = {}
    for key, fn in (
        ("cadence_slip", _scan_cadence_slip),
        ("quality_drop", _scan_quality_drop),
        ("ranking_drop", _scan_ranking_drop),
    ):
        try:
            results[key] = await fn()
        except Exception:  # noqa: BLE001 — one rule's failure must not sink the others
            log.exception("alert scan: %s failed", key)
            results[key] = 0
    return results
