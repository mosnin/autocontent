"""Tests for the per-provider concurrency gate in
`marketer.services.provider_limits`.

Covers:
* the gate caps concurrency — N > limit tasks, peak in-flight <= limit
  (same probe pattern as test_fanout_concurrency.py).
* malformed config (bad JSON overrides, bad field values) falls back to
  sane defaults instead of raising.
* SpendCapExceeded raised while a slot is held still propagates, and a
  sibling task waiting on that same slot is unaffected.
* limit=1 is correctly serialized (no false concurrency > 1).
* limit=0 disables the gate (true no-op, no semaphore allocated).
* saturation()/saturation_snapshot() report sane numbers.
"""
from __future__ import annotations

import asyncio

import pytest

from marketer.repos.spend import SpendCapExceeded
from marketer.services import provider_limits


@pytest.fixture(autouse=True)
def _reset_provider_limits_state():
    """Each test gets a clean slate: no leftover gates/overrides cache
    from a previous test's monkeypatched settings."""
    provider_limits._gates.clear()
    provider_limits._overrides_cache = (None, {})
    yield
    provider_limits._gates.clear()
    provider_limits._overrides_cache = (None, {})


async def test_gate_caps_peak_concurrency(monkeypatch):
    """8 tasks, limit=3: peak in-flight against the gate never exceeds 3."""
    monkeypatch.setattr(provider_limits.settings, "fal_max_concurrency", 3)

    peak = {"concurrent": 0, "max_concurrent": 0}

    async def worker():
        async with provider_limits.slot("fal"):
            peak["concurrent"] += 1
            peak["max_concurrent"] = max(peak["max_concurrent"], peak["concurrent"])
            await asyncio.sleep(0.01)
            peak["concurrent"] -= 1

    await asyncio.gather(*(worker() for _ in range(8)))

    assert peak["max_concurrent"] <= 3
    assert peak["max_concurrent"] > 1  # confirms real concurrency was exercised


async def test_gate_limit_one_serializes_fully(monkeypatch):
    """limit=1 must never allow two callers in-flight simultaneously."""
    monkeypatch.setattr(provider_limits.settings, "elevenlabs_max_concurrency", 1)

    peak = {"concurrent": 0, "max_concurrent": 0}

    async def worker():
        async with provider_limits.slot("elevenlabs"):
            peak["concurrent"] += 1
            peak["max_concurrent"] = max(peak["max_concurrent"], peak["concurrent"])
            await asyncio.sleep(0.005)
            peak["concurrent"] -= 1

    await asyncio.gather(*(worker() for _ in range(6)))

    assert peak["max_concurrent"] == 1


async def test_gate_limit_zero_disables_gate(monkeypatch):
    """limit=0 means "no gate at all" — every task runs fully concurrently
    and no asyncio.Semaphore is even allocated for that provider."""
    monkeypatch.setattr(provider_limits.settings, "openai_tts_max_concurrency", 0)

    barrier_reached = asyncio.Event()
    count = {"in_flight": 0}

    async def worker():
        async with provider_limits.slot("openai_tts"):
            count["in_flight"] += 1
            if count["in_flight"] == 5:
                barrier_reached.set()
            await barrier_reached.wait()

    # All 5 must be able to enter concurrently (no gate blocking) or this
    # hangs/times out — bound it so a regression fails fast instead of
    # hanging the suite.
    await asyncio.wait_for(
        asyncio.gather(*(worker() for _ in range(5))), timeout=2.0,
    )
    assert count["in_flight"] == 5

    gate = provider_limits._gates["openai_tts"][1]
    assert gate._sem is None


def test_bad_json_overrides_fall_back_to_defaults(monkeypatch):
    monkeypatch.setattr(
        provider_limits.settings, "provider_max_concurrency_overrides", "{not json",
    )
    # Falls back to the dedicated field / built-in default rather than raising.
    assert provider_limits.configured_limit("fal") == provider_limits._DEFAULTS["fal"]


