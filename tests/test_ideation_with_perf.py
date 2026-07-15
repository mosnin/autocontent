"""Tests for ideation agent with performance context.

Covers:
1. ``build_ideation_prompt`` — pure function, no mocking needed.
2. ``run_ideation`` via the orchestrator — ``Runner.run`` is monkeypatched so
   we can assert on the exact prompt text passed to the LLM layer without
   making network calls.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from marketer.agents.ideation import build_ideation_prompt, _PERF_PREAMBLE
from marketer.models import Idea


# ---------------------------------------------------------------------------
# build_ideation_prompt (pure function — no LLM needed)
# ---------------------------------------------------------------------------


def test_prompt_without_perf_context():
    """No performance context → plain 'Niche: <title>' prompt."""
    result = build_ideation_prompt("claymation econ")
    assert result == "Niche: claymation econ"


def test_prompt_with_perf_context_includes_preamble():
    perf = "## What's working\n1. \"hook\" — topic: foo, views: 1,000"
    result = build_ideation_prompt("claymation econ", performance_context=perf)

    assert _PERF_PREAMBLE in result
    assert perf in result
    assert "Niche: claymation econ" in result


def test_prompt_with_perf_context_preamble_comes_first():
    """Preamble precedes the context block precedes the niche line."""
    perf = "## What's working\n1. \"test hook\" — topic: test, views: 500"
    result = build_ideation_prompt("test niche", performance_context=perf)

    preamble_pos = result.index(_PERF_PREAMBLE)
    perf_pos = result.index(perf)
    niche_pos = result.index("Niche: test niche")

    assert preamble_pos < perf_pos < niche_pos


def test_empty_performance_context_falls_back_to_base():
    """Explicitly passing an empty string is the same as not passing it."""
    result_default = build_ideation_prompt("my niche")
    result_empty = build_ideation_prompt("my niche", performance_context="")
    assert result_default == result_empty


# ---------------------------------------------------------------------------
# run_ideation (orchestrator) — LLM call is mocked
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_ideation_no_perf_sends_simple_prompt(monkeypatch):
    """Without performance context the prompt is 'Niche: <title>'."""
    captured: list[str] = []

    fake_idea = Idea(
        topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"
    )

    fake_result = MagicMock()
    fake_result.final_output_as = MagicMock(return_value=fake_idea)

    async def fake_run(agent, *, input):  # noqa: A002
        captured.append(input)
        return fake_result

    import marketer.orchestrator as _orch
    from agents import Runner

    monkeypatch.setattr(Runner, "run", fake_run)

    idea = await _orch.run_ideation("claymation econ")

    assert idea == fake_idea
    assert len(captured) == 1
    assert captured[0] == "Niche: claymation econ"


@pytest.mark.asyncio
async def test_run_ideation_with_perf_injects_context_into_prompt(monkeypatch):
    """With performance context the prompt includes preamble + context block."""
    captured: list[str] = []

    fake_idea = Idea(
        topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"
    )

    fake_result = MagicMock()
    fake_result.final_output_as = MagicMock(return_value=fake_idea)

    async def fake_run(agent, *, input):  # noqa: A002
        captured.append(input)
        return fake_result

    import marketer.orchestrator as _orch
    from agents import Runner

    monkeypatch.setattr(Runner, "run", fake_run)

    perf = "## What's working in this niche (top performers, last 30 days)\n1. \"hook\" — topic: foo, views: 1,000"
    idea = await _orch.run_ideation("claymation econ", performance_context=perf)

    assert idea == fake_idea
    assert len(captured) == 1
    prompt = captured[0]

    # Preamble must be present
    assert _PERF_PREAMBLE in prompt
    # Context block must be present
    assert perf in prompt
    # Niche line must still be present
    assert "Niche: claymation econ" in prompt


@pytest.mark.asyncio
async def test_run_ideation_default_kwarg_is_empty(monkeypatch):
    """performance_context defaults to '' — existing callers need no changes."""
    captured: list[str] = []

    fake_idea = Idea(
        topic="t", angle="a", hook="h", target_audience="x", why_it_works="y"
    )

    fake_result = MagicMock()
    fake_result.final_output_as = MagicMock(return_value=fake_idea)

    async def fake_run(agent, *, input):  # noqa: A002
        captured.append(input)
        return fake_result

    import marketer.orchestrator as _orch
    from agents import Runner

    monkeypatch.setattr(Runner, "run", fake_run)

    # Call without the new kwarg — must not raise
    await _orch.run_ideation("my niche")

    assert captured[0] == "Niche: my niche"
