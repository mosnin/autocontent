"""Bounded Jev workflows for judgment-heavy coding / content-diff work.

Port of https://github.com/devagrawal09/jev-code — four workflows, no
code generation. Agents describe what they need; we gather evidence,
ask a fixed question set, and return a structured report.

Workflows:
- find   — rank files / artifacts relevant to a task
- check  — diff vs task + rules + acceptance criteria
- triage_failures — sort a test / QA / CI log
- triage_review   — sort review comments
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from ..jev.ask import ask as jev_ask
from ..jev.client import choice, noul, score
from ..services.spend_context import SpendContext

Workflow = Literal["find", "check", "triage_failures", "triage_review"]


@dataclass(frozen=True)
class SymbolicReport:
    workflow: Workflow
    findings: list[dict[str, Any]]
    backend: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "workflow": self.workflow,
            "findings": self.findings,
            "backend": self.backend,
        }


async def classify_request(
    request: str,
    *,
    spend: SpendContext | None = None,
) -> Workflow:
    """Route a natural-language ask onto one of the four workflows."""
    result = await jev_ask(
        request,
        {
            "workflow": choice(
                "Which bounded judgment workflow should handle this request?",
                {
                    "find": "Find or rank relevant files / artifacts for a task",
                    "check": "Check a diff or change against a task, rules, or acceptance criteria",
                    "triage_failures": "Sort test, QA, or CI failures",
                    "triage_review": "Sort review comments and say which need attention",
                },
            )
        },
        spend=spend,
    )
    picked = result.choice("workflow").choice
    if picked in {"find", "check", "triage_failures", "triage_review"}:
        return picked  # type: ignore[return-value]
    return "check"


async def find_relevant(
    task: str,
    candidates: Sequence[dict[str, str]],
    *,
    spend: SpendContext | None = None,
) -> SymbolicReport:
    if not candidates:
        return SymbolicReport(workflow="find", findings=[], backend="none")
    questions: dict[str, Any] = {}
    for i, _c in enumerate(candidates):
        questions[f"r{i}"] = score(
            f"How relevant is candidate {i} to the task?",
            ["Unrelated", "Weakly related", "Useful context", "Must read"],
        )
    result = await jev_ask(
        {"task": task, "candidates": list(candidates)},
        questions,
        spend=spend,
    )
    findings = []
    for i, cand in enumerate(candidates):
        ans = result.score(f"r{i}")
        findings.append({**cand, "relevance": ans.normalized(), "confidence": ans.confidence})
    findings.sort(key=lambda row: float(row["relevance"]), reverse=True)
    return SymbolicReport(workflow="find", findings=findings, backend=result.backend)


async def check_changes(
    task: str,
    diff: str,
    *,
    rules: str = "",
    acceptance: str = "",
    spend: SpendContext | None = None,
) -> SymbolicReport:
    result = await jev_ask(
        {"task": task, "diff": diff[:12000], "rules": rules, "acceptance": acceptance},
        {
            "on_task": noul("The change addresses the stated task."),
            "rules_ok": noul("The change respects the supplied project rules (or there are none)."),
            "acceptance_met": noul(
                "The change meets the acceptance criteria (or none were supplied)."
            ),
            "risk": score(
                "How risky is shipping this change as-is?",
                ["Safe", "Needs a glance", "Needs review", "Do not ship"],
            ),
        },
        spend=spend,
    )
    return SymbolicReport(
        workflow="check",
        findings=[
            {
                "on_task": result.noul("on_task").noul,
                "rules_ok": result.noul("rules_ok").noul,
                "acceptance_met": result.noul("acceptance_met").noul,
                "risk": result.score("risk").normalized(),
                "confidence": result.score("risk").confidence,
            }
        ],
        backend=result.backend,
    )


async def triage_failures(
    log_text: str,
    *,
    spend: SpendContext | None = None,
) -> SymbolicReport:
    result = await jev_ask(
        {"log": log_text[:12000]},
        {
            "root_cause_class": choice(
                "What class of failure dominates this log?",
                {
                    "flake": "Intermittent / order-dependent / timing",
                    "assertion": "A real assertion or QA gate failed",
                    "infra": "Environment, credentials, or network",
                    "regression": "A recent change broke existing behavior",
                    "unknown": "Not enough signal",
                },
            ),
            "actionable": noul("A developer can act on this log without more context."),
            "severity": score(
                "How severe is the failure?",
                ["Cosmetic", "Degraded", "Blocking"],
            ),
        },
        spend=spend,
    )
    return SymbolicReport(
        workflow="triage_failures",
        findings=[
            {
                "class": result.choice("root_cause_class").choice,
                "confidence": result.choice("root_cause_class").confidence,
                "actionable": result.noul("actionable").noul,
                "severity": result.score("severity").normalized(),
            }
        ],
        backend=result.backend,
    )


async def triage_review(
    comments: Sequence[str],
    *,
    spend: SpendContext | None = None,
) -> SymbolicReport:
    if not comments:
        return SymbolicReport(workflow="triage_review", findings=[], backend="none")
    questions: dict[str, Any] = {}
    for i, _c in enumerate(comments):
        questions[f"c{i}_needs"] = noul(
            f"Comment {i} needs a change (not nitpick, not outdated)."
        )
        questions[f"c{i}_blocking"] = noul(f"Comment {i} is blocking merge / publish.")
    result = await jev_ask({"comments": list(comments)}, questions, spend=spend)
    findings = []
    for i, text in enumerate(comments):
        findings.append(
            {
                "comment": text,
                "needs_change": result.noul(f"c{i}_needs").noul,
                "blocking": result.noul(f"c{i}_blocking").noul,
            }
        )
    findings.sort(
        key=lambda row: (float(row["blocking"]), float(row["needs_change"])),
        reverse=True,
    )
    return SymbolicReport(workflow="triage_review", findings=findings, backend=result.backend)
