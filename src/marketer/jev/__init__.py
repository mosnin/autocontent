"""Jev harness — TypeSafe System One decisions for marketer.

Jev does not generate text. It answers typed Noul / Choice / Score
questions about program state. Qwen (OpenRouter) generates; OpenAI
handles voice. This package is the decision layer in between.

See:
- https://docs.typesafe.ai/introduction
- https://www.langchain.com/blog/building-a-harness-with-jev
"""
from .ask import DecisionUnavailable, ask, available
from .client import (
    JevAuthError,
    JevDisabled,
    JevError,
    JevOverloadedError,
    JevRateLimitError,
    JevValidationError,
    choice,
    enabled,
    jev_cost,
    noul,
    score,
    system_one,
)
from .harness import (
    AutoModeDecision,
    ModelRoute,
    UltrafastAction,
    auto_mode,
    default_generation_model,
    next_action,
    route_model,
)
from .policy import gate_choice, gate_noul, gate_score, weighted_composite
from .primitives import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Score,
    ScoreAnswer,
    SystemOneResult,
)
from .router import IntentRoute, route_intent

__all__ = [
    "AutoModeDecision",
    "Choice",
    "ChoiceAnswer",
    "DecisionUnavailable",
    "IntentRoute",
    "JevAuthError",
    "JevDisabled",
    "JevError",
    "JevOverloadedError",
    "JevRateLimitError",
    "JevValidationError",
    "ModelRoute",
    "Noul",
    "NoulAnswer",
    "Score",
    "ScoreAnswer",
    "SystemOneResult",
    "UltrafastAction",
    "ask",
    "auto_mode",
    "available",
    "choice",
    "default_generation_model",
    "enabled",
    "gate_choice",
    "gate_noul",
    "gate_score",
    "jev_cost",
    "next_action",
    "noul",
    "route_intent",
    "route_model",
    "score",
    "system_one",
    "weighted_composite",
]
