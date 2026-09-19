"""Company OS — workspace / org decisions inspired by opencompany.

https://github.com/useopencompany/opencompany is an AI workspace with
chat, durable tasks, workflows, and a knowledge brain. We do not vendor
that monorepo. We add the decision layer marketer needs to *run as* a
company OS: route work to the right product surface, decide whether a
durable task is ready, and gate knowledge writes.

Jev answers; code owns the org policy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..jev.ask import ask as jev_ask
from ..jev.client import choice, noul, score
from ..jev.policy import gate_choice
from ..jev.primitives import State
from ..services.spend_context import SpendContext

Surface = Literal["studio", "press", "ads", "campaigns", "suite", "human"]
TaskStatus = Literal["ready", "blocked", "needs_context", "done"]


@dataclass(frozen=True)
class CompanyRoute:
    surface: Surface
    task: TaskStatus
    knowledge_write: bool
    confidence: float
    gate: str
    backend: str

    def as_dict(self) -> dict[str, object]:
        return {
            "surface": self.surface,
            "task": self.task,
            "knowledge_write": self.knowledge_write,
            "confidence": self.confidence,
            "gate": self.gate,
            "backend": self.backend,
        }


async def route_workspace(
    state: State,
    *,
    spend: SpendContext | None = None,
) -> CompanyRoute:
    """Route an org request onto a marketer product + durable-task status."""
    result = await jev_ask(
        state,
        {
            "surface": choice(
                "Which company surface should own this work?",
                {
                    "studio": "Short-form video production (Content / Studio)",
                    "press": "Long-form SEO / articles (Press)",
                    "ads": "Paid media (Ads) — money may move",
                    "campaigns": "Cross-product campaign orchestration",
                    "suite": "Account, billing, brand, tokens, admin",
                    "human": "A person must own this; do not automate",
                },
            ),
            "task": choice(
                "What is the durable-task status of this request?",
                {
                    "ready": "Enough context to start a worker now",
                    "blocked": "Waiting on an integration, approval, or budget",
                    "needs_context": "Missing brief / brand / niche facts",
                    "done": "The requested work is already complete",
                },
            ),
            "knowledge_write": noul(
                "This turn produced durable knowledge that should be written "
                "into the company brain (decision, brand rule, learned constraint)."
            ),
            "stakes": score(
                "How high-stakes is getting this routing wrong?",
                ["Cosmetic", "Wasted generation", "Brand risk", "Money / legal"],
            ),
        },
        spend=spend,
    )
    surface_ans = result.choice("surface")
    task_ans = result.choice("task")
    surface: Surface = (
        surface_ans.choice if surface_ans.choice in {
            "studio", "press", "ads", "campaigns", "suite", "human",
        } else "human"  # type: ignore[assignment]
    )
    task: TaskStatus = (
        task_ans.choice if task_ans.choice in {
            "ready", "blocked", "needs_context", "done",
        } else "needs_context"  # type: ignore[assignment]
    )
    stakes = result.score("stakes")
    gate = gate_choice(
        surface_ans,
        floor=0.5,
        act_at=0.85 if stakes.normalized() >= 0.66 else 0.7,
    )
    if gate == "escalate":
        surface = "human"
    return CompanyRoute(
        surface=surface,
        task=task,
        knowledge_write=result.noul("knowledge_write").noul >= 0.6,
        confidence=min(surface_ans.confidence, task_ans.confidence),
        gate=gate,
        backend=result.backend,
    )
