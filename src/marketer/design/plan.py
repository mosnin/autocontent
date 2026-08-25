"""The Design Agent's plan model: an inspectable DAG of canvas operations.

The whole point of the Design Agent over a one-shot generation is that
the deliverable is *planned first*: the brief becomes N concrete steps,
each a named operation with explicit inputs and explicit dependencies on
earlier steps, and that graph is rendered to the user before (and while)
it executes.

Two models live here on purpose:

- ``PlanDraft`` / ``DraftStep`` — what the LLM is allowed to author.
  It carries no status, no output path, no cost. An LLM-authored plan is
  untrusted input; giving the model a type that cannot express "this step
  already succeeded" removes a whole class of forgery.
- ``DesignPlan`` / ``PlanStep`` — the validated, executable plan the
  executor and the API serve, with runtime state attached.

``build_plan`` is the only bridge between them, and it validates. Why
validate before executing a single step: every step is a paid image
call, so a 200-step plan, an operation that doesn't exist, or a
dependency cycle must be rejected at *parse* time. Discovering any of
those at spend time means the user has already been billed for the steps
that ran before the bad one.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from .operations import MAX_STEP_INPUTS, OPERATIONS, QUALITIES, step_cost_usd

# Aspect ratios the product offers, mapped to the only gpt-image-1 sizes
# that are actually priced in openai_pricing. Anything else would raise
# deep inside the cost table, after planning was already paid for.
FORMAT_SIZES: dict[str, str] = {
    "1:1": "1024x1024",
    "9:16": "1024x1536",
    "16:9": "1536x1024",
}
DesignFormat = Literal["1:1", "9:16", "16:9"]

# Absolute ceiling on plan length, independent of what the caller asked
# for. `max_steps` is a per-request knob; this is the product's promise
# that no single design project can become an unbounded image bill.
HARD_MAX_STEPS = 16
# Total dependency edges. Step count alone doesn't bound the work: 16
# steps each composing 4 inputs is 64 references shipped to the provider.
MAX_TOTAL_EDGES = 32

_STEP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")

StepStatus = Literal["pending", "running", "done", "failed", "skipped"]


class PlanValidationError(ValueError):
    """A plan is not executable. Raised before any spend."""


# ------------------------------------------------------------------ LLM draft


class DraftStep(BaseModel):
    """One step as authored by the planning LLM."""

    model_config = {"extra": "forbid"}

    id: str = Field(
        description="Short lowercase slug unique within the plan, e.g. 'hero_plate'"
    )
    operation: str = Field(description="One of the operation names given in the prompt")
    label: str = Field(default="", description="Human-readable one-liner for the plan view")
    prompt: str = Field(default="", description="The image prompt for this operation")
    text: str = Field(
        default="", description="Literal copy to render; only for text_overlay"
    )
    quality: str = Field(default="medium", description="low | medium | high")
    depends_on: list[str] = Field(
        default_factory=list,
        description="ids of earlier steps whose output this step consumes",
    )


class PlanDraft(BaseModel):
    """The planning agent's structured output."""

    model_config = {"extra": "forbid"}

    title: str = Field(default="", description="Short name for the deliverable")
    notes: list[str] = Field(
        default_factory=list, description="Art-direction notes shown next to the plan"
    )
    steps: list[DraftStep] = Field(default_factory=list)


# ------------------------------------------------------------ executable plan


class StepInputs(BaseModel):
    """The typed, bounded input payload of a step.

    Served to the UI as the step's ``inputs`` object. Lengths are capped
    because these strings are LLM-authored and ride into a provider
    request on every retry.
    """

    model_config = {"extra": "forbid"}

    prompt: str = Field(default="", max_length=4000)
    text: str = Field(default="", max_length=300)
    quality: Literal["low", "medium", "high"] = "medium"


class PlanStep(BaseModel):
    model_config = {"extra": "forbid"}

    index: int
    id: str
    operation: str
    label: str = ""
    inputs: StepInputs = Field(default_factory=StepInputs)
    depends_on: list[str] = Field(default_factory=list)
    status: StepStatus = "pending"
    error: str = ""
    # Content-addressed path on the Modal volume; empty until the step runs.
    output_path: str = ""
    output_digest: str = ""

    def is_complete(self) -> bool:
        return self.status == "done" and bool(self.output_path)


