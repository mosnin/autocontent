"""Social scheduling via Ayrshare (single account, per-user profiles).

Each end-user has their own Ayrshare "User Profile" identified by a
profile key stored on `users.ayrshare_profile_key`. Calls pass that key
in the `Profile-Key` header so posts land on the right TikTok/Reels/
Shorts account.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path


async def schedule_post(
    *,
    video_path: Path,
    caption: str,
    hashtags: list[str],
    platform: str,
    scheduled_for: datetime,
    user_id: str,
    profile_key: str | None = None,
) -> str:
    """Upload `video_path` and schedule it for `scheduled_for` on the
    given user's Ayrshare profile. Returns provider post id.

    TODO:
      1. If profile_key is None, look it up via repos.users.get(user_id).
      2. POST media to Ayrshare /post with `Profile-Key` header,
         `scheduleDate` in ISO8601, `platforms=[platform]`, caption
         + hashtags joined, video as a public URL or multipart upload.
    """
    raise NotImplementedError
