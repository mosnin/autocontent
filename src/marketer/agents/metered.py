"""Metered wrapper around ``Runner.run``.

Every Agents-SDK call spends real money; this is the single choke point
that (a) gates the call behind the spend caps and (b) records the token
cost into spend_ledger so LLM spend is visible to caps, cost-by-job, and
hosted billing — the same contract every media provider already honors.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

from agents import Agent, Runner

from ..config import settings
from ..observability import model_span
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext

PROVIDER = "openai"
# Deadline for one whole agent run (every model turn in it). The Agents SDK
# builds its own client with a 10-minute timeout per HTTP call and no limit on
# the run; without a ceiling a stuck run holds its job (and its concurrency
# slot) until the container is killed. Raises TimeoutError, which callers
# treat like any other failed stage.
AGENT_RUN_TIMEOUT_SEC = 600.0


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

    model = _model_name(agent)
    async with model_span(
        "chat",
        model=model,
        provider=provider,
        tenant_id=spend.user_id if spend is not None else None,
        attributes={"gen_ai.agent.name": getattr(agent, "name", None)},
    ) as call:
        if call.content_allowed:
            instructions = getattr(agent, "instructions", None)
            instructions = instructions if isinstance(instructions, str) else None
            call.prompt(([{"role": "system", "content": instructions}] if instructions else []) + [{"role": "user", "content": input}])
        result = await asyncio.wait_for(
            Runner.run(agent, input=input), timeout=AGENT_RUN_TIMEOUT_SEC
        )
        usage = result.context_wrapper.usage
        call.usage(usage.input_tokens, usage.output_tokens, usage.total_tokens)
        if call.content_allowed:
            call.completion(_output_text(result.final_output))

        if spend is not None:
            # Priced as before: a non-string model without cost_fn is priced
            # at the configured default.
            priced = agent.model if isinstance(agent.model, str) and agent.model else settings.agent_model
            cost = (
                cost_fn(usage.input_tokens, usage.output_tokens)
                if cost_fn is not None
                else llm_cost(priced, usage.input_tokens, usage.output_tokens)
            )
            call.cost(cost)
            await spend.log(
                provider=provider,
                sku=sku or f"llm:{priced}",
                units=Decimal(usage.total_tokens),
                cost_usd=cost,
            )
    return result


def _model_name(agent: Agent) -> str:
    """The model id for pricing and spans: a string model, an SDK model
    object's ``model`` (OpenRouter), else the configured default."""
    m = getattr(agent, "model", None)
    if isinstance(m, str) and m:
        return m
    inner = getattr(m, "model", None)
    if isinstance(inner, str) and inner:
        return inner
    return settings.agent_model


def _output_text(output: object) -> str:
    if output is None:
        return ""
    if isinstance(output, str):
        return output
    dump = getattr(output, "model_dump_json", None)
    if callable(dump):
        try:
            return str(dump())
        except Exception:  # noqa: BLE001
            pass
    return str(output)
