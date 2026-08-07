"""Design planner: brief -> validated plan, through the metered Agents SDK.

The Agents SDK call itself is stubbed at ``agents.metered.run_metered``
(the codebase's single LLM choke point), so these tests assert the
contract around it: that planning is metered, that the payload carries
the niche's existing CreativeBrief constraints, and that whatever the
model returns is validated before it can become an executable plan.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

import pytest

from marketer.design import planner
from marketer.design.plan import DraftStep, PlanDraft, PlanValidationError
from marketer.models import Niche, PostingWindow

NICHE_ID = UUID("00000000-0000-0000-0000-0000000000d5")


def _niche(**over) -> Niche:
    base = dict(
        id=NICHE_ID, user_id="user_design", title="specialty coffee",
        description="third wave roasters", target_audience="cafe owners",
        visual_style="earthy monochrome", voice="onyx",
        target_duration_sec=30, scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["reels"], daily_spend_cap_usd=Decimal("5"),
    )
    base.update(over)
    return Niche(**base)


class _FakeResult:
    def __init__(self, draft: PlanDraft):
        self._draft = draft

    def final_output_as(self, _type):
        return self._draft


@pytest.fixture
def capture(monkeypatch):
    """Stub run_metered; record the agent, prompt, and spend context."""
    calls: list[dict] = []
    box: dict = {"draft": None}

    async def fake_run_metered(agent, prompt, *, spend=None, **kw):
        calls.append({"agent": agent, "prompt": prompt, "spend": spend, "kw": kw})
        return _FakeResult(box["draft"])

    import marketer.agents.metered as metered

    monkeypatch.setattr(metered, "run_metered", fake_run_metered)
    return calls, box


def _good_draft() -> PlanDraft:
    return PlanDraft(
        title="Pinecone launch kit",
        notes=["final deliverable is 'poster'"],
        steps=[
            DraftStep(id="plate", operation="generate", prompt="earthy backdrop"),
            DraftStep(
                id="hero", operation="edit", prompt="place the bag",
                depends_on=["plate"],
            ),
            DraftStep(
                id="poster", operation="text_overlay", prompt="headline bottom-left",
                text="PINECONE", depends_on=["hero"],
            ),
        ],
    )


async def test_plan_design_returns_a_validated_plan(capture, fake_spend):
    calls, box = capture
    box["draft"] = _good_draft()
    spend, _rec = fake_spend

    plan = await planner.plan_design(
        "launch kit for a sustainable coffee brand",
        fmt="9:16",
        max_steps=6,
        niche=_niche(),
        spend=spend,
    )

    assert [s.id for s in plan.steps] == ["plate", "hero", "poster"]
    assert plan.format == "9:16"
    assert plan.size == "1024x1536"
    assert plan.steps[2].inputs.text == "PINECONE"
    assert all(s.status == "pending" for s in plan.steps)
    # Runtime fields are never author-able by the model.
    assert all(s.output_path == "" for s in plan.steps)
    assert len(calls) == 1


async def test_planning_is_metered_through_the_spend_context(capture, fake_spend):
    """The planning LLM call must ride the same SpendContext as renders."""
    calls, box = capture
    box["draft"] = _good_draft()
    spend, _rec = fake_spend

    await planner.plan_design("brief", niche=_niche(), spend=spend)
    assert calls[0]["spend"] is spend


async def test_payload_carries_catalog_niche_and_brief_lines(capture, fake_spend):
    calls, box = capture
    box["draft"] = _good_draft()
    spend, _rec = fake_spend

    niche = _niche()
    niche.creative_brief.visual.color_palette = "warm terracotta + cream, no neon"
    niche.creative_brief.visual.negative_visuals = ["stock-photo hands"]

    await planner.plan_design("brief text", niche=niche, max_steps=5, spend=spend)
    payload = json.loads(calls[0]["prompt"])

    assert payload["brief"] == "brief text"
    assert payload["max_steps"] == 5
    assert payload["niche"].startswith("specialty coffee")
    assert payload["visual_style"] == "earthy monochrome"
    # Reuses the EXISTING per-niche CreativeBrief rather than a second model.
    joined = " ".join(payload["brief_lines"])
    assert "warm terracotta" in joined
    assert "stock-photo hands" in joined
    # Operations are described to the model from the same catalog the
    # validator enforces.
    ops = " ".join(payload["operations"])
    for name in ("generate", "edit", "compose", "upscale", "text_overlay"):
        assert name in ops


async def test_max_steps_is_clamped_before_the_model_sees_it(capture, fake_spend):
    calls, box = capture
    box["draft"] = _good_draft()
    spend, _rec = fake_spend

    await planner.plan_design("brief", max_steps=200, niche=_niche(), spend=spend)
    assert json.loads(calls[0]["prompt"])["max_steps"] == planner.HARD_MAX_STEPS


async def test_over_long_model_plan_is_rejected_after_the_call(capture, fake_spend):
    """The prompt asks for a bounded plan; the validator guarantees one."""
    calls, box = capture
    box["draft"] = PlanDraft(
        title="runaway",
        steps=[
            DraftStep(id=f"s{i}", operation="generate", prompt="p")
            for i in range(200)
        ],
    )
    spend, _rec = fake_spend

    with pytest.raises(PlanValidationError, match="limit is"):
        await planner.plan_design("brief", max_steps=8, niche=_niche(), spend=spend)
    # One LLM call was made and metered; ZERO image calls followed.
    assert len(calls) == 1


async def test_hallucinated_operation_is_rejected(capture, fake_spend):
    _calls, box = capture
    box["draft"] = PlanDraft(
        steps=[DraftStep(id="a", operation="run_midjourney", prompt="p")]
    )
    spend, _rec = fake_spend
    with pytest.raises(PlanValidationError, match="unknown operation"):
        await planner.plan_design("brief", niche=_niche(), spend=spend)


async def test_cyclic_model_plan_is_rejected(capture, fake_spend):
    _calls, box = capture
    box["draft"] = PlanDraft(
        steps=[
            DraftStep(id="a", operation="edit", prompt="p", depends_on=["b"]),
            DraftStep(id="b", operation="edit", prompt="p", depends_on=["a"]),
        ]
    )
    spend, _rec = fake_spend
    with pytest.raises(PlanValidationError, match="cycle"):
        await planner.plan_design("brief", niche=_niche(), spend=spend)


def test_agent_is_built_with_the_draft_output_type():
    agent = planner.build_design_planner_agent()
    assert agent.output_type is PlanDraft
    assert "DAG" in planner.DESIGN_PLANNER_INSTRUCTIONS
