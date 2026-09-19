"""OpenAI retry predicates — wrong classification burns spend or drops jobs.

`is_transient_openai_error` is the tenacity filter on images/TTS/whisper.
Retrying a content-policy 400 triples an unrecoverable call; failing a
5xx/429 on the first attempt drops a job that would have succeeded.
"""
from __future__ import annotations

import httpx
import pytest
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    BadRequestError,
    InternalServerError,
    RateLimitError,
)

from marketer.services.retry_policy import (
    is_content_policy_error,
    is_transient_openai_error,
)


def _status_error(cls, status_code: int, message: str = "boom"):
    resp = httpx.Response(
        status_code,
        request=httpx.Request("POST", "https://api.openai.com/v1/chat"),
        json={"error": {"message": message}},
    )
    return cls(message, response=resp, body=resp.json())


def test_connection_timeout_and_rate_limit_are_transient():
    req = httpx.Request("POST", "https://api.openai.com/v1/chat")
    assert is_transient_openai_error(APIConnectionError(request=req))
    assert is_transient_openai_error(APITimeoutError(request=req))
    assert is_transient_openai_error(_status_error(RateLimitError, 429, "rate"))


def test_provider_5xx_is_transient_4xx_is_not():
    assert is_transient_openai_error(_status_error(InternalServerError, 500))
    assert is_transient_openai_error(_status_error(APIStatusError, 503, "unavailable"))
    assert not is_transient_openai_error(_status_error(APIStatusError, 400, "bad size"))
    assert not is_transient_openai_error(_status_error(BadRequestError, 400, "bad size"))


def test_generic_and_value_errors_are_not_transient():
    assert not is_transient_openai_error(ValueError("nope"))
    assert not is_transient_openai_error(RuntimeError("local"))


@pytest.mark.parametrize(
    "message",
    [
        "Your request was rejected by the safety system",
        "content_policy_violation",
        "moderation_blocked: image",
    ],
)
def test_policy_markers_on_bad_request(message):
    exc = _status_error(BadRequestError, 400, message)
    assert is_content_policy_error(exc)
    # Policy 400s are unrecoverable — must not be retried blindly.
    assert not is_transient_openai_error(exc)


def test_plain_bad_request_is_not_policy():
    exc = _status_error(BadRequestError, 400, "invalid image size")
    assert not is_content_policy_error(exc)


def test_policy_requires_bad_request_type():
    assert not is_content_policy_error(_status_error(APIStatusError, 400, "safety system"))
    assert not is_content_policy_error(ValueError("content_policy"))
