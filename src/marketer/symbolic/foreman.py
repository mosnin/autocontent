"""Foreman — semantic supervision over generative workers.

Port of thruwire/foreman's architecture into marketer:

    GENERATIVE LOOP (Qwen / pipeline)     FOREMAN LOOP (Jev)
    ideate / write / render                 watch
         │                                    │
         ▼                                    ▼
    observe ── factory evidence ──────────► assess
         │                                    │
         ▼                                    ▼
    continue ◄──── intervene ───────────── decide

Foreman does not pick tools or write copy. It watches evidence from a
job/article/ads run and returns a Python policy decision: continue,
steer, verify, retry, stop, or finish.

See https://github.com/thruwire/foreman
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..jev.ask import ask as jev_ask
from ..jev.client import noul
from ..jev.primitives import State
from ..services.spend_context import SpendContext

ForemanAct = Literal[
    "continue",
    "steer",
    "verify",
    "retry",
    "stop",
    "finish",
]


@dataclass(frozen=True)
class ForemanDecision:
    action: ForemanAct
    implementation_complete: float
    tests_sufficient: float
    requirements_satisfied: float
    worker_stuck: float
    needs_verification: float
    work_off_track: float
    meaningful_progress: float
    ready_to_finish: float
    backend: str

    def as_dict(self) -> dict[str, object]:
        return {
            "action": self.action,
            "implementation_complete": self.implementation_complete,
            "tests_sufficient": self.tests_sufficient,
            "requirements_satisfied": self.requirements_satisfied,
            "worker_stuck": self.worker_stuck,
            "needs_verification": self.needs_verification,
            "work_off_track": self.work_off_track,
            "meaningful_progress": self.meaningful_progress,
            "ready_to_finish": self.ready_to_finish,
            "backend": self.backend,
        }


def _policy(d: ForemanDecision) -> ForemanAct:
    """Python policy — Foreman decides; code encodes risk tolerance."""
    if d.worker_stuck >= 0.7 or d.work_off_track >= 0.7:
        return "stop" if d.meaningful_progress < 0.4 else "steer"
    if d.ready_to_finish >= 0.75 and d.requirements_satisfied >= 0.7:
        if d.needs_verification >= 0.6 or d.tests_sufficient < 0.5:
            return "verify"
        return "finish"
    if d.implementation_complete >= 0.8 and d.tests_sufficient < 0.45:
        return "verify"
    if d.meaningful_progress < 0.35 and d.implementation_complete < 0.4:
        return "retry"
    if d.needs_verification >= 0.75:
        return "verify"
    if d.work_off_track >= 0.55:
        return "steer"
    return "continue"


async def assess(
    evidence: State,
    *,
    spend: SpendContext | None = None,
) -> ForemanDecision:
    """One speculative fan-out over Foreman's factory nouls."""
    result = await jev_ask(
        evidence,
        {
            "implementation_complete": noul(
                "The worker has implemented the requested work."
            ),
            "tests_sufficient": noul(
                "Verification (QA, tests, render probe) is sufficient for the claim."
            ),
            "requirements_satisfied": noul(
                "The original brief / ticket / niche constraints are satisfied."
            ),
            "worker_stuck": noul(
                "The worker is stuck, looping, or making no meaningful progress."
            ),
            "needs_verification": noul(
                "A separate verification pass is needed before shipping."
            ),
            "work_off_track": noul(
                "The work has drifted off the brief or is solving the wrong problem."
            ),
            "meaningful_progress": noul(
                "The latest step made meaningful progress toward the goal."
            ),
            "ready_to_finish": noul(
                "It is appropriate to mark this job finished and stop the loop."
            ),
        },
        spend=spend,
    )
    snapshot = ForemanDecision(
        action="continue",
        implementation_complete=result.noul("implementation_complete").noul,
        tests_sufficient=result.noul("tests_sufficient").noul,
        requirements_satisfied=result.noul("requirements_satisfied").noul,
        worker_stuck=result.noul("worker_stuck").noul,
        needs_verification=result.noul("needs_verification").noul,
        work_off_track=result.noul("work_off_track").noul,
        meaningful_progress=result.noul("meaningful_progress").noul,
        ready_to_finish=result.noul("ready_to_finish").noul,
        backend=result.backend,
    )
    return ForemanDecision(
        action=_policy(snapshot),
        implementation_complete=snapshot.implementation_complete,
        tests_sufficient=snapshot.tests_sufficient,
        requirements_satisfied=snapshot.requirements_satisfied,
        worker_stuck=snapshot.worker_stuck,
        needs_verification=snapshot.needs_verification,
        work_off_track=snapshot.work_off_track,
        meaningful_progress=snapshot.meaningful_progress,
        ready_to_finish=snapshot.ready_to_finish,
        backend=snapshot.backend,
    )
