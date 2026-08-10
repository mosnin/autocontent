"""Gatekeepers: one policy-checked, simulatable path for every external
side effect.

See `capability.py` for why speculation exists — briefly: a guardrail that
blocks an agent mid-plan is a guardrail operators disable, so this one
simulates instead of blocking and collects approvals in bulk afterwards.
"""
from __future__ import annotations

from .broker import AuditSink, Gatekeeper, IntentStore, always
from .capability import (
    Capability,
    CapabilityDenied,
    Decision,
    GatekeeperContext,
    Outcome,
    Verdict,
)

__all__ = [
    "AuditSink",
    "Capability",
    "CapabilityDenied",
    "Decision",
    "Gatekeeper",
    "GatekeeperContext",
    "IntentStore",
    "Outcome",
    "Verdict",
    "always",
]
