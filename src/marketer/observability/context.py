"""Who a span is for, and how much AI text it may carry.

- ``bind(tenant_id=..., actor_id=...)``: opaque identity for every span started
  in this context (rule 6: ids only, never email, name or IP). The policy
  dependency binds it per request; pipelines bind the tenant.
- ``content_mode_for(tenant_id)``: ``redacted`` or ``metadata``. ``metadata``
  when the deployment says so (``BRAINTRUST_CONTENT``), when the workspace
  turned on "Don't send AI content to our observability provider", or when
  the setting can't be read (fail closed). Cached for 60 seconds per tenant.
- ``recall_guard()``: spans started inside it are recall spans and keep only
  counts, timing and scope kind (rule 5).
"""
from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from .masking import METADATA, REDACTED, normalize_mode

log = logging.getLogger(__name__)

CACHE_TTL_SEC = 60.0
_CACHE_MAX = 10_000


@dataclass(frozen=True)
class Identity:
    tenant_id: str | None = None
    actor_id: str | None = None
    role: str | None = None
    agent: str | None = None
    conversation_id: str | None = None

    def attributes(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for key in ("tenant_id", "actor_id", "role", "agent", "conversation_id"):
            value = getattr(self, key)
            if value:
                out[key] = str(value)[:256]
        return out


_identity: ContextVar[Identity] = ContextVar("marketer_obs_identity", default=Identity())
_recall: ContextVar[bool] = ContextVar("marketer_obs_recall", default=False)


def current_identity() -> Identity:
    return _identity.get()


def bind(**fields: str | None) -> Identity:
    """Merge ``fields`` into the identity of this context (and of everything it
    starts). Returns the new identity. Unknown keys are ignored."""
    prev = _identity.get()
    allowed = {k: v for k, v in fields.items() if k in Identity.__dataclass_fields__}
    merged = Identity(**{**prev.__dict__, **{k: v for k, v in allowed.items() if v}})
    _identity.set(merged)
    return merged


@contextmanager
def scope(**fields: str | None) -> Iterator[Identity]:
    """``bind`` for a block, restored afterwards."""
    token = _identity.set(_identity.get())
    try:
        yield bind(**fields)
    finally:
        _identity.reset(token)


def in_recall() -> bool:
    return _recall.get()


@contextmanager
def recall_guard() -> Iterator[None]:
    token = _recall.set(True)
    try:
        yield
    finally:
        _recall.reset(token)


# ------------------------------------------------------------------ content mode


def global_mode() -> str:
    from ..config import settings  # noqa: PLC0415

    return normalize_mode(getattr(settings, "braintrust_content", REDACTED))


# tenant -> (mode, fetched_at). The span processor reads the last known value
# synchronously; a tenant it has never seen counts as metadata.
_cache: dict[str, tuple[str, float]] = {}


def cached_mode(tenant_id: str | None) -> str | None:
    if not tenant_id:
        return None
    hit = _cache.get(tenant_id)
    return hit[0] if hit else None


def remember(tenant_id: str, mode: str) -> None:
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    _cache[tenant_id] = (normalize_mode(mode), time.monotonic())


def forget_cache() -> None:
    _cache.clear()


async def content_mode_for(tenant_id: str | None) -> str:
    """The effective content mode for spans about ``tenant_id``.

    No tenant: the deployment's mode. A tenant: metadata if either the
    deployment or the workspace says so, or if the setting can't be read."""
    base = global_mode()
    if base == METADATA or not tenant_id:
        return base
    hit = _cache.get(tenant_id)
    if hit is not None and time.monotonic() - hit[1] < CACHE_TTL_SEC:
        return hit[0]
    try:
        from ..repos import observability as repo  # noqa: PLC0415

        mode = normalize_mode((await repo.get_setting(tenant_id)).content)
    except Exception:  # noqa: BLE001 — unreadable means metadata
        log.debug("observability.setting_unreadable", exc_info=True)
        mode = METADATA
    remember(tenant_id, mode)
    return mode
