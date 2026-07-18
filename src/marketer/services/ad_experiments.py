"""Ads experiments — creative A/B tests and governed budget ramps.

Both experiment kinds only ever touch real ad spend through the SAME
governed path the rest of Ads uses: services/ad_actions_exec.py
(``resolve_apply_fn`` -> ``propose_budget_change`` / ``apply_status_change``).
Nothing in this module calls composio_client directly, and nothing here
bypasses AdSpendGuard or the approval queue.

HONESTY NOTE on creative A/B evaluation
----------------------------------------
Composio metrics sync (services/ad_workflows.py) writes ``ad_metrics_daily``
rows keyed by **campaign + date** — platform-level per-creative/per-ad metrics
are NOT synced anywhere in this codebase yet (repos/ads.py has no per-ad
metrics table or column). A real creative A/B test needs per-creative
performance, which we do not have.

``evaluate()`` therefore approximates: once an experiment is ``running``,
each new *day* of campaign-aggregate metrics that arrives after ``start()``
is attributed, round-robin, to the next arm in rotation ("rotation period"
bookkeeping lives in ``ad_experiments.result``). After each arm has
accumulated at least ``config.window_days`` (default 7) of attributed days,
the arm with the best accumulated ROAS (or CTR, when there's no spend/
revenue signal) is picked as the winner.

This is a deliberate, documented approximation — it treats consecutive
calendar days as if they were single-creative rotations, which is not how a
real ad platform serves multiple creatives concurrently. It is directionally
useful for catching a clearly under-performing creative (see the
catastrophic-ROAS safety pause below) but is NOT a substitute for a true
concurrent multivariate test. Upgrading this to per-creative attribution
requires syncing platform-native ad-level (not campaign-level) metrics,
which is out of scope here — tracked as a known gap, not hidden.

Budget ramps have no such limitation: each ``advance()`` call computes one
step toward ``target_daily_usd``, clamped to at most ``step_pct`` of the
current daily budget, and submits it through ``propose_budget_change`` with
the campaign's REAL apply_fn (``resolve_apply_fn``) — so AdSpendGuard's caps
and the human-approval threshold apply to every single step exactly as they
would to a manual budget change.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from ..config import settings
from ..repos import ad_experiments as experiments_repo
from ..repos import ads as ads_repo
from ..repos.ad_experiments import AdExperiment
from .ad_actions_exec import AdSpendDenied, apply_status_change, propose_budget_change, resolve_apply_fn

log = logging.getLogger(__name__)

MIN_ARMS = 2
MAX_ARMS = 4
MAX_STEP_PCT = Decimal("20")
DEFAULT_WINDOW_DAYS = 7

# A ROAS this low, once enough spend has actually been booked, triggers an
# immediate safety pause of the whole campaign rather than waiting out the
# full evaluation window — catastrophic performance shouldn't wait 7 days.
CATASTROPHIC_ROAS = Decimal("0.2")
CATASTROPHIC_MIN_SPEND_USD = Decimal("20")


class ExperimentConfigError(ValueError):
    """Bad experiment config shape. Surfaced by the route as 422."""


class ExperimentNotFound(LookupError):
    """No such experiment (or not owned by this user). Surfaced as 404."""


class ExperimentStateError(RuntimeError):
    """The experiment isn't in a state that permits the requested operation
    (wrong kind for evaluate()/advance(), campaign not active, etc).
    Surfaced by the route as 409."""


def _ads_active() -> bool:
    """Both the experiments feature flag and the Ads master switch must be on.
    Mirrors composio_client.is_enabled()'s spirit: inert unless explicitly
    turned on, so nothing here can silently start acting."""
    return bool(settings.ads_experiments_enabled and settings.ads_enabled)


# --------------------------------------------------------------------------- config validation

def validate_config(kind: str, config: dict) -> dict:
    """Validate + normalize a config dict for the given kind. Pure, no I/O.
    Raises ExperimentConfigError on a bad shape. Called by both the route
    (so bad input never reaches the DB) and create_experiment (defense in
    depth for any other caller)."""
    if kind == "creative_ab":
        creative_ids = config.get("creative_ids")
        if not isinstance(creative_ids, list) or not (MIN_ARMS <= len(creative_ids) <= MAX_ARMS):
            raise ExperimentConfigError(
                f"creative_ab requires 'creative_ids': a list of {MIN_ARMS}-{MAX_ARMS} creative ids"
            )
        try:
            ids = [UUID(str(c)) for c in creative_ids]
        except (ValueError, TypeError, AttributeError) as e:
            raise ExperimentConfigError("creative_ids must be valid UUIDs") from e
        if len(set(ids)) != len(ids):
            raise ExperimentConfigError("creative_ids must be unique")
        window_days = config.get("window_days", DEFAULT_WINDOW_DAYS)
        if not isinstance(window_days, int) or isinstance(window_days, bool) or window_days < 1:
            raise ExperimentConfigError("window_days must be a positive integer")
        return {"creative_ids": [str(i) for i in ids], "window_days": window_days}

    if kind == "budget_ramp":
        try:
            target = Decimal(str(config["target_daily_usd"]))
            step_pct = Decimal(str(config["step_pct"]))
            interval_days = int(config["interval_days"])
        except (KeyError, TypeError, ValueError, ArithmeticError) as e:
            raise ExperimentConfigError(
                "budget_ramp requires numeric 'target_daily_usd', 'step_pct', 'interval_days'"
            ) from e
        if target <= 0:
            raise ExperimentConfigError("target_daily_usd must be > 0")
        if step_pct <= 0 or step_pct > MAX_STEP_PCT:
            raise ExperimentConfigError(f"step_pct must be > 0 and <= {MAX_STEP_PCT}")
        if interval_days < 1:
            raise ExperimentConfigError("interval_days must be a positive integer")
        return {
            "target_daily_usd": str(target), "step_pct": str(step_pct),
            "interval_days": interval_days,
        }

    raise ExperimentConfigError(f"unknown experiment kind {kind!r}")


# --------------------------------------------------------------------------- create / start / cancel

async def create_experiment(
    *, user_id: str, campaign_id: UUID, kind: str, config: dict,
) -> AdExperiment:
    """Create a draft experiment. For creative_ab, also creates one arm per
    creative_id — each must already exist as an ad_creatives row on this
    campaign, owned by this user, validated BEFORE the experiment row is
    written so a bad creative id never leaves an orphaned draft behind."""
    if kind not in experiments_repo.KINDS:
        raise ExperimentConfigError(f"unknown experiment kind {kind!r}")
    normalized = validate_config(kind, config)

    campaign = await ads_repo.get_campaign(campaign_id, user_id=user_id)
    if campaign is None:
        raise ExperimentNotFound("campaign not found")

    creatives_by_id: dict[str, ads_repo.AdCreative] = {}
    if kind == "creative_ab":
        campaign_creatives = await ads_repo.list_creatives(user_id, campaign_id=campaign_id)
        creatives_by_id = {str(c.id): c for c in campaign_creatives}
        missing = [cid for cid in normalized["creative_ids"] if cid not in creatives_by_id]
        if missing:
            raise ExperimentConfigError(
                f"creative(s) not found on campaign {campaign_id}: {missing}"
            )

    experiment = await experiments_repo.create_experiment(
        user_id=user_id, campaign_id=campaign_id, kind=kind, config=normalized,
    )

    if kind == "creative_ab":
        for cid in normalized["creative_ids"]:
            creative = creatives_by_id[cid]
            await experiments_repo.create_arm(
                experiment_id=experiment.id, creative_id=creative.id,
                label=creative.headline or str(creative.id)[:8],
            )

    return experiment


async def start(experiment_id: UUID, *, user_id: str) -> AdExperiment:
    """Move a draft experiment to running. No-ops cleanly (returns the
    experiment untouched) when experiments/ads are disabled, or when it's
    already past draft (idempotent)."""
    experiment = await experiments_repo.get_experiment(experiment_id, user_id=user_id)
    if experiment is None:
        raise ExperimentNotFound("experiment not found")
    if not _ads_active():
        return experiment
    if experiment.status != "draft":
        return experiment  # idempotent: already started/finished

    campaign = await ads_repo.get_campaign(experiment.campaign_id, user_id=user_id)
    if campaign is None:
        raise ExperimentNotFound("campaign not found")
    if campaign.status != "active":
        raise ExperimentStateError(
            f"campaign must be active to start an experiment (is {campaign.status!r})"
        )

    now = datetime.now(timezone.utc)
    result = dict(experiment.result)
    if experiment.kind == "creative_ab":
        result.setdefault("rotation_index", 0)
        result.setdefault("last_attributed_date", None)
    else:  # budget_ramp
        result.setdefault("last_step_at", None)
        result.setdefault("steps", [])
        result.setdefault("pending_approval_id", None)

    updated = await experiments_repo.update_experiment(
        experiment_id, user_id=user_id, status="running", started_at=now, result=result,
    )
    return updated or experiment


async def cancel(experiment_id: UUID, *, user_id: str) -> AdExperiment:
    """Cancel an experiment. Idempotent — cancelling an already-finished one
    just returns it unchanged."""
    experiment = await experiments_repo.get_experiment(experiment_id, user_id=user_id)
    if experiment is None:
        raise ExperimentNotFound("experiment not found")
    if experiment.status in {"completed", "cancelled"}:
        return experiment
    updated = await experiments_repo.update_experiment(
        experiment_id, user_id=user_id, status="cancelled",
        completed_at=datetime.now(timezone.utc),
    )
    return updated or experiment


# --------------------------------------------------------------------------- creative A/B evaluation

def _score_arm(m: dict) -> Decimal:
    """ROAS when there's spend/revenue signal, else CTR, else -1 (never
    picked as a winner over any arm with real signal)."""
    spend = Decimal(str(m.get("spend_usd", "0")))
    revenue = Decimal(str(m.get("revenue_usd", "0")))
    if spend > 0:
        return revenue / spend
    impressions = Decimal(str(m.get("impressions", 0)))
    clicks = Decimal(str(m.get("clicks", 0)))
    if impressions > 0:
        return clicks / impressions
    return Decimal("-1")


async def evaluate(experiment_id: UUID, *, user_id: str) -> AdExperiment:
    """Attribute any newly-synced days of campaign metrics to arms (round-
    robin — see the module docstring's honesty note), and pick a winner once
    every arm has enough attributed days. Idempotent: calling it again with
    no new metrics rows is a no-op; calling it on an already-completed/
    cancelled experiment just returns it. Callable manually or from a cron."""
    experiment = await experiments_repo.get_experiment(experiment_id, user_id=user_id)
    if experiment is None:
        raise ExperimentNotFound("experiment not found")
    if experiment.kind != "creative_ab":
        raise ExperimentStateError("evaluate() only applies to creative_ab experiments")
    if not _ads_active():
        return experiment
    if experiment.status != "running":
        return experiment

    campaign = await ads_repo.get_campaign(experiment.campaign_id, user_id=user_id)
    if campaign is None:
        return experiment
    arms = await experiments_repo.list_arms(experiment.id)
    if not arms:
        return experiment

    all_metrics = await ads_repo.campaign_metrics(experiment.campaign_id, user_id=user_id, limit=365)
    start_date = (experiment.started_at or experiment.created_at).date()
    window = sorted((m for m in all_metrics if m.date >= start_date), key=lambda m: m.date)

    result = dict(experiment.result)
    rotation_index = int(result.get("rotation_index", 0))
    last_attributed_raw = result.get("last_attributed_date")
    last_attributed_date = date.fromisoformat(last_attributed_raw) if last_attributed_raw else None

    arm_metrics: dict[str, dict] = {str(a.id): dict(a.metrics) for a in arms}

    for daily in window:
        if last_attributed_date is not None and daily.date <= last_attributed_date:
            continue  # already attributed on a previous evaluate() call
        arm = arms[rotation_index % len(arms)]
        bucket = arm_metrics[str(arm.id)]
        bucket["impressions"] = int(bucket.get("impressions", 0)) + daily.impressions
        bucket["clicks"] = int(bucket.get("clicks", 0)) + daily.clicks
        bucket["spend_usd"] = str(Decimal(str(bucket.get("spend_usd", "0"))) + daily.spend_usd)
        bucket["conversions"] = str(Decimal(str(bucket.get("conversions", "0"))) + daily.conversions)
        bucket["revenue_usd"] = str(Decimal(str(bucket.get("revenue_usd", "0"))) + daily.revenue_usd)
        bucket["days_attributed"] = int(bucket.get("days_attributed", 0)) + 1
        rotation_index += 1
        last_attributed_date = daily.date

    for arm in arms:
        await experiments_repo.update_arm(arm.id, metrics=arm_metrics[str(arm.id)])

    result["rotation_index"] = rotation_index
    result["last_attributed_date"] = (
        last_attributed_date.isoformat() if last_attributed_date else None
    )

    # Safety check: catastrophic AGGREGATE ROAS (real booked spend, not the
    # per-arm approximation) pauses the whole campaign immediately, through
    # the same governed path any other pause takes.
    total_spend = sum((m.spend_usd for m in window), Decimal("0"))
    total_revenue = sum((m.revenue_usd for m in window), Decimal("0"))
    if total_spend >= CATASTROPHIC_MIN_SPEND_USD and not result.get("safety_paused"):
        roas = total_revenue / total_spend
        if roas < CATASTROPHIC_ROAS:
            account = await ads_repo.get_account(campaign.ad_account_id, user_id=user_id)
            try:
                await apply_status_change(
                    campaign=campaign, account=account, new_status="paused",
                    actor="agent", actor_email="experiments@marketer.sh",
                )
                result["safety_paused"] = True
            except Exception:  # noqa: BLE001 — a failed safety pause must not crash evaluate()
                log.warning(
                    "experiment %s: safety pause on catastrophic ROAS failed",
                    experiment.id, exc_info=True,
                )
            result["safety_pause_reason"] = (
                f"aggregate ROAS {roas} below catastrophic threshold {CATASTROPHIC_ROAS} "
                f"over ${total_spend} booked spend"
            )
            return await experiments_repo.update_experiment(
                experiment.id, user_id=user_id, status="cancelled", result=result,
                completed_at=datetime.now(timezone.utc),
            ) or experiment

    window_days = int(experiment.config.get("window_days", DEFAULT_WINDOW_DAYS))
    ready = all(arm_metrics[str(a.id)].get("days_attributed", 0) >= window_days for a in arms)

    if ready:
        scored = [(a, _score_arm(arm_metrics[str(a.id)])) for a in arms]
        winner, best_score = max(scored, key=lambda t: t[1])
        for a, _s in scored:
            await experiments_repo.update_arm(a.id, is_winner=(a.id == winner.id))
        result["winner_arm_id"] = str(winner.id)
        result["winner_score"] = str(best_score)
        return await experiments_repo.update_experiment(
            experiment.id, user_id=user_id, status="completed", result=result,
            completed_at=datetime.now(timezone.utc),
        ) or experiment

    return await experiments_repo.update_experiment(
        experiment.id, user_id=user_id, result=result,
    ) or experiment


# --------------------------------------------------------------------------- budget ramp

async def advance(experiment_id: UUID, *, user_id: str, apply_fn=None) -> AdExperiment:
    """Compute and submit the next budget-ramp step through the governed
    safe-execute layer. *apply_fn* is injectable for tests; production
    always resolves the campaign's real apply_fn via resolve_apply_fn so
    guard caps + the approval threshold apply per step exactly as they would
    to a manual change.

    Idempotent: if a previous step is still pending_approval, re-checks its
    decision and only proceeds once it's resolved (a rejection cancels the
    ramp); if the interval since the last applied step hasn't elapsed yet,
    it's a no-op; if the target is already met, the experiment completes."""
    experiment = await experiments_repo.get_experiment(experiment_id, user_id=user_id)
    if experiment is None:
        raise ExperimentNotFound("experiment not found")
    if experiment.kind != "budget_ramp":
        raise ExperimentStateError("advance() only applies to budget_ramp experiments")
    if not _ads_active():
        return experiment
    if experiment.status != "running":
        return experiment

    result = dict(experiment.result)

    # A previous step may still be awaiting a human decision.
    pending_id = result.get("pending_approval_id")
    if pending_id:
        from ..repos import ad_approvals

        approval = await ad_approvals.get(UUID(pending_id), user_id=user_id)
        if approval is None or approval.status == "pending":
            return experiment  # still waiting — no-op, safely re-checkable
        if approval.status == "rejected":
            result["pending_approval_id"] = None
            result["cancelled_reason"] = "budget ramp step was rejected"
            return await experiments_repo.update_experiment(
                experiment.id, user_id=user_id, status="cancelled", result=result,
                completed_at=datetime.now(timezone.utc),
            ) or experiment
        # approved or executed: clear the flag and fall through to compute
        # the next step (this call effectively also advances the ramp).
        result["pending_approval_id"] = None

    campaign = await ads_repo.get_campaign(experiment.campaign_id, user_id=user_id)
    if campaign is None:
        return experiment

    config = experiment.config
    target = Decimal(str(config["target_daily_usd"]))
    step_pct = Decimal(str(config["step_pct"]))
    interval_days = int(config["interval_days"])

    current = campaign.daily_budget_usd or Decimal("0")
    if current >= target:
        return await experiments_repo.update_experiment(
            experiment.id, user_id=user_id, status="completed", result=result,
            completed_at=datetime.now(timezone.utc),
        ) or experiment

    now = datetime.now(timezone.utc)
    last_step_at = result.get("last_step_at")
    if last_step_at:
        elapsed = now - datetime.fromisoformat(last_step_at)
        if elapsed.days < interval_days:
            return experiment  # interval hasn't elapsed — no-op

    # Step size is step_pct of the current budget; when there's no budget
    # yet to take a percentage of (a fresh/draft campaign), bootstrap off
    # the target instead so the ramp can still make forward progress.
    base = current if current > 0 else target
    step_amount = (base * step_pct / Decimal("100")).quantize(Decimal("0.01"))
    next_budget = min(current + step_amount, target)

    try:
        outcome = await propose_budget_change(
            user_id=user_id, campaign_id=campaign.id,
            new_daily_budget_usd=next_budget, actor="agent",
            actor_email="experiments@marketer.sh",
            apply_fn=apply_fn or await resolve_apply_fn(campaign),
        )
    except AdSpendDenied as denied:
        result["cancelled_reason"] = f"budget ramp step denied: {denied.reason}"
        return await experiments_repo.update_experiment(
            experiment.id, user_id=user_id, status="cancelled", result=result,
            completed_at=datetime.now(timezone.utc),
        ) or experiment

    steps = list(result.get("steps", []))
    steps.append({
        "at": now.isoformat(), "from": str(current), "to": str(next_budget),
        "status": outcome["status"],
    })
    result["steps"] = steps

    if outcome["status"] == "pending_approval":
        result["pending_approval_id"] = outcome["approval_id"]
        return await experiments_repo.update_experiment(
            experiment.id, user_id=user_id, result=result,
        ) or experiment

    result["last_step_at"] = now.isoformat()
    kwargs: dict = {"result": result}
    if next_budget >= target:
        kwargs["status"] = "completed"
        kwargs["completed_at"] = now
    return await experiments_repo.update_experiment(
        experiment.id, user_id=user_id, **kwargs,
    ) or experiment
