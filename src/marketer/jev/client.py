"""HTTP client for TypeSafe's System One API (Jev).

Official contract: POST https://api.typesafe.ai/v1/systemone
Auth: Bearer TYPESAFE_API_KEY (we also accept MARKETER_TYPESAFE_API_KEY).

We speak the HTTP API directly with httpx — same stack as every other
provider — so we stay on Python 3.11 and never pull a second SDK.
Retries honor 429 / 529 + Retry-After the way the official SDKs do.

Config-gated: empty key → ``enabled()`` is False and callers fall through
to the Qwen System One wrapper or the pre-Jev LLM path. Never raise on
boot for a missing key.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

import httpx

from ..config import settings
from .primitives import (
    Answer,
    Questions,
    State,
    SystemOneResult,
    Usage,
    parse_answer,
    questions_payload,
)

PROVIDER = "typesafe"
BASE_URL = "https://api.typesafe.ai/v1"
DEFAULT_MODEL = "jev-latest"
_http: httpx.AsyncClient | None = None
_http_lock = asyncio.Lock()
# Official list price: $0.042 / MTok input, output free.
USD_PER_M_INPUT = Decimal("0.042")
USD_PER_M_OUTPUT = Decimal(0)


class JevError(RuntimeError):
    """Base error for the TypeSafe client. Callers decide retry policy."""


class JevAuthError(JevError):
    pass


class JevValidationError(JevError):
    pass


class JevRateLimitError(JevError):
    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class JevOverloadedError(JevError):
    pass


class JevDisabled(JevError):
    """Raised only when a caller insisted on Jev and the key is missing."""


async def _shared_client(timeout: float) -> httpx.AsyncClient:
    """Reuse one keep-alive client. A new client per ask pays TLS (~200ms)."""
    global _http
    if _http is not None and not _http.is_closed:
        return _http
    async with _http_lock:
        if _http is None or _http.is_closed:
            _http = httpx.AsyncClient(
                timeout=timeout,
                limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
            )
        return _http


async def warm() -> None:
    """Open the keep-alive pool during research so the first ask skips TLS."""
    if not enabled():
        return
    await _shared_client(8.0)


def enabled() -> bool:
    if settings.typesafe_api_key:
        return True
    import os

    return bool(os.environ.get("TYPESAFE_API_KEY"))


def model_id() -> str:
    return settings.jev_model or DEFAULT_MODEL


def jev_cost(input_tokens: int, output_tokens: int = 0) -> Decimal:
    cost = (
        USD_PER_M_INPUT * Decimal(input_tokens)
        + USD_PER_M_OUTPUT * Decimal(output_tokens)
    ) / Decimal(1_000_000)
    return cost.quantize(Decimal("0.000001"))


def _retry_after(resp: httpx.Response) -> float | None:
    raw = resp.headers.get("retry-after")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        raise JevAuthError("TypeSafe API key rejected (401)")
    if resp.status_code == 422:
        raise JevValidationError(f"TypeSafe rejected the request: {resp.text}")
    if resp.status_code == 429:
        raise JevRateLimitError(
            "TypeSafe rate limit (429)", retry_after=_retry_after(resp)
        )
    if resp.status_code == 529:
        raise JevOverloadedError("TypeSafe overloaded (529)")
    if resp.status_code >= 400:
        raise JevError(f"TypeSafe HTTP {resp.status_code}: {resp.text}")


def _parse_result(payload: dict[str, Any], *, backend: str = "jev") -> SystemOneResult:
    raw_answers = payload.get("answers") or {}
    answers: dict[str, Answer] = {}
    for key, value in raw_answers.items():
        if not isinstance(value, dict):
            continue
        answers[key] = parse_answer(value)
    usage_raw = payload.get("usage") or {}
    usage = Usage(
        input_tokens=int(usage_raw.get("input_tokens") or 0),
        output_tokens=int(usage_raw.get("output_tokens") or 0),
    )
    return SystemOneResult(
        model=str(payload.get("model") or model_id()),
        answers=answers,
        usage=usage,
        backend=backend,  # type: ignore[arg-type]
    )


async def system_one(
    state: State,
    questions: Questions,
    *,
    model: str | None = None,
    timeout: float = 8.0,
    max_attempts: int = 2,
) -> SystemOneResult:
    """Evaluate ``questions`` against ``state`` in one parallel Jev call.

    Raises ``JevDisabled`` when no key is configured. Callers that want
    the Qwen fallback should use ``jev.ask`` instead.

    Timeout is 8s with 2 attempts so a hung TypeSafe hop fails over to
    Qwen (or fail-open) in ~16s instead of waiting 15s × 3.
    """
    if not questions:
        raise JevValidationError("system_one requires at least one question")
    if not enabled():
        raise JevDisabled("MARKETER_TYPESAFE_API_KEY is not set")

    body = {
        "model": model or model_id(),
        "state": state,
        "questions": questions_payload(questions),
    }
    import os

    api_key = settings.typesafe_api_key or os.environ.get("TYPESAFE_API_KEY", "")
    headers = {
        "authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }
    last_error: Exception | None = None
    client = await _shared_client(timeout)
    for attempt in range(1, max_attempts + 1):
        try:
            resp = await client.post(
                f"{BASE_URL}/systemone", json=body, headers=headers
            )
            _raise_for_status(resp)
            return _parse_result(resp.json(), backend="jev")
        except (JevRateLimitError, JevOverloadedError, httpx.TransportError) as exc:
            last_error = exc
            if attempt >= max_attempts:
                break
            delay = 0.4 * (2 ** (attempt - 1))
            if isinstance(exc, JevRateLimitError) and exc.retry_after:
                delay = max(delay, exc.retry_after)
            await asyncio.sleep(delay)
    raise last_error or JevError("TypeSafe request failed")


def noul(instructions: str, *, yes: str | None = None, no: str | None = None) -> Noul:
    from .primitives import Noul

    criteria = None
    if yes or no:
        criteria = {}
        if yes:
            criteria["true"] = yes
        if no:
            criteria["false"] = no
    return Noul(instructions=instructions, criteria=criteria)


def choice(instructions: str, criteria: dict[str, str | None]) -> Choice:
    from .primitives import Choice

    return Choice(instructions=instructions, criteria=criteria)


def score(instructions: str, criteria: list[str]) -> Score:
    from .primitives import Score

    return Score(instructions=instructions, criteria=criteria)


# Re-export the constructors' return types for callers that import from client.
from .primitives import Choice, Noul, Score
