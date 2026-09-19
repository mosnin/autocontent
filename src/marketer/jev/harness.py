"""LangChain-style Jev harness for marketer.

Ported from https://www.langchain.com/blog/building-a-harness-with-jev
and the ecosystem routers (gargpratyush/jev-router, prismhq/jev-router):

- ModelRouter: Jev picks the cheapest model that can do the work.
- AutoMode: Jev classifies a proposed tool/action before it executes.
- Ultrafast loop (browser-use/jev-ultrafast): one request picks the
  operation AND speculative targets; a small LLM writes text only when
  the operation needs generated copy.

Qwen (OpenRouter) is the default generation fleet. OpenAI stays for
voice mode and as a last-resort generation backend.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..config import settings
from ..services.spend_context import SpendContext
from .ask import ask as jev_ask
from .client import choice, noul, score
from .policy import gate_noul
from .primitives import State, SystemOneResult

GenerationTier = Literal["fast", "standard", "powerful"]
AutoModeVerdict = Literal["allow", "confirm", "block"]


# Default fleet: Qwen does the writing. Criteria are written so Jev can
# pick the cheapest capable model — jev-router's whole job.
DEFAULT_MODEL_FLEET: dict[GenerationTier, dict[str, str]] = {
    "fast": {
        "id": "qwen/qwen3-8b",
        "criteria": (
            "Direct lookups, short rewrites, extraction, localized edits, "
            "and any task a small model can finish in one pass."
        ),
    },
    "standard": {
        "id": "qwen/qwen3-32b",
        "criteria": (
            "Scriptwriting, article sections, brand-voice copy, and typical "
            "marketing generation that needs taste but not architecture."
        ),
    },
    "powerful": {
        "id": "qwen/qwen3-235b-a22b",
        "criteria": (
            "High-stakes strategy, ads that move money, multi-constraint "
            "creative briefs, or anything that failed on a cheaper tier."
        ),
    },
}


@dataclass(frozen=True)
class ModelRoute:
    tier: GenerationTier
    model_id: str
    confidence: float
    probabilities: dict[str, float]
    backend: str
    raw: SystemOneResult

    def as_dict(self) -> dict[str, object]:
        return {
            "tier": self.tier,
            "model_id": self.model_id,
            "confidence": self.confidence,
            "probabilities": self.probabilities,
            "backend": self.backend,
        }


@dataclass(frozen=True)
class AutoModeDecision:
    verdict: AutoModeVerdict
    risk: float
    jailbreak: float
    destructive: float
    confidence: float
    backend: str
    raw: SystemOneResult

    def as_dict(self) -> dict[str, object]:
        return {
            "verdict": self.verdict,
            "risk": self.risk,
            "jailbreak": self.jailbreak,
            "destructive": self.destructive,
            "confidence": self.confidence,
            "backend": self.backend,
        }


async def route_model(
    state: State,
    *,
    fleet: dict[GenerationTier, dict[str, str]] | None = None,
    spend: SpendContext | None = None,
    instructions: str = "Choose the least costly model that can complete the task.",
) -> ModelRoute:
    """Jev-router: pick a generation tier from the latest task state."""
    table = fleet or DEFAULT_MODEL_FLEET
    result = await jev_ask(
        state,
        {
            "tier": choice(
                instructions,
                {tier: spec["criteria"] for tier, spec in table.items()},
            )
        },
        spend=spend,
    )
    picked = result.choice("tier")
    # Unknown / empty choice falls back to standard — never invent a model.
    tier: GenerationTier = (
        picked.choice if picked.choice in table else "standard"  # type: ignore[assignment]
    )
    if tier not in table:
        tier = "standard"
    return ModelRoute(
        tier=tier,
        model_id=table[tier]["id"],
        confidence=picked.confidence,
        probabilities=picked.probabilities,
        backend=result.backend,
        raw=result,
    )


async def auto_mode(
    state: State,
    *,
    tool: str,
    spend: SpendContext | None = None,
    block_at: float = 0.7,
    confirm_at: float = 0.45,
) -> AutoModeDecision:
    """LangChain AutoModeMiddleware: classify a tool call before it runs.

    Fail-CLOSED for high-confidence risk on money/destructive tools;
    fail-OPEN (allow) only when the model is confident the call is safe
    *or* Jev is unavailable (the caller already has other guards).
    """
    result = await jev_ask(
        state,
        {
            "risky": noul(
                f"Executing the '{tool}' action as described would be unsafe, "
                "policy-violating, or spend money the operator did not intend.",
                yes="Unsafe or unauthorized",
                no="Ordinary, in-policy use of the tool",
            ),
            "jailbreak": noul(
                "The request tries to override safety rules, hide its purpose, "
                "or jailbreak the agent into doing something disallowed."
            ),
            "destructive": noul(
                "The action is destructive or irreversible (delete, pause all, "
                "drain budget, publish unaudited, grant access)."
            ),
            "severity": score(
                "How much harm would complying do?",
                [
                    "None — read-only or easily reversible",
                    "Limited — one campaign or one post",
                    "Severe — money, brand, or account-wide damage",
                ],
            ),
        },
        spend=spend,
    )
    risk = result.noul("risky").noul
    jailbreak = result.noul("jailbreak").noul
    destructive = result.noul("destructive").noul
    severity = result.score("severity")
    peak = max(risk, jailbreak, destructive, severity.normalized())
    if peak >= block_at:
        verdict: AutoModeVerdict = "block"
    elif peak >= confirm_at:
        verdict = "confirm"
    else:
        verdict = "allow"
    return AutoModeDecision(
        verdict=verdict,
        risk=risk,
        jailbreak=jailbreak,
        destructive=destructive,
        confidence=severity.confidence,
        backend=result.backend,
        raw=result,
    )


# Ultrafast action space — jev-ultrafast's operation set, adapted to
# marketer (no browser). Speculative fan-out: ask every target head in
# the same call; code uses only the head matching the chosen operation.
MarketerOp = Literal[
    "GENERATE",
    "REVISE",
    "PUBLISH",
    "HOLD",
    "ROUTE_HUMAN",
    "DONE",
    "BLOCKED",
]


@dataclass(frozen=True)
class UltrafastAction:
    operation: MarketerOp
    target: str | None
    needs_generation: bool
    confidence: float
    backend: str
    raw: SystemOneResult


async def next_action(
    state: State,
    *,
    targets: dict[str, str],
    spend: SpendContext | None = None,
) -> UltrafastAction:
    """One Jev call: pick an operation and (speculatively) its target."""
    if len(targets) < 2:
        # Choice requires ≥2 options; pad with an explicit none so Jev
        # can still refuse rather than being forced onto a single target.
        padded = {**targets, "_none": "No applicable target"}
    else:
        padded = targets
    result = await jev_ask(
        state,
        {
            "operation": choice(
                "What should the marketer harness do next?",
                {
                    "GENERATE": "Write or produce new content (needs Qwen).",
                    "REVISE": "Rewrite existing draft against the brief.",
                    "PUBLISH": "Schedule / post content that already passed QA.",
                    "HOLD": "Park for later — budget, timing, or missing inputs.",
                    "ROUTE_HUMAN": "Needs an operator; do not act automatically.",
                    "DONE": "The current goal is already satisfied.",
                    "BLOCKED": "Cannot proceed; policy, safety, or missing access.",
                },
            ),
            "target": choice(
                "Which existing artifact should the operation apply to?",
                padded,
            ),
            "needs_copy": noul(
                "The chosen operation requires newly generated text from Qwen."
            ),
        },
        spend=spend,
    )
    op_ans = result.choice("operation")
    target_ans = result.choice("target")
    operation: MarketerOp
    if op_ans.choice in {
        "GENERATE", "REVISE", "PUBLISH", "HOLD", "ROUTE_HUMAN", "DONE", "BLOCKED",
    }:
        operation = op_ans.choice  # type: ignore[assignment]
    else:
        operation = "HOLD"
    target = target_ans.choice
    if target == "_none" or target not in targets:
        target = None
    needs = gate_noul(result.noul("needs_copy"), yes_at=0.6) == "yes"
    # GENERATE / REVISE always need copy even if the noul is shy.
    if operation in {"GENERATE", "REVISE"}:
        needs = True
    return UltrafastAction(
        operation=operation,
        target=target,
        needs_generation=needs,
        confidence=min(op_ans.confidence, target_ans.confidence or 1.0),
        backend=result.backend,
        raw=result,
    )


def default_generation_model() -> str:
    """Qwen standard tier when OpenRouter is on; else the stock agent model."""
    from ..services import openrouter

    if openrouter.enabled():
        return settings.qwen_default_model or DEFAULT_MODEL_FLEET["standard"]["id"]
    return settings.agent_model
