"""The campaign runner: turns a Campaign's lanes into actual work.

Runs on an hourly Modal cron. For every `running` campaign:

1. **Window / budget gates** — past `ends_at`, or content-credit spend
   at/over `budget_usd`, the campaign flips to `completed` and stops
   spawning. (Ad platform spend is governed separately by the fail-closed
   AdSpendGuard — a campaign's budget covers generation credits.)
2. **Cadence pacing** — each enabled video/article lane targets
   `cadence_per_week` pieces. Work is spread across the week
   (168h / cadence between spawns) rather than front-loaded, and the
   weekly count is a hard stop.
3. **Attribution** — every spawned job/article carries `campaign_id`, so
   spend and output roll up to the campaign automatically. Video lanes
   inherit the niche's platforms — publishing to socials is the video
   pipeline's existing final stage.

Ad lanes are linked for reporting; their lifecycle stays in the governed
ads layer (nothing here can move ad money).

`spawn_video` / `spawn_article` are injectable for tests; production
defaults spawn the Modal functions.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from ..logging import get_logger
from ..models import Campaign
from ..repos import campaigns as campaigns_repo
from ..repos import niches as niches_repo

log = get_logger(__name__)

HOURS_PER_WEEK = 168.0


async def _default_spawn_video(user_id: str, niche_id: UUID, platform: str,
                               campaign_id: UUID) -> None:
    import modal

    from ..repos import jobs as jobs_repo

    job = await jobs_repo.create(
        user_id=user_id, niche_id=niche_id, platform=platform,
        campaign_id=campaign_id,
    )
    fn = modal.Function.from_name("marketer-sh", "run_pipeline")
    fn.spawn(user_id, str(niche_id), platform, str(job.id))


async def _default_spawn_article(user_id: str, niche_id: UUID,
                                 campaign_id: UUID) -> None:
    import modal

    from ..repos import articles as articles_repo

    article = await articles_repo.create(
        user_id=user_id, niche_id=niche_id, campaign_id=campaign_id,
    )
    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    fn.spawn(user_id, str(niche_id), str(article.id), "")


def _due(lane_stats: dict | None, cadence_per_week: int, now: datetime) -> bool:
    """A lane is due when under its weekly quota AND spaced out enough
    that the week's quota spreads evenly instead of front-loading."""
    if lane_stats is None:
        return True
    if lane_stats["last7"] >= cadence_per_week:
        return False
    last_at = lane_stats.get("last_at")
    if last_at is None:
        return True
    gap_hours = (now - last_at).total_seconds() / 3600.0
    return gap_hours >= (HOURS_PER_WEEK / cadence_per_week)


async def run_campaign_tick(
    campaign: Campaign,
    *,
    spawn_video=_default_spawn_video,
    spawn_article=_default_spawn_article,
    now: datetime | None = None,
) -> dict:
    """Advance one campaign by one tick. Returns a summary dict."""
    now = now or datetime.now(timezone.utc)
    uid = campaign.user_id

    if campaign.ends_at is not None and now >= campaign.ends_at:
        await campaigns_repo.set_status(campaign.id, user_id=uid, status="completed")
        return {"campaign_id": str(campaign.id), "action": "completed", "reason": "window ended"}

    spent = await campaigns_repo.spent_usd(campaign.id, user_id=uid)
    if spent >= campaign.budget_usd:
        await campaigns_repo.set_status(campaign.id, user_id=uid, status="completed")
        return {
            "campaign_id": str(campaign.id), "action": "completed",
            "reason": f"budget exhausted (${spent} >= ${campaign.budget_usd})",
        }

    items = [i for i in await campaigns_repo.list_items(campaign.id, user_id=uid) if i.enabled]
    counts = await campaigns_repo.work_counts(campaign.id, user_id=uid)

    spawned: list[str] = []
    for item in items:
        if item.kind == "video":
            if not _due(counts["video"].get(item.ref_id), item.cadence_per_week, now):
                continue
            niche = await niches_repo.get(item.ref_id, user_id=uid)
            if niche is None or not niche.platforms:
                continue
            # Rotate platforms across spawns so all socials get coverage.
            total = (counts["video"].get(item.ref_id) or {"total": 0})["total"]
            platform = list(niche.platforms)[total % len(niche.platforms)]
            await spawn_video(uid, niche.id, platform, campaign.id)
            spawned.append(f"video:{niche.id}:{platform}")
        elif item.kind == "article":
            if not _due(counts["article"].get(item.ref_id), item.cadence_per_week, now):
                continue
            niche = await niches_repo.get(item.ref_id, user_id=uid)
            if niche is None:
                continue
            await spawn_article(uid, niche.id, campaign.id)
            spawned.append(f"article:{niche.id}")
        # kind == "ad": linked for reporting; lifecycle stays in the
        # governed ads layer.

    return {
        "campaign_id": str(campaign.id),
        "action": "ticked",
        "spent_usd": str(spent),
        "budget_usd": str(campaign.budget_usd),
        "spawned": spawned,
    }


async def tick_all(
    *,
    spawn_video=_default_spawn_video,
    spawn_article=_default_spawn_article,
) -> dict:
    """One cron pass over every running campaign. Per-campaign failures
    are contained — one broken campaign can't stall the fleet."""
    results = []
    errors = 0
    for campaign in await campaigns_repo.list_running():
        try:
            results.append(await run_campaign_tick(
                campaign, spawn_video=spawn_video, spawn_article=spawn_article,
            ))
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning(
                "campaign tick failed",
                extra={"campaign_id": str(campaign.id), "error": str(e)},
            )
    return {"campaigns": len(results), "errors": errors, "results": results}

