"""Operator run execution (Team 3).

`start_run` is the single entrypoint every trigger uses (routes, heartbeat,
event wakes). Must be fail-closed when the Operator is disabled/unconfigured
and must meter + cap all inference spend.
"""

from __future__ import annotations


async def start_run(**kwargs) -> dict:
    return {"skipped": "not implemented"}
