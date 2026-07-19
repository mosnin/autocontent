"""Structured, machine-parseable error envelope for the public API.

Every error response — whether raised deliberately by new code, raised as a
plain ``fastapi.HTTPException`` by existing routes, a Pydantic/FastAPI
``RequestValidationError``, or an unhandled ``Exception`` bubbling out of a
handler — is rendered into the SAME JSON shape:

    {
      "error": {
        "code": "not_found",
        "message": "campaign not found",
        "hint": null,
        "retryable": false,
        "details": null
      }
    }

so agent/SDK callers can branch on ``error.code`` and ``error.retryable``
without having to parse human prose or guess at HTTP status semantics.

Every response (error or not) also carries an ``X-Request-ID`` response
header: the correlation id read from the inbound ``X-Request-ID`` request
header, or a freshly generated UUID4 if the client didn't send one. 500s log
that id at ERROR with the real exception, but the body returned to the
client is a generic message — internals (tracebacks, SQL, file paths) are
never leaked in the response.

Wiring (done by the orchestrator in ``backend/main.py::create_app()``):

    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from .errors import (
        AppError,
        app_error_handler,
        http_exception_handler,
        validation_exception_handler,
        unhandled_exception_handler,
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

Handler registration order does not matter to Starlette (it dispatches by
the most specific exception class registered), but all four should be
registered so every failure mode renders the same envelope.

New route code should prefer raising the ``AppError`` subclasses / factory
helpers below over ``fastapi.HTTPException`` — they carry a stable machine
code and a ``retryable`` flag out of the box. Existing routes that already
raise ``HTTPException`` keep working unmodified: ``http_exception_handler``
maps them into the same envelope, inferring ``code``/``retryable`` from the
HTTP status code.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from starlette import status
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


# ---------------------------------------------------------------------------
# Envelope models
# ---------------------------------------------------------------------------

class ErrorBody(BaseModel):
    """The machine-parseable payload nested under the ``error`` key."""

    code: str
    message: str
    hint: str | None = None
    retryable: bool = False
    details: dict[str, Any] | None = None


class ApiError(BaseModel):
    """Top-level response envelope: ``{"error": {...}}``."""

    error: ErrorBody


def _envelope(
    *,
    code: str,
    message: str,
    hint: str | None = None,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return ApiError(
        error=ErrorBody(
            code=code, message=message, hint=hint, retryable=retryable, details=details
        )
    ).model_dump(mode="json")


# ---------------------------------------------------------------------------
# Correlation id
# ---------------------------------------------------------------------------

def get_or_create_request_id(request: Request) -> str:
    """Return the inbound ``X-Request-ID`` header, or mint a fresh UUID4.

    Also caches the resolved id on ``request.state.request_id`` so handlers
    later in the same request (e.g. application logging middleware) can
    reuse the same value without re-reading the header.
    """
    cached = getattr(request.state, "request_id", None)
    if isinstance(cached, str) and cached:
        return cached
    request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
    request.state.request_id = request_id
    return request_id


def _json_response(
    request: Request,
    status_code: int,
    payload: dict[str, Any],
) -> JSONResponse:
    request_id = get_or_create_request_id(request)
    response = JSONResponse(status_code=status_code, content=payload)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


# ---------------------------------------------------------------------------
# AppError and its stable-code subclasses
# ---------------------------------------------------------------------------

class AppError(Exception):
    """Base class for deliberately-raised, machine-parseable API errors.

    Subclasses / factories set a stable ``code`` string that is safe to
    depend on in client code, plus the HTTP ``status_code`` to render and
    whether the failure is ``retryable`` (i.e. a client may reasonably
    retry the same request, possibly after a backoff/Retry-After).
    """

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"
    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        hint: str | None = None,
        details: dict[str, Any] | None = None,
        code: str | None = None,
        status_code: int | None = None,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.details = details
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        if retryable is not None:
            self.retryable = retryable

    def to_envelope(self) -> dict[str, Any]:
        return _envelope(
            code=self.code,
            message=self.message,
            hint=self.hint,
            retryable=self.retryable,
            details=self.details,
        )


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    retryable = False


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    retryable = False


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    retryable = False


class ValidationFailedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "validation_failed"
    retryable = False


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"
    retryable = True


class SpendCapExceededError(AppError):
    """Raised when a spend/budget guard blocks an action (HTTP 402)."""

    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "spend_cap_exceeded"
    retryable = False


class ProviderError(AppError):
    """An upstream provider (LLM, ad platform, publishing API, ...) failed."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "provider_error"
    retryable = True


