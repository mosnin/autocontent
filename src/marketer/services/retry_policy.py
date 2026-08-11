"""Shared retry predicate for OpenAI provider calls.

`retry=retry_if_exception_type(Exception)` retried *everything*, including
400s that can never succeed — a content-policy refusal got three identical
attempts before failing the job. Transient means: connection/timeout
trouble, rate limiting, or a 5xx from the provider. Everything else fails
fast so callers can handle it (or not) deliberately.
"""
from __future__ import annotations

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


def is_content_policy_error(exc: BaseException) -> bool:
    if not isinstance(exc, BadRequestError):
        return False
    text = str(exc).lower()
    return any(marker in text for marker in _POLICY_MARKERS)
