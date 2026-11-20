"""Execution outcomes (docs/rails/failure-semantics.md).

Every HIGH/CRITICAL dispatch ends in exactly one outcome:

- ``succeeded``: the upstream answered yes.
- ``failed``: we know the side effect did not happen (the request never left,
  or the upstream answered no). Safe to try again.
- ``indeterminate``: the request may have left and we never got an answer
  (a read timeout after sending, a dropped connection, a 5xx). The post may be
  live, the budget may be changed. We never retry it automatically, and a
  person is asked to check (a Required Action in the workspace inbox).
- ``denied``: the enforcement point refused before anything was sent.

``classify`` decides between ``failed`` and ``indeterminate`` for an
exception raised by the send. The rule is asymmetric on purpose: calling an
ambiguous error ``failed`` invites a retry and a double post or a double
spend; calling a definite failure ``indeterminate`` only costs a person a
look. So anything we cannot prove definite is indeterminate.
"""
from __future__ import annotations

import asyncio
from typing import Literal

Outcome = Literal["succeeded", "failed", "indeterminate", "denied"]
OUTCOMES: tuple[str, ...] = ("succeeded", "failed", "indeterminate", "denied")


def classify(exc: BaseException, *, definite: tuple[type[BaseException], ...] = ()) -> Outcome:
    """``failed`` when the exception proves nothing was done, else ``indeterminate``.

    ``definite`` lists the caller's own exception types that are raised
    before sending or from a complete upstream answer (a guard denial, a
    validation error, "the scheduler answered with an error body").
    """
    if definite and isinstance(exc, definite):
        return "failed"
    try:
        import httpx
    except ImportError:  # pragma: no cover - httpx is a dependency
        httpx = None  # type: ignore[assignment]
    if httpx is not None:
        # Never connected, or never got a pooled connection: the request did not leave.
        if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
            return "failed"
        if isinstance(exc, httpx.HTTPStatusError):
            code = exc.response.status_code
            # A 4xx is a complete answer: rejected. A 5xx may have landed first.
            return "failed" if 400 <= code < 500 else "indeterminate"
        if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)):
            return "indeterminate"
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, ConnectionError)):
        return "indeterminate"
    return "indeterminate"
