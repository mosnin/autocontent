"""Centralized xAI pricing.

Sourced from docs.x.ai/developers/models. Update when the table moves.
"""
from __future__ import annotations

from decimal import Decimal

# grok-imagine-video: $0.050 per second of generated video.
# Per the pricing table the rate is unified across resolutions; the docs
# note resolution "affects total cost" — verify before flipping to 720p
# in production.
IMAGINE_VIDEO_USD_PER_SECOND = Decimal("0.050")


def imagine_video_cost(seconds: float) -> Decimal:
    return (IMAGINE_VIDEO_USD_PER_SECOND * Decimal(str(seconds))).quantize(Decimal("0.0001"))
