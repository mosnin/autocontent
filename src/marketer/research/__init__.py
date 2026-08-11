"""Research: what to make next for a niche.

One module today — ``trends`` — which turns a niche brief plus live
search results into themes, hooks, and format-matched angles.

This package is the stateful, I/O half of the video-format feature: the
format catalog itself (`marketer.formats`) is pure and importable
anywhere, while everything here talks to a search vendor, an LLM, and the
database. Keeping the split explicit is what lets the pipeline import
formats on the hot path without dragging a network client with it.
"""
from __future__ import annotations

from .trends import (
    TrendAngle,
    TrendFindings,
    TrendHook,
    TrendReport,
    TrendSource,
    TrendTheme,
    build_agent,
    build_prompt,
    gather_sources,
    research_queries,
    research_trends,
    run_trend_research,
)

__all__ = [
    "TrendAngle",
    "TrendFindings",
    "TrendHook",
    "TrendReport",
    "TrendSource",
    "TrendTheme",
    "build_agent",
    "build_prompt",
    "gather_sources",
    "research_queries",
    "research_trends",
    "run_trend_research",
]
