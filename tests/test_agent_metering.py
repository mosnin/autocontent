"""Every Agents-SDK call must be metered through SpendContext.

The audit found four LLM calls per job running completely outside the
spend ledger — unmetered COGS invisible to caps and hosted billing.
`run_metered` is the choke point that fixes that; these tests pin its
contract.
"""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from marketer.agents import metered
from marketer.services.openai_pricing import llm_cost


def _fake_result(input_tokens: int, output_tokens: int) -> SimpleNamespace:
    usage = SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )
    return SimpleNamespace(
        context_wrapper=SimpleNamespace(usage=usage),
        final_output="ok",
    )


@pytest.fixture
def fake_runner(monkeypatch):
    calls: list[tuple] = []

    async def _run(agent, input):
        calls.append((agent, input))
        return _fake_result(1000, 500)

    monkeypatch.setattr(metered.Runner, "run", staticmethod(_run))
    return calls


async def test_run_metered_logs_token_cost(fake_runner, fake_spend):
    ctx, rec = fake_spend
    agent = SimpleNamespace(model="gpt-5.4-mini")

    await metered.run_metered(agent, "hello", spend=ctx)

    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.provider == "openai"
    assert entry.sku == "llm:gpt-5.4-mini"
    assert entry.units == Decimal(1500)
    assert entry.cost_usd == llm_cost("gpt-5.4-mini", 1000, 500)
    assert entry.cost_usd > 0


async def test_run_metered_without_spend_still_runs(fake_runner):
    agent = SimpleNamespace(model="gpt-5.4-mini")
    result = await metered.run_metered(agent, "hello", spend=None)
    assert result.final_output == "ok"
    assert len(fake_runner) == 1


async def test_run_metered_preflight_blocks_before_spend(fake_runner, fake_spend):
    """A tripped cap must refuse the call BEFORE the provider is hit."""
    from marketer.repos.spend import SpendCapExceeded

    ctx, rec = fake_spend
    ctx.abort_event.set()  # sibling task already tripped the cap
    agent = SimpleNamespace(model="gpt-5.4-mini")

    with pytest.raises(SpendCapExceeded):
        await metered.run_metered(agent, "hello", spend=ctx)

    assert fake_runner == []  # provider never called
    assert rec.entries == []  # nothing spent, nothing logged


def test_llm_cost_math():
    # $0.75/M input + $4.50/M output
    assert llm_cost("gpt-5.4-mini", 1_000_000, 0) == Decimal("0.75")
    assert llm_cost("gpt-5.4-mini", 0, 1_000_000) == Decimal("4.5")
    # Unknown models bill at the conservative fallback, never $0.
    assert llm_cost("gpt-99-turbo", 1_000_000, 0) > 0
