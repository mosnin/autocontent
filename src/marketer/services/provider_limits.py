"""Per-provider concurrency gate: proactive backpressure so campaign +
nightly fan-out never hammers a single vendor past its rate/concurrency
cap.

Why this exists
----------------
Cycle-2's ``provider_fallback`` module reacts to a 429 (or any persistent
error) by switching to a different provider. That's the right response
to a *broken* provider, but a 429 caused by our OWN fan-out (many scenes,
many concurrent jobs, all hitting the same vendor at once) is not a
broken provider — it's us being impolite. This module prevents that
class of 429 by bounding how many requests to a given provider are
in-flight at once, smoothing bursts across concurrent jobs.

Scope: process-local only
--------------------------
Each gate is an in-process ``asyncio.Semaphore``. A Modal container is
the unit of concurrency here — this module does NOT coordinate across
containers/processes. Under ``pipeline_global_concurrency`` > 1 live
containers, each container enforces its own limit independently, so the
true cross-fleet concurrency against a provider can still exceed a single
container's configured limit by a factor of the container count. A truly
global limiter would need a shared store (Redis token bucket, etc.) — that
is out of scope for this cycle; see ``rate_limit_redis_url`` for the
precedent this project already has for opting into shared state, if a
future cycle wants to extend this module the same way.

Usage
-----
    async with provider_limits.slot("fal"):
        await fal_video.animate(...)

``slot()`` wraps the smallest span that actually calls the provider (the
network request), not surrounding bookkeeping, so a slot is held for the
minimum time necessary.

Why this can't deadlock
------------------------
The scene fan-out already holds an outer ``asyncio.Semaphore(scene_fanout_limit)``
(see ``pipeline.py``) for the whole duration of ``_generate_scene_assets``.
Each scene task then acquires at most ONE provider slot at a time, always
nested INSIDE the outer fan-out semaphore, and always released before the
next provider slot is acquired (keyframe slot released -> then video slot
acquired; video slot released -> then, for avatar scenes, TTS slot
acquired earlier still, but never overlapping — each provider call in
``_generate_scene_assets`` is sequential `await`, not concurrent). So:

* Lock order is always the same across every task: outer fan-out
  semaphore, then (at most) one inner provider semaphore at a time.
  A cycle requires two tasks to acquire two locks in opposite orders;
  that never happens here because no task ever holds a provider slot
  while trying to acquire the outer fan-out semaphore (the outer one is
  always acquired first, by the fan-out loop, before the scene task body
  — including any provider call — even starts).
* No task holds two different provider slots concurrently, so there is
  no A-waits-on-B-waits-on-A between provider gates either.
* A provider gate is never acquired anywhere the SAME task already holds
  that same gate (each call site does one `slot(provider)` around one
  provider call; nothing is reentrant), so self-deadlock is impossible.

Because there's a single consistent partial order (fan-out semaphore
outer, provider semaphore inner, never both providers at once, never
nested with itself), the wait-for graph can never have a cycle.

Composing with SpendCapExceeded
--------------------------------
``slot()`` does not catch anything. If the wrapped call raises
(``SpendCapExceeded`` or otherwise), the semaphore's own ``__aexit__``
still runs (releasing the slot for the next waiter) and the exception
propagates unchanged through ``slot()`` to the caller. A cap breach that
happens while a slot is HELD still propagates fully; a breach can't
happen "while waiting to acquire" a slot (the underlying provider call,
and thus the cap check, only runs once the slot is held), but a sibling
task waiting on that same slot is unaffected either way — it simply
proceeds to acquire the slot once released, on the merits of its own
cap check.

Fast path when uncontended
---------------------------
``asyncio.Semaphore.acquire()`` is a synchronous fast path (no actual
suspension, no event-loop round trip) whenever a permit is immediately
available — which is always true for a single in-flight job against a
generous default limit. So a single job pays effectively zero overhead:
one dict lookup plus an uncontended semaphore acquire/release. Setting a
provider's ``*_max_concurrency`` to ``0`` disables the gate for that
provider entirely (``slot()`` becomes a true no-op, skipping the
semaphore altogether) for operators who want to opt all the way out.
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import AsyncContextManager, AsyncIterator

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

# Generous, process-local defaults. These exist purely to smooth bursts
# across MANY concurrent jobs/scenes in one container — none of them is
# meant to throttle a single job below its current effective throughput
# (a single job's own peak concurrency against any one provider is bounded
# by scene_fanout_limit, default 4, which is well under every default here).
_DEFAULTS: dict[str, int] = {
    "fal": 16,
    "elevenlabs": 8,
    "openai_images": 24,
    "openai_tts": 16,
    "grok": 8,
}

# Maps a provider key (as used in `slot(provider)`) to its dedicated
# config field on Settings. Providers without a dedicated field (or an
# unrecognized key passed to `slot`) fall back to `_DEFAULTS` and, failing
# that, to `_FALLBACK_DEFAULT`.
_SETTINGS_FIELDS: dict[str, str] = {
    "fal": "fal_max_concurrency",
    "elevenlabs": "elevenlabs_max_concurrency",
    "openai_images": "openai_images_max_concurrency",
    "openai_tts": "openai_tts_max_concurrency",
    "grok": "grok_max_concurrency",
}

# Applied to any provider key with no dedicated field and no entry in
# _DEFAULTS (i.e. a genuinely unknown provider name) — generous enough to
# never be the bottleneck, small enough to still smooth a runaway fan-out.
_FALLBACK_DEFAULT = 32


class _Gate:
    """One provider's concurrency gate: a semaphore plus an explicit
    in-flight counter (kept ourselves rather than reading asyncio's
    private `Semaphore._value`, so `saturation()` is not reliant on
    implementation internals)."""

    __slots__ = ("limit", "_sem", "_in_use")

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._sem = asyncio.Semaphore(limit) if limit > 0 else None
        self._in_use = 0

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        if self._sem is None:
            # limit <= 0 means "gate disabled" for this provider: no-op,
            # not even a semaphore allocated.
            yield
            return
        async with self._sem:
            self._in_use += 1
            try:
                yield
            finally:
                self._in_use -= 1

    @property
    def in_use(self) -> int:
        return self._in_use


# provider -> (limit it was built with, gate). Rebuilt lazily whenever the
# configured limit for that provider changes (e.g. a test monkeypatches
# settings mid-run, or an operator's override JSON changes between calls).
# Plain dict mutation is safe here with no `await` between the read and
# the write, so no additional lock is needed under asyncio's cooperative
# single-threaded scheduling.
_gates: dict[str, tuple[int, _Gate]] = {}

# Cache for the parsed JSON overrides, keyed by the raw string so we only
# re-parse when the setting actually changes.
_overrides_cache: tuple[str | None, dict[str, int]] = (None, {})


def _parse_overrides(raw: str) -> dict[str, int]:
    """Defensive JSON parse, mirroring `fal_video._price_overrides`:
    malformed config is dropped (never breaks a provider call) but logged
    loudly so an operator notices their override silently didn't apply.

    Expected shape: `{"fal": 8, "elevenlabs": 4}` — provider name to a
    positive int (0 disables the gate for that provider), or a value
    coercible to one.
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning(
            "provider concurrency overrides: MARKETER_PROVIDER_MAX_CONCURRENCY_OVERRIDES "
            "is not valid JSON, ignoring",
            extra={"error": str(exc)},
        )
        return {}
    if not isinstance(parsed, dict):
        log.warning(
            "provider concurrency overrides: expected a JSON object, got %s, ignoring",
            type(parsed).__name__,
        )
        return {}
    out: dict[str, int] = {}
    for key, val in parsed.items():
        try:
            limit = int(val)
        except (TypeError, ValueError):
            log.warning(
                "provider concurrency overrides: dropping unparseable limit for %r: %r",
                key, val,
            )
            continue
        if limit < 0:
            log.warning(
                "provider concurrency overrides: dropping negative limit for %r: %r",
                key, val,
            )
            continue
        out[str(key)] = limit
    return out


