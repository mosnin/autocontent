"""Ads experiments — creative A/B and governed budget ramps (Team Ads-Scale).

Every mutation this surface can trigger (a budget step, a safety pause) flows
through the same safe-execute layer as the rest of Ads
(marketer.services.ad_actions_exec) — this route module never calls
composio_client or the guard directly, only marketer.services.ad_experiments.

Registered in main.py at /api/v1/ads/experiments. Every route is
user_id-scoped via AuthCtx, consistent with backend/routes/ads.py.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.repos import ad_experiments as experiments_repo
from marketer.services import ad_experiments as experiments_svc
from marketer.services.ad_actions_exec import AdSpendDenied
from marketer.services.composio_client import AdsDisabled, ComposioCallError

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class CreateExperimentBody(BaseModel):
    campaign_id: UUID
    kind: str
    config: dict = Field(default_factory=dict)


@router.post("", response_model=experiments_repo.AdExperiment, status_code=201)
async def create_experiment(
    body: CreateExperimentBody, ctx: AuthCtx = CurrentUser
) -> experiments_repo.AdExperiment:
    """Create a DRAFT experiment. For creative_ab, config.creative_ids must
    reference 2-4 existing ad_creatives rows already on the campaign; for
    budget_ramp, config must have target_daily_usd/step_pct(<=20)/
    interval_days. No spend happens until start()/advance()."""
    try:
        return await experiments_svc.create_experiment(
            user_id=ctx.user_id, campaign_id=body.campaign_id,
            kind=body.kind, config=body.config,
        )
    except experiments_svc.ExperimentConfigError as e:
        raise HTTPException(422, str(e)) from e
    except experiments_svc.ExperimentNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e


@router.get("", response_model=list[experiments_repo.AdExperiment])
async def list_experiments(
    campaign_id: UUID | None = None, ctx: AuthCtx = CurrentUser
) -> list[experiments_repo.AdExperiment]:
    return await experiments_repo.list_experiments(ctx.user_id, campaign_id=campaign_id)


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    experiment = await experiments_repo.get_experiment(experiment_id, user_id=ctx.user_id)
    if experiment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "experiment not found")
    arms = await experiments_repo.list_arms(experiment.id)
    return {
        "experiment": experiment.model_dump(mode="json"),
        "arms": [a.model_dump(mode="json") for a in arms],
    }


@router.post("/{experiment_id}/start", response_model=experiments_repo.AdExperiment)
async def start_experiment(
    experiment_id: UUID, ctx: AuthCtx = CurrentUser
) -> experiments_repo.AdExperiment:
    """Move a draft experiment to running. Requires the campaign to be
    active; no-ops (returns the experiment unchanged) when the experiments
    feature or Ads itself is disabled, or if it's already past draft."""
    try:
        return await experiments_svc.start(experiment_id, user_id=ctx.user_id)
    except experiments_svc.ExperimentNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except experiments_svc.ExperimentStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


@router.post("/{experiment_id}/advance", response_model=experiments_repo.AdExperiment)
async def advance_ramp(
    experiment_id: UUID, ctx: AuthCtx = CurrentUser
) -> experiments_repo.AdExperiment:
    """Budget ramps only: compute + submit the next step through the
    governed safe-execute layer (guard caps + approval threshold apply per
    step). Idempotent — safe to call repeatedly, including while a previous
    step awaits human approval."""
    try:
        return await experiments_svc.advance(experiment_id, user_id=ctx.user_id)
    except experiments_svc.ExperimentNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except experiments_svc.ExperimentStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except AdSpendDenied as e:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, e.reason) from e
    except AdsDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ComposioCallError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


@router.post("/{experiment_id}/evaluate", response_model=experiments_repo.AdExperiment)
async def evaluate_ab(
    experiment_id: UUID, ctx: AuthCtx = CurrentUser
) -> experiments_repo.AdExperiment:
    """Creative A/B only: attribute newly-synced metrics to arms and pick a
    winner once the minimum window is met (see marketer.services.
    ad_experiments module docstring for the attribution approximation this
    relies on). Idempotent — safe to call repeatedly, e.g. from a cron."""
    try:
        return await experiments_svc.evaluate(experiment_id, user_id=ctx.user_id)
    except experiments_svc.ExperimentNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except experiments_svc.ExperimentStateError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except AdsDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ComposioCallError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


@router.post("/{experiment_id}/cancel", response_model=experiments_repo.AdExperiment)
async def cancel_experiment(
    experiment_id: UUID, ctx: AuthCtx = CurrentUser
) -> experiments_repo.AdExperiment:
    """Cancel an experiment. Idempotent on an already-finished one."""
    try:
        return await experiments_svc.cancel(experiment_id, user_id=ctx.user_id)
    except experiments_svc.ExperimentNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
