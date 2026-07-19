"""Platform Operator — agent runs, events, and settings (Team 3).

Registered in main.py under /api/v1/agent. The API contract is BINDING and
documented in OPERATOR_GOAL.md (Team 5 builds against it).
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
