"""One-shot run plans — Jev decides, code skips the slow stages.

The X / TypeSafe claim is not "Jev writes faster". It is: stop using an
LLM as a classifier, batch every decision into one speculative fan-out,
and let deterministic code skip the stages that no longer need a model.

A video job used to pay for:

1. ideation LLM
2. scriptwriter LLM
3. visual-director LLM (scriptwriter already emits visual + motion)
4. Whisper (script already has narration + per-scene durations)
5. sequential Foreman then screen then repurpose Jev calls

This planner collapses (model tier + skip hints) into one Jev call.
Skip-VD and script captions are then enforced in code so a shy noul
cannot re-introduce a multi-second LLM when the artifacts are already
usable.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from ..services.spend_context import SpendContext
from .ask import ask as jev_ask
from .ask import available
from .client import choice, noul
from .harness import DEFAULT_MODEL_FLEET, GenerationTier, default_generation_model
from .primitives import State

CaptionSource = Literal["script", "whisper"]

VISUAL_PROMPT_MIN = 20
MOTION_PROMPT_MIN = 12


@dataclass(frozen=True)
class VideoPlan:
    model_id: str
    tier: GenerationTier
    prefer_skip_visual_director: bool
    caption_source: CaptionSource
    confidence: float
    backend: str

    def as_dict(self) -> dict[str, object]:
        return {
            "model_id": self.model_id,
            "tier": self.tier,
            "prefer_skip_visual_director": self.prefer_skip_visual_director,
            "caption_source": self.caption_source,
            "confidence": self.confidence,
            "backend": self.backend,
        }


def _dark_video_plan(*, script_model: str = "") -> VideoPlan:
    return VideoPlan(
        model_id=script_model or default_generation_model(),
        tier="standard",
        prefer_skip_visual_director=True,
        caption_source="script",
        confidence=0.0,
        backend="none",
    )


def script_has_usable_visuals(script: Any) -> bool:
    """True when every scene already has a usable still + motion prompt.

    Scriptwriter is instructed to emit both. A second Visual Director
    LLM pass is then pure latency. Thresholds stay above the stub
    ``vp0`` / ``mp0`` strings in pipeline tests so those still exercise VD.
    """
    scenes = getattr(script, "scenes", None) or []
    if not scenes:
        return False
    for scene in scenes:
        visual = str(getattr(scene, "visual_prompt", "") or "").strip()
        motion = str(getattr(scene, "motion_prompt", "") or "").strip()
        if len(visual) < VISUAL_PROMPT_MIN or len(motion) < MOTION_PROMPT_MIN:
            return False
    return True


def script_has_caption_source(script: Any) -> bool:
    scenes = getattr(script, "scenes", None) or []
    return any(str(getattr(s, "narration", "") or "").split() for s in scenes)


async def plan_video_run(
    state: State,
    *,
    script_model: str = "",
    spend: SpendContext | None = None,
) -> VideoPlan:
    """One fan-out: generation tier + skip hints. Dark harness → defaults."""
    from ..config import settings

    prior_fail = isinstance(state, dict) and bool(state.get("prior_qa_failed"))
    if script_model:
        # Operator pinned a writer. Do not second-guess the dropdown.
        return VideoPlan(
            model_id=script_model,
            tier="standard",
            prefer_skip_visual_director=True,
            caption_source="script",
            confidence=1.0,
            backend="operator",
        )
    if not (settings.jev_enabled and available()):
        dark = _dark_video_plan()
        if prior_fail:
            return VideoPlan(
                model_id=DEFAULT_MODEL_FLEET["standard"]["id"],
                tier="standard",
                prefer_skip_visual_director=dark.prefer_skip_visual_director,
                caption_source=dark.caption_source,
                confidence=dark.confidence,
                backend=dark.backend,
            )
        return dark
    try:
        result = await jev_ask(
            state,
            {
                "tier": choice(
                    "Choose the least costly model that can write this short-form script.",
                    {tier: spec["criteria"] for tier, spec in DEFAULT_MODEL_FLEET.items()},
                ),
                "skip_vd": noul(
                    "A scriptwriter that already emits visual_prompt and "
                    "motion_prompt per scene does not need a second visual-"
                    "director LLM pass.",
                    yes="Skip the extra visual-director call",
                    no="The script will not have usable visual direction",
                ),
                "captions": choice(
                    "How should burned-in captions be timed?",
                    {
                        "script": (
                            "Use the script's narration + scene durations. "
                            "No speech-to-text needed."
                        ),
                        "whisper": (
                            "Transcribe the finished voiceover with Whisper. "
                            "Only when the script has no usable narration."
                        ),
                    },
                ),
            },
            spend=spend,
        )
    except Exception:  # noqa: BLE001 — planner is an upgrade
        return _dark_video_plan()
    picked = result.choice("tier")
    tier: GenerationTier = (
        picked.choice if picked.choice in DEFAULT_MODEL_FLEET else "standard"  # type: ignore[assignment]
    )
    if tier not in DEFAULT_MODEL_FLEET:
        tier = "standard"
    # Cascade: a failed QA pass does not get the cheap tier again.
    if prior_fail and tier == "fast":
        tier = "standard"
    captions = result.choice("captions").choice
    caption_source: CaptionSource = "whisper" if captions == "whisper" else "script"
    return VideoPlan(
        model_id=DEFAULT_MODEL_FLEET[tier]["id"],
        tier=tier,
        prefer_skip_visual_director=result.noul("skip_vd").noul >= 0.45,
        caption_source=caption_source,
        confidence=min(picked.confidence, result.choice("captions").confidence or 1.0),
        backend=result.backend,
    )