class CanvasObject(BaseModel):
    """One produced image on the canvas, keyed back to the step that made it."""

    model_config = {"extra": "forbid"}

    step_id: str
    index: int
    operation: str
    label: str = ""
    path: str
    digest: str
    size: str
    bytes: int = 0


class DesignPlan(BaseModel):
    model_config = {"extra": "forbid"}

    title: str = ""
    format: DesignFormat = "1:1"
    notes: list[str] = Field(default_factory=list)
    steps: list[PlanStep] = Field(default_factory=list)

    @property
    def size(self) -> str:
        return FORMAT_SIZES[self.format]

    def by_id(self) -> dict[str, PlanStep]:
        return {s.id: s for s in self.steps}


# -------------------------------------------------------------- graph helpers


def topological_layers(plan: DesignPlan) -> list[list[PlanStep]]:
    """Group steps into dependency layers (Kahn, level by level).

    Layer 0 has no dependencies; every step in layer N depends only on
    layers < N. The executor runs a layer concurrently; the plan
    visualizer draws each layer as a column. Assumes a validated plan —
    a cycle would truncate the output rather than loop forever.
    """
    remaining = list(plan.steps)
    settled: set[str] = set()
    layers: list[list[PlanStep]] = []
    while remaining:
        layer = [s for s in remaining if all(d in settled for d in s.depends_on)]
        if not layer:  # cycle — validate_plan rejects these first
            break
        layers.append(layer)
        settled.update(s.id for s in layer)
        remaining = [s for s in remaining if s.id not in settled]
    return layers


def downstream_of(plan: DesignPlan, step_id: str) -> set[str]:
    """Every step transitively depending on *step_id* (excluding itself)."""
    dependents: dict[str, list[str]] = {s.id: [] for s in plan.steps}
    for s in plan.steps:
        for dep in s.depends_on:
            if dep in dependents:
                dependents[dep].append(s.id)

    out: set[str] = set()
    stack = list(dependents.get(step_id, []))
    while stack:
        node = stack.pop()
        if node in out:
            continue
        out.add(node)
        stack.extend(dependents.get(node, []))
    return out


def reset_from(plan: DesignPlan, step_id: str) -> DesignPlan:
    """Return a copy with *step_id* and everything downstream back to pending.

    Steps that are neither the target nor downstream of it keep their
    outputs — a single-step retry must not re-buy the rest of the canvas.
    """
    targets = {step_id} | downstream_of(plan, step_id)
    steps = [
        s.model_copy(update={"status": "pending", "error": "", "output_path": "",
                             "output_digest": ""})
        if s.id in targets
        else s
        for s in plan.steps
    ]
    return plan.model_copy(update={"steps": steps})


def estimated_cost_usd(plan: DesignPlan) -> Decimal:
    """Upper-bound USD for executing the whole plan from scratch."""
    size = plan.size
    return sum(
        (
            step_cost_usd(s.operation, quality=s.inputs.quality, size=size)
            for s in plan.steps
        ),
        Decimal(0),
    )


def remaining_cost_usd(plan: DesignPlan) -> Decimal:
    """USD still owed for the steps that have not completed (resume-aware)."""
    size = plan.size
    return sum(
        (
            step_cost_usd(s.operation, quality=s.inputs.quality, size=size)
            for s in plan.steps
            if not s.is_complete()
        ),
        Decimal(0),
    )


# ---------------------------------------------------------------- validation


