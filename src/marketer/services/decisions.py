"""Decision client: OpenRouter's decisions endpoint with a timeout, a fallback
contract and a log line for every call.

Contract (shared with the agent and onboarding, see
``.intent-onboarding/packages/core/src/decisions.ts``):

- One POST per decision to ``OPENROUTER_DECISIONS_URL`` (default
  ``https://openrouter.ai/api/alpha/decisions``) with ``OPENROUTER_API_KEY``.
  Server-side only; the key is never logged.
- Hard timeout per point, no retries on the hot path. A timeout, HTTP error,
  malformed body or a response without ``usage.cost`` is a *failure*, never a
  "no": the caller takes the point's rule-based fallback.
- Mode per point is ``off | shadow | enforce``. No key: ``off``, and nothing
  here touches the network or the database. Key set: ``shadow`` unless an env
  var or a ``feature_flags`` row says otherwise. Enforce is never a default.
- Every call is metered into ``spend_ledger`` through the job's
  ``SpendContext`` (the same pre-flight gate + ledger path every LLM call uses
  via ``agents.metered``), priced with OpenRouter's returned ``usage.cost``.
- Every decision that ran is written to ``decision_log``: point, model,
  questions version, a hash of the state (never the state), answers, whether
  the fallback was used, latency, cost and the action taken. Logging is
  best-effort and never fails the caller.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from uuid import UUID

import httpx

from ..decisions import questions as q
from ..logging import get_logger

log = get_logger(__name__)

Mode = Literal["off", "shadow", "enforce"]
MODES: tuple[str, ...] = ("off", "shadow", "enforce")
PROVIDER = "openrouter"

# feature_flags keys: ``decision.<point>.enforce`` / ``decision.<point>.off``.
FLAG_PREFIX = "decision."
_FLAG_TTL_S = 60.0


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def api_key() -> str:
    """OPENROUTER_API_KEY only. Decisions are opt-in: an existing generation
    key must not start paid decision calls by itself. Empty means every point
    is off."""
    return os.environ.get("OPENROUTER_API_KEY", "")


def decisions_url() -> str:
    return os.environ.get("OPENROUTER_DECISIONS_URL", "") or q.DEFAULT_DECISIONS_URL


def model_for(tier: q.Tier) -> str:
    if tier == "D0":
        return os.environ.get("MARKETER_DECISIONS_MODEL_D0", "") or q.D0_MODEL
    return os.environ.get("MARKETER_DECISIONS_MODEL", "") or q.D1_MODEL


# ---------------------------------------------------------------------------
# Mode resolution
# ---------------------------------------------------------------------------

_flag_cache: tuple[float, dict[str, bool]] | None = None


def _env_mode(name: str) -> Mode | None:
    val = os.environ.get(name, "").strip().lower()
    return val if val in MODES else None  # type: ignore[return-value]


async def _decision_flags() -> dict[str, bool]:
    """``decision.*`` rows from the admin feature_flags table, cached briefly.
    Any read failure (no DB, no table) reads as no flags."""
    global _flag_cache
    now = time.monotonic()
    if _flag_cache is not None and now - _flag_cache[0] < _FLAG_TTL_S:
        return _flag_cache[1]
    flags: dict[str, bool] = {}
    try:
        from ..repos import feature_flags as flags_repo

        for f in await flags_repo.list_all():
            if f.key.startswith(FLAG_PREFIX):
                flags[f.key] = f.enabled
    except Exception:  # noqa: BLE001 — flags are optional; defaults apply
        flags = {}
    _flag_cache = (now, flags)
    return flags


def reset_flag_cache() -> None:
    global _flag_cache
    _flag_cache = None


async def resolve_mode(point: q.Point) -> Mode:
    """Precedence: no key -> off; MARKETER_DECISIONS_MODE=off (kill switch) ->
    off; MARKETER_DECISION_<POINT>_MODE; feature flag ``decision.<point>.off``
    then ``decision.<point>.enforce``; MARKETER_DECISIONS_MODE; shadow."""
    if not api_key():
        return "off"
    global_mode = _env_mode("MARKETER_DECISIONS_MODE")
    if global_mode == "off":
        return "off"
    per_point = _env_mode(f"MARKETER_DECISION_{point.value.upper()}_MODE")
    if per_point is not None:
        return per_point
    flags = await _decision_flags()
    if flags.get(f"{FLAG_PREFIX}{point.value}.off"):
        return "off"
    if flags.get(f"{FLAG_PREFIX}{point.value}.enforce"):
        return "enforce"
    return global_mode or "shadow"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class DecisionError(Exception):
    """A failed decision call. Callers take the fallback; this is never a "no"."""

    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(f"{kind}: {message}" if message else kind)
        self.kind = kind


@dataclass(frozen=True)
class RawDecision:
    answers: dict[str, dict[str, Any]]
    model: str
    cost_usd: Decimal
    tokens: int
    ms: int


def _to_wire(questions: q.Questions) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name, question in questions.items():
        if isinstance(question, q.YesNo):
            out[name] = {"type": "noul", "instructions": question.instructions}
        elif isinstance(question, q.Choice):
            out[name] = {
                "type": "choice",
                "instructions": question.instructions,
                "options": dict(question.options),
            }
        else:
            out[name] = {
                "type": "score",
                "instructions": question.instructions,
                "levels": list(question.levels),
            }
    return out


def _unit(x: Any, what: str) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError) as e:
        raise DecisionError("invalid", f"{what} is not a number") from e
    if not 0.0 <= v <= 1.0:
        raise DecisionError("invalid", f"{what} out of range")
    return v


def _from_wire(questions: q.Questions, answers: Any) -> dict[str, dict[str, Any]]:
    """Normalise the model's answers; a missing or malformed answer fails the
    whole call (partial answers would let a table act on half a picture)."""
    if not isinstance(answers, dict):
        raise DecisionError("invalid", "answers missing")
    out: dict[str, dict[str, Any]] = {}
    for name, question in questions.items():
        a = answers.get(name)
        if not isinstance(a, dict):
            raise DecisionError("invalid", f"no answer for {name!r}")
        if isinstance(question, q.YesNo):
            raw = a.get("noul", a.get("probability"))
            out[name] = {"type": "yesno", "probability": _unit(raw, name)}
        elif isinstance(question, q.Choice):
            choice = a.get("choice")
            if choice not in question.options:
                raise DecisionError("invalid", f"{name!r} chose an unknown option")
            probs = a.get("probabilities") or {}
            out[name] = {
                "type": "choice",
                "choice": choice,
                "confidence": _unit(a.get("confidence"), name),
                "probabilities": {
                    k: _unit(v, f"{name}.{k}") for k, v in probs.items() if k in question.options
                },
            }
        else:
            try:
                raw_score = float(a.get("score"))
            except (TypeError, ValueError) as e:
                raise DecisionError("invalid", f"{name!r} score is not a number") from e
            top = len(question.levels) - 1
            # Accept either a 0..1 score or a level index; tables see 0..1.
            score = raw_score / top if raw_score > 1.0 and top > 0 else raw_score
            out[name] = {
                "type": "score",
                "score": _unit(score, name),
                "confidence": _unit(a.get("confidence", 1.0), name),
            }
    return out


def _cost(body: dict[str, Any]) -> Decimal:
    usage = body.get("usage")
    raw = usage.get("cost") if isinstance(usage, dict) else None
    if raw is None:
        # An unpriced call can't be metered, so it isn't trusted either.
        raise DecisionError("no_cost", "response has no usage.cost")
    try:
        cost = Decimal(str(raw))
    except InvalidOperation as e:
        raise DecisionError("no_cost", "usage.cost is not a number") from e
    if cost < 0:
        raise DecisionError("no_cost", "usage.cost is negative")
    return cost


class DecisionClient:
    """One POST per decision. No retries; the caller owns the fallback."""

    def __init__(
        self,
        *,
        key: str | None = None,
        url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._key = key if key is not None else api_key()
        self._url = url or decisions_url()
        self._transport = transport

    async def decide(
        self, state: Any, questions: q.Questions, *, model: str, timeout_s: float
    ) -> RawDecision:
        if not self._key:
            raise DecisionError("no_key")
        t0 = time.monotonic()
        payload = {"model": model, "state": state, "questions": _to_wire(questions)}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_s), transport=self._transport
            ) as http:
                resp = await asyncio.wait_for(
                    http.post(
                        self._url,
                        json=payload,
                        headers={"Authorization": f"Bearer {self._key}"},
                    ),
                    timeout=timeout_s,
                )
        except (asyncio.TimeoutError, httpx.TimeoutException) as e:
            raise DecisionError("timeout", f"after {timeout_s}s") from e
        except httpx.HTTPError as e:
            raise DecisionError("transport", type(e).__name__) from e
        if resp.status_code >= 400:
            raise DecisionError("http", str(resp.status_code))
        try:
            body = resp.json()
        except ValueError as e:
            raise DecisionError("invalid", "body is not JSON") from e
        if not isinstance(body, dict):
            raise DecisionError("invalid", "body is not an object")
        answers = _from_wire(questions, body.get("answers"))
        cost = _cost(body)
        usage = body.get("usage") or {}
        tokens = int(usage.get("total_tokens") or 0) if isinstance(usage, dict) else 0
        return RawDecision(
            answers=answers,
            model=str(body.get("model") or model),
            cost_usd=cost,
            tokens=tokens,
            ms=int((time.monotonic() - t0) * 1000),
        )


# ---------------------------------------------------------------------------
# decide(): mode, metering, result
# ---------------------------------------------------------------------------


def state_hash(state: Any) -> str:
    """sha256 of the canonical JSON state. The state itself is never stored."""
    blob = json.dumps(state, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass
class Decision:
    """The outcome of one decision call, ready to be applied and logged."""

    point: q.Point
    mode: Mode
    questions_version: str
    state_hash: str = ""
    answers: dict[str, dict[str, Any]] | None = None
    model: str | None = None
    cost_usd: Decimal | None = None
    latency_ms: int = 0
    error: str | None = None
    user_id: str | None = None
    subject_kind: str | None = None
    subject_id: str | None = None
    logged: bool = field(default=False, repr=False)

    @property
    def ok(self) -> bool:
        return self.answers is not None

    @property
    def enforce(self) -> bool:
        return self.mode == "enforce" and self.ok

    async def log(
        self,
        *,
        action: str,
        rule_action: str,
        table_action: str | None = None,
        fallback_used: bool | None = None,
    ) -> None:
        """Write this decision to ``decision_log`` (best-effort, once).

        ``action`` is what the pipeline actually did, ``rule_action`` what
        today's rule says, ``table_action`` what the truth table chose (None
        when the call failed). In shadow ``action == rule_action`` and the
        table's choice is kept for tuning. ``fallback_used`` defaults to
        "the call failed"."""
        if self.mode == "off" or self.logged or not self.user_id:
            return
        self.logged = True
        entry = {
            "user_id": self.user_id,
            "point": self.point.value,
            "mode": self.mode,
            "model": self.model,
            "questions_version": self.questions_version,
            "state_hash": self.state_hash,
            "answers": self.answers,
            "fallback_used": (not self.ok) if fallback_used is None else fallback_used,
            "reason": self.error,
            "latency_ms": self.latency_ms,
            "cost_usd": self.cost_usd,
            "action_taken": action,
            "rule_action": rule_action,
            "table_action": table_action,
            "subject_kind": self.subject_kind,
            "subject_id": self.subject_id,
        }
        log.info(
            "decision",
            extra={
                k: (str(v) if isinstance(v, Decimal) else v)
                for k, v in entry.items()
                if k not in ("answers", "user_id")
            },
        )
        try:
            from ..repos import decision_log as decision_log_repo

            await decision_log_repo.insert(**entry)
        except Exception as e:  # noqa: BLE001 — logging never fails a pipeline
            log.warning("decision log write failed", extra={"error": type(e).__name__})


async def _meter(spend: Any, raw: RawDecision) -> None:
    await spend.log(
        provider=PROVIDER,
        sku=f"decision:{raw.model}",
        units=Decimal(raw.tokens or 1),
        cost_usd=raw.cost_usd,
    )


async def decide(
    point: q.Point,
    state: Any,
    questions: q.Questions,
    *,
    user_id: str | None,
    spend: Any = None,
    subject_kind: str | None = None,
    subject_id: UUID | str | None = None,
    tier: q.Tier | None = None,
    client: DecisionClient | None = None,
) -> Decision:
    """Run one decision for *point*. Never raises: a failure comes back as a
    ``Decision`` with ``ok == False`` and ``error`` set, and the caller takes
    the point's fallback. With mode ``off`` (no key, or switched off) nothing
    is called, metered or logged."""
    spec = q.POINTS[point]
    decision = Decision(
        point=point,
        mode="off",
        questions_version=spec.version,
        user_id=user_id,
        subject_kind=subject_kind,
        subject_id=str(subject_id) if subject_id is not None else None,
    )
    if not user_id or not questions:
        return decision
    decision.mode = await resolve_mode(point)
    if decision.mode == "off":
        return decision

    decision.state_hash = state_hash(state)
    model = model_for(tier or spec.tier)
    decision.model = model
    t0 = time.monotonic()
    try:
        if spend is not None:
            await spend.ensure_can_spend(Decimal(q.CALL_ESTIMATE_USD))
        raw = await (client or DecisionClient()).decide(
            state, questions, model=model, timeout_s=spec.timeout_s
        )
    except DecisionError as e:
        decision.error = str(e)
    except Exception as e:  # noqa: BLE001 — includes a refused spend pre-flight
        decision.error = f"error: {type(e).__name__}"
    else:
        decision.answers = raw.answers
        decision.model = raw.model
        decision.cost_usd = raw.cost_usd
        if spend is not None:
            try:
                await _meter(spend, raw)
            except Exception as e:  # noqa: BLE001
                # The ledger row is written before any cap re-check raises; a
                # tripped cap sets the job's abort flag, so the next real stage
                # stops. The decision itself stays valid.
                log.warning("decision metering raised", extra={"error": type(e).__name__})
    decision.latency_ms = int((time.monotonic() - t0) * 1000)
    return decision
