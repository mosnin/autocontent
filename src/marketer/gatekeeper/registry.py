"""The capability registry.

An intent stores its capability by NAME, then waits — possibly for days —
for a human. By the time it is applied, the only link back to executable
code is that string, so the registry is what makes deferred approval work
at all.

Two consequences follow, and both are enforced here rather than by
convention:

*   **A name is permanent once shipped.** Renaming one orphans every
    pending intent that referenced it; they fail as "unknown capability"
    and a human has to work out what was supposed to happen. Deprecate by
    registering the old name as an alias, never by renaming.
*   **Resolution returns None rather than raising.** The apply worker
    turns an unknown name into a failed intent with a readable error,
    which is strictly better than an exception that stops the queue and
    strands everyone else's approvals behind it.
"""
from __future__ import annotations

from typing import Any

from .capability import Capability

_REGISTRY: dict[str, Capability[Any, Any]] = {}


def register(capability: Capability[Any, Any]) -> Capability[Any, Any]:
    """Register a capability under its name.

    Refuses to overwrite: two capabilities sharing a name means pending
    intents would apply through whichever module imported last, which is
    a load-order-dependent money bug. Fail at import instead.
    """
    existing = _REGISTRY.get(capability.name)
    if existing is not None and existing is not capability:
        raise ValueError(
            f"capability {capability.name!r} is already registered; names are "
            "permanent because pending intents resolve by name"
        )
    _REGISTRY[capability.name] = capability
    return capability


def resolve_capability(name: str) -> Capability[Any, Any] | None:
    """Look up a capability. None when unknown — see the module docstring
    for why this does not raise."""
    return _REGISTRY.get(name)


def registered_names() -> list[str]:
    return sorted(_REGISTRY)


def clear() -> None:
    """Test-only. Never call from application code."""
    _REGISTRY.clear()