def validate_plan(plan: DesignPlan, *, max_steps: int = HARD_MAX_STEPS) -> None:
    """Raise ``PlanValidationError`` unless *plan* is safely executable.

    This runs BEFORE the executor touches a provider. Each check maps to
    a way an LLM-authored plan could cost money or hang:

    - step count / edge count -> unbounded image spend
    - unknown operation       -> KeyError halfway through a paid run
    - arity mismatch          -> a compose with one input, an edit with none
    - unresolvable dependency -> a step that can never become runnable
    - cycle                   -> a run that never terminates
    """
    limit = min(max_steps, HARD_MAX_STEPS)
    if limit < 1:
        raise PlanValidationError("max_steps must be at least 1")
    if not plan.steps:
        raise PlanValidationError("plan has no steps")
    if len(plan.steps) > limit:
        raise PlanValidationError(
            f"plan has {len(plan.steps)} steps; the limit is {limit}"
        )
    if plan.format not in FORMAT_SIZES:
        raise PlanValidationError(f"unknown format {plan.format!r}")

    seen: set[str] = set()
    total_edges = 0
    for step in plan.steps:
        if not _STEP_ID_RE.match(step.id):
            raise PlanValidationError(f"invalid step id {step.id!r}")
        if step.id in seen:
            raise PlanValidationError(f"duplicate step id {step.id!r}")
        seen.add(step.id)

        op = OPERATIONS.get(step.operation)
        if op is None:
            raise PlanValidationError(
                f"step {step.id!r} uses unknown operation {step.operation!r}; "
                f"known: {', '.join(sorted(OPERATIONS))}"
            )
        if step.inputs.quality not in QUALITIES:
            raise PlanValidationError(
                f"step {step.id!r} has unknown quality {step.inputs.quality!r}"
            )
        if len(step.depends_on) > MAX_STEP_INPUTS:
            raise PlanValidationError(
                f"step {step.id!r} depends on {len(step.depends_on)} steps; "
                f"the per-step limit is {MAX_STEP_INPUTS}"
            )
        if not (op.min_inputs <= len(step.depends_on) <= op.max_inputs):
            raise PlanValidationError(
                f"step {step.id!r} ({op.name}) needs {op.min_inputs}-"
                f"{op.max_inputs} dependencies, got {len(step.depends_on)}"
            )
        if op.requires_text and not step.inputs.text.strip():
            raise PlanValidationError(
                f"step {step.id!r} ({op.name}) requires inputs.text"
            )
        if not step.inputs.prompt.strip():
            raise PlanValidationError(f"step {step.id!r} has an empty prompt")
        if len(set(step.depends_on)) != len(step.depends_on):
            raise PlanValidationError(f"step {step.id!r} lists a dependency twice")
        if step.id in step.depends_on:
            raise PlanValidationError(f"step {step.id!r} depends on itself")
        total_edges += len(step.depends_on)

    if total_edges > MAX_TOTAL_EDGES:
        raise PlanValidationError(
            f"plan has {total_edges} dependency edges; the limit is {MAX_TOTAL_EDGES}"
        )

    for step in plan.steps:
        for dep in step.depends_on:
            if dep not in seen:
                raise PlanValidationError(
                    f"step {step.id!r} depends on unknown step {dep!r}"
                )

    # Kahn: if any step never becomes settleable the graph has a cycle.
    if sum(len(layer) for layer in topological_layers(plan)) != len(plan.steps):
        raise PlanValidationError("plan dependency graph contains a cycle")


def build_plan(
    draft: PlanDraft,
    *,
    fmt: DesignFormat = "1:1",
    max_steps: int = HARD_MAX_STEPS,
) -> DesignPlan:
    """Turn an LLM ``PlanDraft`` into a validated, executable ``DesignPlan``.

    Steps are re-indexed 0..n-1 in topological order so the plan reads
    top-to-bottom in the UI regardless of the order the model emitted
    them — and so a duplicate/garbage index from the model can never
    collide two steps.
    """
    if fmt not in FORMAT_SIZES:
        raise PlanValidationError(f"unknown format {fmt!r}")

    steps = [
        PlanStep(
            index=i,
            id=(d.id or "").strip().lower(),
            operation=(d.operation or "").strip().lower(),
            label=d.label.strip()[:200],
            inputs=StepInputs(
                prompt=d.prompt.strip()[:4000],
                text=d.text.strip()[:300],
                # An out-of-range quality from the model is coerced rather
                # than rejected: it never means "spend more", and the
                # validator still refuses anything it can't price.
                quality=d.quality.strip().lower()
                if d.quality.strip().lower() in QUALITIES
                else "medium",
            ),
            depends_on=[dep.strip().lower() for dep in d.depends_on],
        )
        for i, d in enumerate(draft.steps)
    ]
    plan = DesignPlan(
        title=(draft.title or "Design").strip()[:200],
        format=fmt,
        notes=[n.strip()[:300] for n in draft.notes[:10]],
        steps=steps,
    )
    validate_plan(plan, max_steps=max_steps)

    ordered = [s for layer in topological_layers(plan) for s in layer]
    plan.steps = [s.model_copy(update={"index": i}) for i, s in enumerate(ordered)]
    return plan
