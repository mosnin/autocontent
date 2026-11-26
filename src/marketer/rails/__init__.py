"""Execution rails: one enforcement point for every HIGH/CRITICAL action.

Read docs/rails/README.md first. Map:

- ``actions``   the reviewed HIGH/CRITICAL action list (tiers, kill-switch scopes)
- ``canonical`` canonical argument hashes for args-bound approvals
- ``policy``    the pure truth table (tier, kill switch, caps, unknown outcomes, approval binding)
- ``outcomes``  succeeded / failed / indeterminate / denied, and the classifier
- ``enforce``   ``enforce_dispatch`` (reads current facts) and ``Dispatch.run``
- ``store``     Postgres and in-memory persistence (0027_rails.sql)
- ``http``      FastAPI mapping and the idempotency-key request dependency
"""
from __future__ import annotations

from .canonical import args_hash, canonical_json, governance_hash
from .enforce import (
    Dispatch,
    OutcomeUnknown,
    RailsDenied,
    assert_no_unresolved,
    current_idempotency_key,
    enforce_dispatch,
    principal_of,
    set_request_idempotency_key,
)
from .policy import ApprovalBinding, CapsVerdict

__all__ = [
    "ApprovalBinding",
    "CapsVerdict",
    "Dispatch",
    "OutcomeUnknown",
    "RailsDenied",
    "args_hash",
    "assert_no_unresolved",
    "canonical_json",
    "current_idempotency_key",
    "enforce_dispatch",
    "governance_hash",
    "principal_of",
    "set_request_idempotency_key",
]
