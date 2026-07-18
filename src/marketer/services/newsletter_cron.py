"""Newsletter digest generation and sending (Team Newsletters).

Wired into the nightly scheduler by the coordinator; the owning team
implements run(). Must stay a cheap no-op when its feature is disabled
or unconfigured — the scheduler calls it unconditionally.
"""

from __future__ import annotations


async def run() -> dict:
    return {"skipped": "not implemented"}
