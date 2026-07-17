"""Inngest wiring — durable background workflows for ads, served on the same
FastAPI app and deployed via Modal.

Same discipline as the Composio adapter: config-gated and lazy. When ads are
disabled (or the ``inngest`` package isn't installed), ``mount`` is a clean
no-op and NOTHING is registered — the app runs identically. Only when enabled
do we build the client, register the durable functions, and serve them at
``/api/inngest`` for Inngest Cloud (or the dev server) to invoke.

The functions are thin: each ``ctx.step`` calls the plain, unit-tested logic in
services/ad_workflows.py. Retries/checkpoints are Inngest's job; correctness of
the work is tested independently of the runtime.
"""
from __future__ import annotations

import logging

from ..config import settings

log = logging.getLogger(__name__)

# Event names (kept as constants so producers and the functions agree).
EVENT_OPTIMIZE = "ads/campaign.optimize"
EVENT_METRICS_SYNC = "ads/metrics.sync"


def is_enabled() -> bool:
    """Inngest is active only when ads are on AND we have either a dev server
    or a signing key (Cloud)."""
    return bool(
        settings.ads_enabled
        and (settings.inngest_dev or settings.inngest_signing_key)
    )


def mount(app) -> bool:
    """Register + serve the ads workflows on ``app``. Returns True if mounted,
    False (no-op) when disabled or the package is missing. Never raises."""
    if not is_enabled():
        return False
    try:
        import inngest  # type: ignore
        import inngest.fast_api  # type: ignore
    except Exception as e:  # noqa: BLE001 — package optional
        log.warning("inngest not mounted: %s", e)
        return False

    try:
        client = inngest.Inngest(
            app_id="marketer-ads",
            is_production=not settings.inngest_dev,
            logger=log,
        )
        functions = _build_functions(inngest, client)
        inngest.fast_api.serve(app, client, functions)
        log.info("inngest mounted with %d function(s)", len(functions))
        return True
    except Exception as e:  # noqa: BLE001 — never let workflow wiring break boot
        log.warning("inngest mount failed: %s", e)
        return False


def _build_functions(inngest, client) -> list:
    """Construct the durable functions. Imported logic is the tested code in
    ad_workflows; here we only add the durable-step envelope."""
    from . import ad_workflows

    @client.create_function(
        fn_id="ads-metrics-sync",
        trigger=inngest.TriggerCron(cron="0 * * * *"),  # hourly
    )
    async def metrics_sync(ctx) -> dict:  # pragma: no cover - runtime wrapper
        async def _run() -> dict:
            # Fan out over users with an active connected ad account (queried
            # fresh each run — never a static/hardcoded list).
            user_ids = await ad_workflows.active_user_ids()
            written = await ad_workflows.sync_all_accounts_metrics(user_ids=user_ids)
            targets = await ad_workflows.active_optimize_targets(user_ids)
            return {
                "written": written,
                "targets": [(uid, str(cid)) for uid, cid in targets],
            }

        result = await ctx.step.run("sync", _run)

        # Trigger the optimizer for every active campaign synced above — one
        # event per campaign, batched into a single send_event call.
        targets = result["targets"]
        if targets:
            events = [
                inngest.Event(
                    name=EVENT_OPTIMIZE, data={"user_id": uid, "campaign_id": cid}
                )
                for uid, cid in targets
            ]
            await ctx.step.send_event("trigger-optimize", events)

        return {"rows_written": result["written"], "optimize_triggered": len(targets)}

    @client.create_function(
        fn_id="ads-optimize",
        trigger=inngest.TriggerEvent(event=EVENT_OPTIMIZE),
    )
    async def optimize(ctx) -> dict:  # pragma: no cover - runtime wrapper
        data = ctx.event.data
        user_id = data["user_id"]
        campaign_id = data["campaign_id"]

        async def _run():
            from uuid import UUID  # noqa: PLC0415

            return await ad_workflows.optimize_campaign(
                user_id=user_id, campaign_id=UUID(str(campaign_id))
            )

        result = await ctx.step.run("optimize", _run)
        return result

    return [metrics_sync, optimize]
