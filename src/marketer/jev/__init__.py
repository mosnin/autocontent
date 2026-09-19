"""Jev harness — TypeSafe System One decisions for marketer.

Jev does not generate text. It answers typed Noul / Choice / Score
questions about program state. Qwen (OpenRouter) generates; OpenAI
handles voice. This package is the decision layer in between.

See:
- https://docs.typesafe.ai/introduction
- https://www.langchain.com/blog/building-a-harness-with-jev
"""
from .ask import DecisionUnavailable, ask, available
from .cache import clear as clear_ask_cache
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
from .loops import (
    LoopVerdict,
    after_content_qa,
    campaign_tick_gate,
    enrich_failure_rows,
    filter_research_pages,
    publish_gate,
    repurpose_hint,
    seo_metadata_notes,
    should_index_asset,
    should_spawn_repurpose,
    source_audit_notes,
)
from .planner import (
    VideoPlan,
    plan_video_run,
    script_has_caption_source,
    script_has_usable_visuals,
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
    "LoopVerdict",
    "ModelRoute",
    "Noul",
    "NoulAnswer",
    "Score",
    "ScoreAnswer",
    "SystemOneResult",
    "UltrafastAction",
    "VideoPlan",
    "after_content_qa",
    "ask",
    "auto_mode",
    "available",
    "campaign_tick_gate",
    "choice",
    "clear_ask_cache",
    "default_generation_model",
    "enabled",
    "enrich_failure_rows",
    "filter_research_pages",
    "gate_choice",
    "gate_noul",
    "gate_score",
    "jev_cost",
    "next_action",
    "noul",
    "plan_video_run",
    "publish_gate",
    "repurpose_hint",
    "route_intent",
    "route_model",
    "score",
    "script_has_caption_source",
    "script_has_usable_visuals",
    "seo_metadata_notes",
    "should_index_asset",
    "should_spawn_repurpose",
    "source_audit_notes",
    "system_one",
    "weighted_composite",
]
