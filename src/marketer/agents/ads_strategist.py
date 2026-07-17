"""Ads agents: a budget/pause strategist and an ad-copy generator.

Both are advisory-only. The strategist's output NEVER moves money by itself —
``services/ad_workflows.optimize_campaign`` hard-clamps its proposed delta in
code and then routes the result through the existing safe-execute layer
(guard + approval threshold + audit), exactly like a human-initiated change.
The copywriter just drafts text; nothing here executes anything.
"""
from __future__ import annotations

from typing import Literal

from agents import Agent
from pydantic import BaseModel, Field

from ..config import settings
from .metered import run_metered
from ..repos.ads import AdCampaign, AdMetricsDaily  # noqa: TC001 — used in signatures
from ..services.spend_context import SpendContext  # noqa: TC001 — used in signatures

# --------------------------------------------------------------------------- strategist


class StrategistRecommendation(BaseModel):
    """LLM-authored optimization proposal. ``budget_delta_usd`` is advisory —
    the caller hard-clamps it to ±20% of the current budget (min $1) before
    any change reaches the platform."""

    action: Literal["no_change", "budget_change", "pause"]
    budget_delta_usd: float = 0.0
    rationale: str = Field(min_length=1, max_length=500)


STRATEGIST_INSTRUCTIONS = """You are a paid-ads budget strategist reviewing
one campaign's recent daily performance (impressions, clicks, spend,
conversions, revenue).

Decide ONE action:
- "budget_change": performance clearly warrants scaling up (strong ROAS,
  room to grow) or down (weak ROAS, bleeding spend but not dead). Propose
  budget_delta_usd as the signed dollar change you'd ideally make — positive
  to increase, negative to decrease. Your number will be clamped to at most
  20% of the current daily budget by the caller, so propose a proportionate
  change rather than an extreme one.
- "pause": spend with materially no return over the window and no sign of
  recovering — recommend stopping rather than shrinking further.
- "no_change": signal is thin, mixed, or performance is within a healthy or
  ambiguous band. Prefer this when in doubt — this is a conservative system.

rationale: one or two sentences citing the actual numbers you saw (e.g. ROAS,
spend trend). Never fabricate metrics not present in the input.
"""


def build_ads_strategist_agent() -> Agent:
    return Agent(
        model=settings.ads_strategist_model,
        name="AdsStrategist",
        instructions=STRATEGIST_INSTRUCTIONS,
        output_type=StrategistRecommendation,
    )


def build_strategist_prompt(campaign: "AdCampaign", metrics: list["AdMetricsDaily"]) -> str:
    lines = [
        f"Campaign: {campaign.name!r} (objective: {campaign.objective or 'n/a'})",
        f"Current daily budget: ${campaign.daily_budget_usd if campaign.daily_budget_usd is not None else 'unset'}",
        "Daily metrics, most recent lookback window (date: impressions / clicks / "
        "spend_usd / conversions / revenue_usd):",
    ]
    if metrics:
        for m in sorted(metrics, key=lambda r: r.date):
            lines.append(
                f"- {m.date}: {m.impressions} / {m.clicks} / ${m.spend_usd} / "
                f"{m.conversions} / ${m.revenue_usd}"
            )
    else:
        lines.append("(no metrics rows in the lookback window)")
    return "\n".join(lines)


async def run_ads_strategist(
    campaign: "AdCampaign",
    metrics: list["AdMetricsDaily"],
    *,
    spend: "SpendContext | None" = None,
) -> StrategistRecommendation:
    agent = build_ads_strategist_agent()
    prompt = build_strategist_prompt(campaign, metrics)
    result = await run_metered(agent, prompt, spend=spend)
    return result.final_output_as(StrategistRecommendation)


# --------------------------------------------------------------------------- ad copywriter


class AdCreativeVariant(BaseModel):
    headline: str = Field(max_length=30)
    body: str = Field(max_length=90)
    cta: str = Field(max_length=20)


class AdCreativeBatch(BaseModel):
    variants: list[AdCreativeVariant]


COPYWRITER_INSTRUCTIONS = """You write short-form ad copy for performance
marketing campaigns.

Produce exactly the requested number of DISTINCT variants — vary the angle
(benefit-led, curiosity-led, urgency-led, social-proof-led, ...); never
repeat the same headline or cta twice.

Hard limits per variant:
- headline: <=30 characters. Punchy, concrete, no clickbait ellipsis.
- body: <=90 characters. One clear benefit or hook, plain language.
- cta: <=20 characters. An action verb phrase ("Shop now", "Get started",
  "Try it free").

Respect the supplied brand voice and never use a banned word if any are
listed.
"""


def build_ad_copywriter_agent() -> Agent:
    return Agent(
        model=settings.ads_strategist_model,
        name="AdCopywriter",
        instructions=COPYWRITER_INSTRUCTIONS,
        output_type=AdCreativeBatch,
    )


def build_creative_prompt(
    *,
    campaign_name: str,
    objective: str = "",
    niche_context: str = "",
    brand_context: str = "",
    count: int = 3,
) -> str:
    lines = [
        f"Generate {count} ad copy variants.",
        f"Campaign: {campaign_name!r}",
        f"Objective: {objective or 'general awareness / conversion'}",
    ]
    if niche_context:
        lines.append(niche_context)
    if brand_context:
        lines.append(brand_context)
    return "\n".join(lines)


async def run_ad_copywriter(
    *,
    campaign_name: str,
    objective: str = "",
    niche_context: str = "",
    brand_context: str = "",
    count: int = 3,
    spend: "SpendContext | None" = None,
) -> AdCreativeBatch:
    agent = build_ad_copywriter_agent()
    prompt = build_creative_prompt(
        campaign_name=campaign_name, objective=objective,
        niche_context=niche_context, brand_context=brand_context, count=count,
    )
    result = await run_metered(agent, prompt, spend=spend)
    return result.final_output_as(AdCreativeBatch)
