"""Design plan model + validation.

The load-bearing test here is `TestRejectedBeforeSpend`: an over-long
plan, an unknown operation, and a cyclic dependency must ALL be refused
by validation, i.e. before the executor can make a single paid call.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from marketer.design.operations import MAX_STEP_INPUTS, OPERATIONS
from marketer.design.plan import (
    HARD_MAX_STEPS,
    MAX_TOTAL_EDGES,
    DesignPlan,
    DraftStep,
    PlanDraft,
    PlanStep,
    PlanValidationError,
    StepInputs,
    build_plan,
    downstream_of,
    estimated_cost_usd,
    remaining_cost_usd,
    reset_from,
    topological_layers,
    validate_plan,
)


def _step(
    sid: str,
    op: str = "generate",
    deps: list[str] | None = None,
    *,
    index: int = 0,
    text: str = "",
    quality: str = "medium",
    status: str = "pending",
    output_path: str = "",
) -> PlanStep:
    return PlanStep(
        index=index,
        id=sid,
        operation=op,
        label=sid,
        inputs=StepInputs(prompt=f"prompt for {sid}", text=text, quality=quality),
        depends_on=deps or [],
        status=status,
        output_path=output_path,
    )


def _plan(*steps: PlanStep, fmt: str = "1:1") -> DesignPlan:
    return DesignPlan(title="t", format=fmt, steps=list(steps))


def _draft(*steps: DraftStep, title: str = "Kit") -> PlanDraft:
    return PlanDraft(title=title, steps=list(steps))


# --------------------------------------------------------------- happy path


def test_valid_linear_plan_passes():
    plan = _plan(
        _step("base"),
        _step("refine", "edit", ["base"], index=1),
        _step("titled", "text_overlay", ["refine"], index=2, text="LAUNCH"),
    )
    validate_plan(plan, max_steps=8)


def test_build_plan_reindexes_topologically():
    # Model emits the steps out of order; the plan must still read 0,1,2.
    draft = _draft(
        DraftStep(id="final", operation="edit", prompt="p", depends_on=["base"]),
        DraftStep(id="base", operation="generate", prompt="p"),
    )
    plan = build_plan(draft, fmt="9:16", max_steps=8)
    assert [s.id for s in plan.steps] == ["base", "final"]
    assert [s.index for s in plan.steps] == [0, 1]
    assert plan.size == "1024x1536"


def test_build_plan_normalizes_ids_and_quality():
    draft = _draft(
        DraftStep(id="  BASE ", operation=" GENERATE ", prompt="p", quality="ultra"),
    )
    plan = build_plan(draft, max_steps=4)
    assert plan.steps[0].id == "base"
    assert plan.steps[0].operation == "generate"
    # An unpriceable quality is coerced down, never up.
    assert plan.steps[0].inputs.quality == "medium"


def test_topological_layers_group_independent_steps():
    plan = _plan(
        _step("a"),
        _step("b", index=1),
        _step("c", "compose", ["a", "b"], index=2),
    )
    layers = topological_layers(plan)
    assert [sorted(s.id for s in layer) for layer in layers] == [["a", "b"], ["c"]]


# ------------------------------------------------- rejected BEFORE any spend


class TestRejectedBeforeSpend:
    """Every one of these is an unusable plan an LLM can plausibly emit.

    Each must raise at validation time — the executor never runs, so no
    provider call is made and nothing is billed.
    """

    def test_over_long_plan_is_rejected(self):
        steps = [_step(f"s{i}", index=i) for i in range(HARD_MAX_STEPS + 4)]
        with pytest.raises(PlanValidationError, match="steps; the limit is"):
            validate_plan(_plan(*steps), max_steps=HARD_MAX_STEPS)

    def test_caller_max_steps_cannot_exceed_hard_cap(self):
        steps = [_step(f"s{i}", index=i) for i in range(HARD_MAX_STEPS + 1)]
        # Even a caller asking for 200 steps is clamped to the hard ceiling.
        with pytest.raises(PlanValidationError, match=f"limit is {HARD_MAX_STEPS}"):
            validate_plan(_plan(*steps), max_steps=200)

    def test_over_long_draft_is_rejected_by_build_plan(self):
        draft = _draft(
            *[
                DraftStep(id=f"s{i}", operation="generate", prompt="p")
                for i in range(200)
            ]
        )
        with pytest.raises(PlanValidationError, match="limit is"):
            build_plan(draft, max_steps=8)

    def test_unknown_operation_is_rejected(self):
        plan = _plan(_step("a", "hallucinate_video"))
        with pytest.raises(PlanValidationError, match="unknown operation"):
            validate_plan(plan)

    def test_unknown_operation_in_draft_is_rejected(self):
        draft = _draft(DraftStep(id="a", operation="midjourney", prompt="p"))
        with pytest.raises(PlanValidationError, match="unknown operation"):
            build_plan(draft, max_steps=8)

    def test_cyclic_dependency_is_rejected(self):
        plan = _plan(
            _step("a", "edit", ["b"]),
            _step("b", "edit", ["a"], index=1),
        )
        with pytest.raises(PlanValidationError, match="cycle"):
            validate_plan(plan)

    def test_three_node_cycle_is_rejected(self):
        plan = _plan(
            _step("a", "edit", ["c"]),
            _step("b", "edit", ["a"], index=1),
            _step("c", "edit", ["b"], index=2),
        )
        with pytest.raises(PlanValidationError, match="cycle"):
            validate_plan(plan)

    def test_self_dependency_is_rejected(self):
        with pytest.raises(PlanValidationError, match="depends on itself"):
            validate_plan(_plan(_step("a", "edit", ["a"])))

    def test_unresolvable_dependency_is_rejected(self):
        with pytest.raises(PlanValidationError, match="unknown step"):
            validate_plan(_plan(_step("a", "edit", ["ghost"])))

    def test_empty_plan_is_rejected(self):
        with pytest.raises(PlanValidationError, match="no steps"):
            validate_plan(_plan())

    def test_duplicate_ids_are_rejected(self):
        with pytest.raises(PlanValidationError, match="duplicate step id"):
            validate_plan(_plan(_step("a"), _step("a", index=1)))

    def test_bad_id_shape_is_rejected(self):
        with pytest.raises(PlanValidationError, match="invalid step id"):
            validate_plan(_plan(_step("../../etc/passwd")))

    def test_generate_with_dependencies_is_rejected(self):
        plan = _plan(_step("a"), _step("b", "generate", ["a"], index=1))
        with pytest.raises(PlanValidationError, match="needs 0-0 dependencies"):
            validate_plan(plan)

    def test_compose_with_one_input_is_rejected(self):
        plan = _plan(_step("a"), _step("b", "compose", ["a"], index=1))
        with pytest.raises(PlanValidationError, match="needs 2-"):
            validate_plan(plan)

    def test_step_fanout_is_bounded(self):
        bases = [_step(f"b{i}", index=i) for i in range(MAX_STEP_INPUTS + 2)]
        plan = _plan(
            *bases,
            _step("c", "compose", [b.id for b in bases], index=99),
        )
        with pytest.raises(PlanValidationError, match="per-step limit"):
            validate_plan(plan, max_steps=HARD_MAX_STEPS)

    def test_total_edges_are_bounded(self):
        # 4 bases + 12 composes over all of them = 48 edges > MAX_TOTAL_EDGES.
        bases = [_step(f"b{i}", index=i) for i in range(4)]
        composes = [
            _step(f"c{i}", "compose", [b.id for b in bases], index=10 + i)
            for i in range(12)
        ]
        with pytest.raises(PlanValidationError, match="dependency edges"):
            validate_plan(_plan(*bases, *composes), max_steps=HARD_MAX_STEPS)
        assert MAX_TOTAL_EDGES < 48

    def test_text_overlay_without_copy_is_rejected(self):
        plan = _plan(_step("a"), _step("b", "text_overlay", ["a"], index=1))
        with pytest.raises(PlanValidationError, match="requires inputs.text"):
            validate_plan(plan)

    def test_empty_prompt_is_rejected(self):
        step = _step("a")
        step.inputs.prompt = "   "
        with pytest.raises(PlanValidationError, match="empty prompt"):
            validate_plan(_plan(step))

    def test_unknown_format_is_rejected(self):
        with pytest.raises(PlanValidationError):
            build_plan(
                _draft(DraftStep(id="a", operation="generate", prompt="p")),
                fmt="21:9",  # type: ignore[arg-type]
            )


# ------------------------------------------------------------ graph surgery


def test_downstream_of_is_transitive():
    plan = _plan(
        _step("a"),
        _step("b", "edit", ["a"], index=1),
        _step("c", "edit", ["b"], index=2),
        _step("d", index=3),
    )
    assert downstream_of(plan, "a") == {"b", "c"}
    assert downstream_of(plan, "c") == set()
    assert downstream_of(plan, "d") == set()


def test_reset_from_keeps_unrelated_outputs():
    plan = _plan(
        _step("a", status="done", output_path="/v/a.png"),
        _step("b", "edit", ["a"], index=1, status="done", output_path="/v/b.png"),
        _step("c", index=2, status="done", output_path="/v/c.png"),
    )
    reset = reset_from(plan, "b")
    by_id = reset.by_id()
    assert by_id["a"].output_path == "/v/a.png"      # upstream untouched
    assert by_id["c"].output_path == "/v/c.png"      # unrelated branch untouched
    assert by_id["b"].status == "pending"
    assert by_id["b"].output_path == ""


def test_reset_from_clears_downstream_too():
    plan = _plan(
        _step("a", status="done", output_path="/v/a.png"),
        _step("b", "edit", ["a"], index=1, status="done", output_path="/v/b.png"),
    )
    by_id = reset_from(plan, "a").by_id()
    assert by_id["a"].status == "pending"
    assert by_id["b"].status == "pending"
    assert by_id["b"].output_path == ""


# ------------------------------------------------------------------- pricing


def test_estimated_cost_prices_upscale_at_the_high_tier():
    plan = _plan(_step("a"), _step("b", "upscale", ["a"], index=1, quality="low"))
    # upscale pins quality=high regardless of what the planner asked for,
    # so the estimate can't under-count the most expensive step.
    assert estimated_cost_usd(plan) == Decimal("0.042") + Decimal("0.167")


def test_remaining_cost_excludes_completed_steps():
    plan = _plan(
        _step("a", status="done", output_path="/v/a.png"),
        _step("b", "edit", ["a"], index=1),
    )
    assert remaining_cost_usd(plan) == Decimal("0.042")
    assert estimated_cost_usd(plan) == Decimal("0.084")


def test_every_catalog_operation_is_reachable_from_validation():
    # A guard against the catalog and the validator drifting apart.
    assert set(OPERATIONS) == {
        "generate", "edit", "compose", "upscale", "text_overlay",
    }
