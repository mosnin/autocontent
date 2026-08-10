"""Gatekeepers: one policy-checked, simulatable path for every external
side effect.

See `capability.py` for why speculation exists — briefly: a guardrail that
blocks an agent mid-plan is a guardrail operators disable, so this one
simulates instead of blocking and collects approvals in bulk afterwards.
"""
from __future__ import annotations

from .broker import AuditSink, Gatekeeper, IntentStore, always
from .registry import register, registered_names, resolve_capability
from .reconcile import apply_intent, compare, run_apply_queue
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
    "apply_intent",
    "compare",
    "register",
    "registered_names",
    "resolve_capability",
    "run_apply_queue",
]
