"""Metered wrapper around ``Runner.run``.

Every Agents-SDK call spends real money; this is the single choke point
that (a) gates the call behind the spend caps and (b) records the token
cost into spend_ledger so LLM spend is visible to caps, cost-by-job, and
hosted billing — the same contract every media provider already honors.
"""
from __future__ import annotations

from decimal import Decimal

from agents import Agent, Runner

from ..config import settings
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext

PROVIDER = "openai"


async def run_metered(
    agent: Agent,
    input: str,
    *,
    spend: SpendContext | None = None,
    provider: str = PROVIDER,
    sku: str | None = None,
    cost_fn=None,
):
    """Run *agent* and log its token cost to *spend* (when provided).

    Returns the SDK ``RunResult`` — callers keep using
    ``result.final_output_as(...)`` exactly as before.

    ``provider``/``sku``/``cost_fn`` support non-OpenAI backends (e.g. an
    OpenRouter scriptwriter): cost_fn(input_tokens, output_tokens) prices
    the call with that provider's real rates instead of the OpenAI table.
    """
    if spend is not None:
        await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)

    result = await Runner.run(agent, input=input)

    if spend is not None:
        usage = result.context_wrapper.usage
        model = agent.model if isinstance(agent.model, str) and agent.model else settings.agent_model
        cost = (
            cost_fn(usage.input_tokens, usage.output_tokens)
            if cost_fn is not None
            else llm_cost(model, usage.input_tokens, usage.output_tokens)
        )
        await spend.log(
            provider=provider,
            sku=sku or f"llm:{model}",
            units=Decimal(usage.total_tokens),
            cost_usd=cost,
        )
    return result
