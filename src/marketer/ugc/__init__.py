"""Standalone UGC studio: script + reference images -> one spokesperson ad.

This is deliberately *not* the niche/scene video pipeline. There is no
ideation, no scene breakdown, no voiceover, no ffmpeg edit — the user
supplies a script and up to `MARKETER_UGC_MAX_REFERENCE_IMAGES` reference
images (an actor face, a product shot, a setting) and one multi-model
video provider (MUAPI) returns a single finished vertical ad.

Modules:
  catalog  — model registry + per-model parameter capabilities
  pricing  — per-model USD cost from duration + resolution (pinned)
  prompts  — `@imageN` reference parsing/validation and prompt assembly
  render   — submit / reconcile / webhook-apply orchestration

The provider client lives in `marketer.services.muapi`; persistence in
`marketer.repos.ugc_renders`; the HTTP surface in `backend/routes/ugc.py`.
"""
from __future__ import annotations

from .catalog import (
    UGC_MODELS,
    UgcModel,
    get_model,
    list_models,
    validate_params,
)
from .pricing import estimate_cost, render_cost
from .prompts import (
    UgcPromptError,
    assemble_prompt,
    parse_image_refs,
    render_mode_for,
    validate_image_refs,
)

__all__ = [
    "UGC_MODELS",
    "UgcModel",
    "UgcPromptError",
    "assemble_prompt",
    "estimate_cost",
    "get_model",
    "list_models",
    "parse_image_refs",
    "render_cost",
    "render_mode_for",
    "validate_image_refs",
    "validate_params",
]
