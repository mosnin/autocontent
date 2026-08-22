"""Shared OpenAI retry predicates — used by images, TTS, and Whisper.

A regression here either retries unrecoverable 400s (wastes paid attempts
on content-policy refusals) or fails to retry 5xx/timeouts (fails jobs
that would have succeeded). Pure functions; no network.
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

from marketer.services.retry_policy import (
    is_content_policy_error,
    is_transient_openai_error,
)


def _request() -> httpx.Request:
    return httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


def _status(status_code: int, message: str = "boom") -> APIStatusError:
    resp = httpx.Response(status_code, request=_request(), json={"error": {"message": message}})
    return APIStatusError(message, response=resp, body=resp.json())


def _bad_request(message: str, *, code: str = "invalid_request") -> BadRequestError:
    resp = httpx.Response(
        400,
        request=_request(),
        json={"error": {"code": code, "message": message}},
    )
    return BadRequestError(message, response=resp, body=resp.json())


def test_connection_timeout_and_rate_limit_are_transient():
    assert is_transient_openai_error(APIConnectionError(message="reset", request=_request()))
    assert is_transient_openai_error(APITimeoutError(request=_request()))
    resp = httpx.Response(429, request=_request(), json={"error": {"message": "slow down"}})
    assert is_transient_openai_error(
        RateLimitError("slow down", response=resp, body=resp.json())
    )


def test_provider_5xx_is_transient_client_4xx_is_not():
    assert is_transient_openai_error(_status(500))
    assert is_transient_openai_error(_status(502))
    assert is_transient_openai_error(_status(503))
    # 429 is only transient via RateLimitError (checked first); a bare
    # APIStatusError 429 must not be treated as retryable 5xx.
    assert not is_transient_openai_error(_status(429))
    assert not is_transient_openai_error(_status(400))
    assert not is_transient_openai_error(_status(401))
    assert not is_transient_openai_error(_status(403))
    assert not is_transient_openai_error(_status(404))


def test_unrelated_exceptions_are_not_transient():
    assert not is_transient_openai_error(ValueError("nope"))
    assert not is_transient_openai_error(RuntimeError("boom"))
    assert not is_transient_openai_error(_bad_request("bad size"))


def test_content_policy_markers_detected_on_bad_request_only():
    for message in (
        "Your request was rejected by the safety system",
        "content_policy violation",
        "moderation_blocked: image",
    ):
        assert is_content_policy_error(_bad_request(message))

    assert not is_content_policy_error(_bad_request("invalid size"))
    # A 500 is not a policy refusal even if the text mentions safety.
    assert not is_content_policy_error(_status(500, "safety system down"))
    assert not is_content_policy_error(ValueError("content_policy"))
