"""Design Agent: brief -> inspectable plan -> iterative canvas.

The three pieces, in the order they run:

- ``planner``    one metered LLM call turns a brief into a plan draft
- ``plan``       the plan model + the validation that bounds the run
- ``operations`` the executable catalog, each op mapped onto an
                 existing image service
- ``executor``   runs the plan's DAG into canvas objects on the volume

Nothing here defines a new image client, agent framework, or creative
brief — those already exist in ``services/openai_images``,
``agents/metered``, and ``models/creative_brief``.
"""
from __future__ import annotations

from .plan import (
    CanvasObject,
    DesignPlan,
    PlanDraft,
    PlanStep,
    PlanValidationError,
    build_plan,
    validate_plan,
)

__all__ = [
    "CanvasObject",
    "DesignPlan",
    "PlanDraft",
    "PlanStep",
    "PlanValidationError",
    "build_plan",
    "validate_plan",
]
