"""Classification and routing packs.

Inspired by:
- usenotra/notra (work → content type)
- gargpratyush/jev-router / prismhq/jev-router (model pick)
- mejiasd3v/pi-jev-router, adarshmishra07/jcm-router, GodsBoy/jev-agent-skill-router
- gtaras7/typesafe-jev, GiesN/typesafe-jev-workflow
- TypeSafe intent-routing + skill-suggestion cookbooks
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..services.spend_context import SpendContext
from .ask import ask as jev_ask
from .client import choice, noul, score
from .harness import DEFAULT_MODEL_FLEET, GenerationTier, ModelRoute
from .policy import gate_choice
from .primitives import State

ContentKind = Literal["video", "article", "image", "social", "ad", "other"]
SkillName = Literal[
    "ideate",
    "write_script",
    "write_article",
    "qa",
    "seo",
    "ads_optimize",
    "repurpose",
    "none",
]


@dataclass(frozen=True)
class IntentRoute:
    kind: ContentKind
    skill: SkillName
    urgency: float
    confidence: float
    gate: str
    model: ModelRoute | None
    backend: str


async def route_intent(
    state: State,
    *,
    spend: SpendContext | None = None,
    pick_model: bool = True,
) -> IntentRoute:
    """Classify an incoming request and (optionally) pick a generation model."""
    questions: dict = {
        "kind": choice(
            "What kind of marketing work is this request asking for?",
            {
                "video": "Short-form video (TikTok / Reels / Shorts)",
                "article": "Long-form SEO article or blog post",
                "image": "Static image / carousel / thumbnail",
                "social": "Social caption, thread, or newsletter blurb",
                "ad": "Paid campaign, budget, or creative for ads",
                "other": "None of the above, or genuinely mixed",
            },
        ),
        "skill": choice(
            "Which single specialist skill should handle the next step?",
            {
                "ideate": "Pick a topic / hook / angle",
                "write_script": "Write a short-form video script",
                "write_article": "Outline or write a long-form article",
                "qa": "Review, score, or gate existing content",
                "seo": "Keyword, SERP, metadata, or ranking work",
                "ads_optimize": "Paid-media optimization or budget change",
                "repurpose": "Turn existing content into another format",
                "none": "No skill needed — deterministic code can finish this",
            },
        ),
        "needs_skill": noul(
            "This turn actually needs a specialist skill (not just a lookup)."
        ),
        "urgency": score(
            "How time-sensitive is this request?",
            ["Can wait", "This week", "Today", "Right now"],
        ),
    }
    if pick_model:
        questions["tier"] = choice(
            "Choose the least costly model that can complete the task.",
            {tier: spec["criteria"] for tier, spec in DEFAULT_MODEL_FLEET.items()},
        )
    result = await jev_ask(state, questions, spend=spend)
    kind_ans = result.choice("kind")
    skill_ans = result.choice("skill")
    kind: ContentKind = kind_ans.choice if kind_ans.choice in {
        "video", "article", "image", "social", "ad", "other",
    } else "other"  # type: ignore[assignment]
    skill: SkillName = skill_ans.choice if skill_ans.choice in {
        "ideate", "write_script", "write_article", "qa", "seo",
        "ads_optimize", "repurpose", "none",
    } else "none"  # type: ignore[assignment]
    if result.noul("needs_skill").noul < 0.4:
        skill = "none"
    gate = gate_choice(kind_ans, floor=0.45, act_at=0.7)
    model: ModelRoute | None = None
    if pick_model and skill != "none" and "tier" in result.answers:
        try:
            picked = result.choice("tier")
            tier: GenerationTier = (
                picked.choice if picked.choice in DEFAULT_MODEL_FLEET else "standard"  # type: ignore[assignment]
            )
            if tier not in DEFAULT_MODEL_FLEET:
                tier = "standard"
            model = ModelRoute(
                tier=tier,
                model_id=DEFAULT_MODEL_FLEET[tier]["id"],
                confidence=picked.confidence,
                probabilities=picked.probabilities,
                backend=result.backend,
                raw=result,
            )
        except Exception:  # noqa: BLE001 — routing a model is an upgrade
            model = None
    return IntentRoute(
        kind=kind,
        skill=skill,
        urgency=result.score("urgency").normalized(),
        confidence=min(kind_ans.confidence, skill_ans.confidence),
        gate=gate,
        model=model,
        backend=result.backend,
    )