def _overrides() -> dict[str, int]:
    global _overrides_cache
    raw = settings.provider_max_concurrency_overrides
    cached_raw, cached_parsed = _overrides_cache
    if cached_raw == raw:
        return cached_parsed
    parsed = _parse_overrides(raw)
    _overrides_cache = (raw, parsed)
    return parsed


def configured_limit(provider: str) -> int:
    """The effective concurrency limit for `provider` right now: override
    JSON wins if present, else the provider's dedicated Settings field
    (if it's a sane positive int), else the built-in default, else a
    generous fallback for an unrecognized provider name. Never raises —
    bad config always resolves to a usable default."""
    overrides = _overrides()
    if provider in overrides:
        return overrides[provider]

    field = _SETTINGS_FIELDS.get(provider)
    if field is not None:
        val = getattr(settings, field, None)
        if isinstance(val, int) and not isinstance(val, bool) and val >= 0:
            return val
        if val is not None:
            log.warning(
                "provider concurrency: %s has a non-int/negative value %r, "
                "falling back to default",
                field, val,
            )

    return _DEFAULTS.get(provider, _FALLBACK_DEFAULT)


def _get_gate(provider: str) -> _Gate:
    limit = configured_limit(provider)
    cached = _gates.get(provider)
    if cached is not None and cached[0] == limit:
        return cached[1]
    gate = _Gate(limit)
    _gates[provider] = (limit, gate)
    return gate


def slot(provider: str) -> AsyncContextManager[None]:
    """Async context manager bounding concurrent in-flight calls to
    `provider` to its configured limit. See module docstring for the
    deadlock-freedom argument and the SpendCapExceeded composition.

    `provider` is a free-form key (`"fal"`, `"elevenlabs"`,
    `"openai_images"`, `"openai_tts"`, `"grok"`, ...) — any string works;
    unrecognized keys just get the generous fallback default so a typo
    never breaks rendering, only quietly under-applies the intended cap.
    """
    return _get_gate(provider).acquire()


def saturation(provider: str) -> dict[str, int]:
    """Current saturation snapshot for one provider gate, for ops
    metrics: `{"limit": ..., "in_use": ..., "available": ...}`. Safe to
    call for a provider that has never had a `slot()` call yet (returns
    the limit it WOULD be built with, with `in_use`/`available` computed
    accordingly) — this never itself allocates a gate as a side effect
    beyond the normal lazy `_get_gate` path, which is cheap and
    idempotent."""
    gate = _get_gate(provider)
    return {
        "limit": gate.limit,
        "in_use": gate.in_use,
        "available": max(0, gate.limit - gate.in_use) if gate.limit > 0 else -1,
    }


def saturation_snapshot() -> dict[str, dict[str, int]]:
    """Saturation for every provider gate that has been used at least
    once in this process (i.e. every provider `slot()` has been called
    for). Intended for the ops/metrics endpoint to expose as a gauge per
    provider — this module intentionally does not import or touch the
    metrics module itself (out of this cycle's file ownership)."""
    return {provider: saturation(provider) for provider in sorted(_gates)}
