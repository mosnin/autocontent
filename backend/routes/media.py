"""Media library — durable, browsable record of every rendered asset.

Endpoints are implemented by the Studio backend team; this module is
registered in main.py under /api/v1/media.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
