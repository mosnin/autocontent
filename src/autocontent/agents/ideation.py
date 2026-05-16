"""Ideation agent: given a niche, propose a topic, angle, and hook.

Output: `Idea` schema. Optimized for short-form hook patterns
(curiosity gap, contrarian claim, "you've been doing X wrong", etc).
"""
from __future__ import annotations

from agents import Agent

from ..models import Idea

IDEATION_INSTRUCTIONS = """You are an expert short-form content strategist.
Given a niche, produce ONE Idea optimized for educational short-form video.

Rules for the hook (first 3 seconds):
- Pattern interrupt OR curiosity gap OR contrarian claim.
- Under 12 words. Spoken-word natural, not clickbait.
- Implies a payoff the rest of the video must deliver.

The angle should be a SPECIFIC, NON-OBVIOUS take — not a generic overview.
The audience should be precisely scoped (not "everyone").
`why_it_works` should reference a concrete cognitive or platform mechanic.
"""


def build_ideation_agent() -> Agent:
    return Agent(
        name="Ideation",
        instructions=IDEATION_INSTRUCTIONS,
        output_type=Idea,
    )