def test_non_dict_json_overrides_fall_back_to_defaults(monkeypatch):
    monkeypatch.setattr(
        provider_limits.settings, "provider_max_concurrency_overrides", "[1, 2, 3]",
    )
    assert provider_limits.configured_limit("fal") == provider_limits._DEFAULTS["fal"]


def test_unparseable_override_value_is_dropped(monkeypatch):
    monkeypatch.setattr(
        provider_limits.settings,
        "provider_max_concurrency_overrides",
        '{"fal": "not-a-number", "elevenlabs": 5}',
    )
    # fal's bad value is dropped -> falls back to its default; elevenlabs'
    # good value is honored.
    assert provider_limits.configured_limit("fal") == provider_limits._DEFAULTS["fal"]
    assert provider_limits.configured_limit("elevenlabs") == 5


def test_negative_override_value_is_dropped(monkeypatch):
    monkeypatch.setattr(
        provider_limits.settings, "provider_max_concurrency_overrides", '{"fal": -1}',
    )
    assert provider_limits.configured_limit("fal") == provider_limits._DEFAULTS["fal"]


def test_valid_override_wins_over_dedicated_field(monkeypatch):
    monkeypatch.setattr(provider_limits.settings, "fal_max_concurrency", 16)
    monkeypatch.setattr(
        provider_limits.settings, "provider_max_concurrency_overrides", '{"fal": 2}',
    )
    assert provider_limits.configured_limit("fal") == 2


def test_bad_field_value_type_falls_back_to_default(monkeypatch):
    # Simulates a corrupted/monkeypatched Settings instance where the
    # dedicated field ended up non-int; configured_limit must not raise.
    monkeypatch.setattr(provider_limits.settings, "grok_max_concurrency", "oops")
    assert provider_limits.configured_limit("grok") == provider_limits._DEFAULTS["grok"]


def test_unknown_provider_gets_generous_fallback():
    assert provider_limits.configured_limit("some_new_provider") == (
        provider_limits._FALLBACK_DEFAULT
    )


async def test_spend_cap_exceeded_propagates_through_held_slot(monkeypatch):
    """A SpendCapExceeded raised while holding a slot must propagate
    unchanged (not be swallowed by the gate), and releasing the slot must
    still unblock a sibling task waiting on it."""
    monkeypatch.setattr(provider_limits.settings, "fal_max_concurrency", 1)

    released_for_next = asyncio.Event()

    async def failing_first():
        async with provider_limits.slot("fal"):
            # Hold the only slot briefly, then blow up.
            await asyncio.sleep(0.01)
            raise SpendCapExceeded("cap breached mid-call", scope="niche")

    async def waits_then_succeeds():
        # Give failing_first a head start so it holds the slot first.
        await asyncio.sleep(0.001)
        async with provider_limits.slot("fal"):
            released_for_next.set()

    with pytest.raises(SpendCapExceeded):
        await asyncio.gather(failing_first(), waits_then_succeeds())

    assert released_for_next.is_set()


async def test_saturation_reports_in_use_and_limit(monkeypatch):
    monkeypatch.setattr(provider_limits.settings, "fal_max_concurrency", 4)

    idle = provider_limits.saturation("fal")
    assert idle == {"limit": 4, "in_use": 0, "available": 4}

    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder():
        async with provider_limits.slot("fal"):
            entered.set()
            await release.wait()

    task = asyncio.create_task(holder())
    await entered.wait()
    busy = provider_limits.saturation("fal")
    assert busy["limit"] == 4
    assert busy["in_use"] == 1
    assert busy["available"] == 3

    release.set()
    await task

    idle_again = provider_limits.saturation("fal")
    assert idle_again["in_use"] == 0


def test_saturation_snapshot_includes_only_used_providers(monkeypatch):
    monkeypatch.setattr(provider_limits.settings, "fal_max_concurrency", 4)
    provider_limits.saturation("fal")  # forces gate creation
    snapshot = provider_limits.saturation_snapshot()
    assert "fal" in snapshot
    assert snapshot["fal"]["limit"] == 4
