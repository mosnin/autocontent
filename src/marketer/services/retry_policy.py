"""Shared retry predicates for outbound calls.

Which predicate a call uses depends on what a second attempt can do
(docs/security/backend-audit.md, "Outbound calls"):

- An idempotent read (a status poll, a download, an analytics GET) is retried
  on any transient failure: ``is_transient_http_error``.
- A request that creates something on the other side (a paid render in a
  provider's queue, an account) is retried only when the first attempt
  provably never reached the provider, or the provider refused to take it
  (429): ``is_unsent_or_refused``. A read timeout or a 5xx after the request
  went out is NOT retried, because the first attempt may have landed.
- A send that publishes or moves money (a social post, an ad budget, a
  webhook, an x402 settlement) is never retried. It goes through
  ``marketer.rails`` and an unanswered attempt is recorded as an unknown
  outcome for a person to resolve.

OpenAI: `retry=retry_if_exception_type(Exception)` retried *everything*, including

`retry=retry_if_exception_type(Exception)` retried *everything*, including
400s that can never succeed — a content-policy refusal got three identical
attempts before failing the job. Transient means: connection/timeout
trouble, rate limiting, or a 5xx from the provider. Everything else fails
fast so callers can handle it (or not) deliberately.
"""
from __future__ import annotations

import httpx
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    BadRequestError,
    RateLimitError,
)

# Substrings OpenAI uses across SDK versions for safety-system refusals.
_POLICY_MARKERS = ("content_policy", "moderation_blocked", "safety system")


def is_transient_openai_error(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError)):
        return True
    return isinstance(exc, APIStatusError) and exc.status_code >= 500


# Raised before a single byte of the request was written: no connection, or
# no free connection in the pool. The provider cannot have acted on it.
_NEVER_SENT = (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)


def is_unsent_or_refused(exc: BaseException) -> bool:
    """True when retrying a non-idempotent request cannot duplicate it."""
    if isinstance(exc, _NEVER_SENT):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429


def is_transient_http_error(exc: BaseException) -> bool:
    """Transient failure of an idempotent read: transport trouble, 429, 5xx.
    A 4xx other than 429 fails the same way every time and is not retried."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


def is_content_policy_error(exc: BaseException) -> bool:
    if not isinstance(exc, BadRequestError):
        return False
    text = str(exc).lower()
    return any(marker in text for marker in _POLICY_MARKERS)
