"""Canonical argument hashes (docs/rails/approvals.md).

An approval authorises one exact action with one exact set of arguments. To
check that cheaply and without storing a copy of every argument forever, we
store a hash of a canonical serialisation at approval time and recompute it
from current facts at execution time. Same bytes in, same hash out, whatever
order the keys were built in.

Canonical form (the same as ``stableStringify`` in the agent harness, so the
two sides agree on JSON-native values; ``agent/src/marketer/rails/canonical.ts``
and ``tests/test_rails_canonical.py`` share test vectors):

- objects: keys sorted, ``None`` values kept as ``null``;
- separators ``,`` and ``:`` with no whitespace, UTF-8 kept as is;
- integers as integers, a float with no fractional part as an integer;
- ``Decimal`` as its plain decimal string with trailing zeros dropped
  (``Decimal("35.00")`` and ``Decimal("35")`` hash the same: money is compared
  by value, never by how it was typed);
- ``UUID``, ``date`` and ``datetime`` as their string forms.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID


def _decimal_str(d: Decimal) -> str:
    if not d.is_finite():
        raise ValueError("non-finite decimal in canonical arguments")
    if d == 0:
        return "0"
    return format(d.normalize(), "f")


def _normalise(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite number in canonical arguments")
        return int(value) if value.is_integer() else value
    if isinstance(value, Decimal):
        return _decimal_str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(k): _normalise(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalise(v) for v in value]
    raise TypeError(f"cannot canonicalise {type(value).__name__}")


def canonical_json(value: Any) -> str:
    return json.dumps(_normalise(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def args_hash(action: str, args: Mapping[str, Any]) -> str:
    """Hash of one action with its exact arguments."""
    return sha256_hex(canonical_json({"action": action, "args": dict(args)}))


def governance_hash(governance: Any | None) -> str:
    """Hash of an ad account's governance (status, kill switch, caps).

    Bound into ad approvals: a person approves a spend change under the caps
    in force at the time. If anyone edits them before execution, the approval
    no longer describes the world it is about to change, so it is refused.
    ``None`` (no account) hashes to a fixed value that never matches a real
    account.
    """
    if governance is None:
        return sha256_hex("governance:none")
    return sha256_hex(
        canonical_json(
            {
                "status": getattr(governance, "status", None),
                "killswitch": bool(getattr(governance, "killswitch", False)),
                "daily_cap_usd": getattr(governance, "daily_cap_usd", None),
                "monthly_cap_usd": getattr(governance, "monthly_cap_usd", None),
            }
        )
    )
