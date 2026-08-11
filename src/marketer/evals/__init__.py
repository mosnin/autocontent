"""Deterministic eval harness for the short-form video agent pipeline.

Pure scoring functions (no network, no DB) live in ``script_checks``;
live agent evals that exercise the real pipeline live under
``tests/evals/`` and are gated behind ``MARKETER_RUN_LIVE_EVALS``.
"""
from __future__ import annotations

from .script_checks import (
    check_duration,
    check_hook,
    check_pacing,
    check_style_cohesion,
    check_visual_prompts,
    score_script,
)

__all__ = [
    "check_duration",
    "check_hook",
    "check_pacing",
    "check_style_cohesion",
    "check_visual_prompts",
    "score_script",
]
