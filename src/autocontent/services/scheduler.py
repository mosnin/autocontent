"""Social scheduling.

Default provider: Ayrshare (single API across TikTok / Reels / Shorts).
Swap-in alternatives: Buffer, direct platform APIs.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path


async def schedule_post(video_path: Path, caption: str, hashtags: list[str],
                        platform: str, scheduled_for: datetime) -> str:
    """Upload `video_path` and schedule it. Returns provider post id.

    TODO: implement against Ayrshare /post endpoint with `scheduleDate`.
    """
    raise NotImplementedError