class UnavailableError(AppError):
    """The service (or a required dependency) is temporarily unavailable."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "unavailable"
    retryable = True


# ---------------------------------------------------------------------------
# raise_*() convenience factories for new route code
# ---------------------------------------------------------------------------

def raise_not_found(message: str = "resource not found", **kw: Any) -> None:
    raise NotFoundError(message, **kw)


def raise_forbidden(message: str = "forbidden", **kw: Any) -> None:
    raise ForbiddenError(message, **kw)


def raise_conflict(message: str = "conflict", **kw: Any) -> None:
    raise ConflictError(message, **kw)


def raise_validation_failed(message: str = "validation failed", **kw: Any) -> None:
    raise ValidationFailedError(message, **kw)


def raise_rate_limited(message: str = "rate limited", **kw: Any) -> None:
    raise RateLimitedError(message, **kw)


def raise_spend_cap_exceeded(message: str = "spend cap exceeded", **kw: Any) -> None:
    raise SpendCapExceededError(message, **kw)


def raise_provider_error(message: str = "upstream provider error", **kw: Any) -> None:
    raise ProviderError(message, **kw)


def raise_unavailable(message: str = "service unavailable", **kw: Any) -> None:
    raise UnavailableError(message, **kw)


# ---------------------------------------------------------------------------
# Exception handlers (registered by the orchestrator in main.py)
# ---------------------------------------------------------------------------

async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Render any ``AppError`` subclass into the standard envelope."""
    return _json_response(request, exc.status_code, exc.to_envelope())


# Maps the HTTP status codes routes already raise via HTTPException today
# onto a stable machine code + retryable flag, so old and new code produce
# an identical envelope shape.
_STATUS_CODE_MAP: dict[int, tuple[str, bool]] = {
    status.HTTP_400_BAD_REQUEST: ("bad_request", False),
    status.HTTP_401_UNAUTHORIZED: ("unauthorized", False),
    status.HTTP_402_PAYMENT_REQUIRED: ("spend_cap_exceeded", False),
    status.HTTP_403_FORBIDDEN: ("forbidden", False),
    status.HTTP_404_NOT_FOUND: ("not_found", False),
    status.HTTP_405_METHOD_NOT_ALLOWED: ("method_not_allowed", False),
    status.HTTP_409_CONFLICT: ("conflict", False),
    status.HTTP_422_UNPROCESSABLE_CONTENT: ("validation_failed", False),
    status.HTTP_429_TOO_MANY_REQUESTS: ("rate_limited", True),
    status.HTTP_502_BAD_GATEWAY: ("provider_error", True),
    status.HTTP_503_SERVICE_UNAVAILABLE: ("unavailable", True),
    status.HTTP_504_GATEWAY_TIMEOUT: ("timeout", True),
}


def _code_and_retryable_for_status(status_code: int) -> tuple[str, bool]:
    if status_code in _STATUS_CODE_MAP:
        return _STATUS_CODE_MAP[status_code]
    if 500 <= status_code:
        return "internal_error", True
    return "error", False


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Map ``fastapi.HTTPException``/``StarletteHTTPException`` into the envelope.

    Existing routes raise ``HTTPException(status_code, "some message")``
    today; this keeps them working unmodified by inferring ``code`` and
    ``retryable`` from the status code while preserving the original detail
    string as ``message``.
    """
    code, retryable = _code_and_retryable_for_status(exc.status_code)
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    if exc.status_code >= 500:
        request_id = get_or_create_request_id(request)
        logger.error(
            "http_exception.server_error",
            extra={"request_id": request_id, "status_code": exc.status_code, "detail": message},
        )
        message = "internal server error"
    headers = dict(exc.headers) if exc.headers else None
    payload = _envelope(code=code, message=message, retryable=retryable)
    response = _json_response(request, exc.status_code, payload)
    if headers:
        response.headers.update(headers)
    return response


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Render FastAPI/Pydantic request validation failures into the envelope.

    The per-field errors are preserved (loc/msg/type) under ``details`` so
    callers can pinpoint which field failed without regex-parsing prose.
    """
    errors = exc.errors()
    details = {
        "errors": [
            {
                "loc": [str(part) for part in e.get("loc", ())],
                "msg": e.get("msg"),
                "type": e.get("type"),
            }
            for e in errors
        ]
    }
    payload = _envelope(
        code="validation_failed",
        message="request validation failed",
        retryable=False,
        details=details,
    )
    return _json_response(request, status.HTTP_422_UNPROCESSABLE_CONTENT, payload)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler for exceptions no other handler caught.

    Logs the real exception (with traceback) against the correlation id at
    ERROR, but returns only a generic message to the client — never leaks
    internals (tracebacks, SQL, file paths, secrets).
    """
    request_id = get_or_create_request_id(request)
    logger.error(
        "unhandled_exception",
        exc_info=exc,
        extra={"request_id": request_id, "path": request.url.path},
    )
    payload = _envelope(
        code="internal_error",
        message="an unexpected error occurred",
        retryable=True,
        details={"request_id": request_id},
    )
    return _json_response(request, status.HTTP_500_INTERNAL_SERVER_ERROR, payload)
