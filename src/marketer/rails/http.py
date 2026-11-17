"""HTTP mapping for rails exceptions (backend routes only).

Kept out of ``enforce.py`` so the rails core imports nothing from FastAPI and
runs unchanged inside Modal jobs.

- ``RailsDenied`` -> its own status (402 kill switch / cap, 409 state or
  binding changed, 403 unregistered, 503 rails store unavailable).
- ``OutcomeUnknown`` -> 502 with a detail that starts ``outcome_unknown:``.
  The agent client treats any 5xx as an unknown outcome and never replays a
  non-idempotent call; a person sees the Required Action in the inbox.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from .enforce import OutcomeUnknown, RailsDenied, set_request_idempotency_key


def to_http(exc: RailsDenied | OutcomeUnknown) -> HTTPException:
    if isinstance(exc, RailsDenied):
        # A cap denial keeps the guard's own wording (the API's existing 402
        # contract); rails-specific refusals lead with their code.
        detail = exc.reason if exc.code == "cap_exceeded" else f"{exc.code}: {exc.reason}"
        return HTTPException(exc.status_code, detail)
    return HTTPException(502, f"outcome_unknown: {exc}")


async def rails_request_context(request: Request) -> None:
    """Router dependency: remember this request's ``idempotency-key`` so the
    enforcement point can dedupe agent replays (stored with 0024's claims)."""
    set_request_idempotency_key(request.headers.get("idempotency-key"))
