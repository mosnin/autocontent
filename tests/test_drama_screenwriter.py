"""Screenwriter stage: idea -> screenplay + shot list, and the metering and
shot-count bounds around it.

The Agents SDK is stubbed at `metered.Runner.run` — the same seam
test_agent_metering.py uses — so no network and no tokens.
"""
from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest

from marketer.agents import metered
from marketer.drama import screenwriter
from marketer.drama.schemas import (
    MAX_SHOTS,
    ScreenplayDraft,
    ShotDraft,
)
from marketer.models import Niche, PostingWindow

NICHE_ID = UUID("00000000-0000-0000-0000-0000000000d1")


def _make_niche() -> Niche:
    return Niche(
        id=NICHE_ID,
        user_id="user_drama",
        title="k-drama shorts",
        description="two-minute romance cliffhangers",
        target_audience="binge watchers",
        visual_style="cinematic teal-and-amber, 35mm",
        voice="onyx",
        target_duration_sec=45,
        scene_count=6,
        character_description="",
        posting_windows=[PostingWindow(hour=12, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


def _draft(n_shots: int) -> ScreenplayDraft:
    return ScreenplayDraft(
        title="The Last Bus",
        logline="A courier misses the last bus and finds out why.",
        beats=["setup", "turn", "payoff"],
        shots=[
            ShotDraft(
                index=i,
                slugline=f"EXT. BUS STOP - NIGHT {i}",
                action="rain, a courier checks a phone",
                character_names=["Mei Lin"],
                dialogue="You're late." if i == 0 else "",
                duration_sec=5,
            )
            for i in range(n_shots)
        ],
    )


@pytest.fixture
def fake_runner(monkeypatch):
    """Capture Runner.run calls and return a canned ScreenplayDraft."""
    calls: list[tuple] = []
    holder = {"draft": _draft(6)}

    async def _run(agent, input):
        calls.append((agent, input))
        draft = holder["draft"]
        return SimpleNamespace(
            context_wrapper=SimpleNamespace(
                usage=SimpleNamespace(
                    input_tokens=800, output_tokens=400, total_tokens=1200
                )
            ),
            final_output=draft,
            final_output_as=lambda _t: draft,
        )

    monkeypatch.setattr(metered.Runner, "run", staticmethod(_run))
    return SimpleNamespace(calls=calls, holder=holder)


async def test_write_screenplay_returns_screenplay_and_shots(fake_runner, fake_spend):
    spend, rec = fake_spend
    screenplay, shots = await screenwriter.write_screenplay(
        "a courier misses the last bus",
        niche=_make_niche(),
        shot_count=6,
        aspect="9:16",
        spend=spend,
    )
    assert screenplay.title == "The Last Bus"
    assert screenplay.source == "idea"
    assert screenplay.beats == ["setup", "turn", "payoff"]
    assert [s.index for s in shots] == [0, 1, 2, 3, 4, 5]
    assert shots[0].dialogue == "You're late."
    assert shots[0].character_ids == ["mei-lin"]

    # The idea and the drama's shape must actually reach the model.
    payload = json.loads(fake_runner.calls[0][1])
    assert payload["idea"] == "a courier misses the last bus"
    assert payload["shot_count"] == 6
    assert payload["visual_style"] == "cinematic teal-and-amber, 35mm"

    # Metering is mandatory: one ledger row for the one LLM call.
    assert len(rec.entries) == 1
    assert rec.entries[0].provider == "openai"
    assert "drama_screenwriter" in rec.entries[0].sku
    assert rec.entries[0].cost_usd > 0


async def test_write_screenplay_truncates_an_overlong_shot_list(
    fake_runner, fake_spend
):
    """A model that ignores shot_count must not double the drama's spend."""
    spend, _ = fake_spend
    fake_runner.holder["draft"] = _draft(40)
    _, shots = await screenwriter.write_screenplay(
        "idea", niche=_make_niche(), shot_count=4, aspect="9:16", spend=spend
    )
    assert len(shots) == 4


async def test_write_screenplay_clamps_requested_shot_count(fake_runner, fake_spend):
    spend, _ = fake_spend
    fake_runner.holder["draft"] = _draft(40)
    _, shots = await screenwriter.write_screenplay(
        "idea", niche=_make_niche(), shot_count=500, aspect="9:16", spend=spend
    )
    assert len(shots) == MAX_SHOTS


async def test_tripped_cap_blocks_before_the_model_is_called(fake_runner, fake_spend):
    from marketer.repos.spend import SpendCapExceeded

    spend, rec = fake_spend
    spend.abort_event.set()  # a sibling stage already tripped the cap
    with pytest.raises(SpendCapExceeded):
        await screenwriter.write_screenplay(
            "idea", niche=_make_niche(), shot_count=6, aspect="9:16", spend=spend
        )
    assert fake_runner.calls == []
    assert rec.entries == []


def test_supplied_script_skips_the_screenwriter_entirely(fake_runner):
    """The script path is free: no agent call, no ledger row. The shot list is
    left empty on purpose — the storyboard stage fans the script out."""
    screenplay, shots = screenwriter.screenplay_from_script(
        "  INT. NOODLE SHOP - NIGHT\nMei slides the bowl across the counter.  "
    )
    assert screenplay.source == "script"
    assert screenplay.title == "INT. NOODLE SHOP - NIGHT"
    assert screenplay.script_text.startswith("INT. NOODLE SHOP")
    assert shots == []
    assert fake_runner.calls == []
    assert screenplay.as_prompt_text().startswith("INT. NOODLE SHOP")
