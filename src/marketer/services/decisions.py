"""Decision client: OpenRouter's decisions endpoint with a timeout, a fallback
contract and a log line for every call.

Contract (shared with the agent and onboarding, see
``.intent-onboarding/packages/core/src/decisions.ts``):

- One POST per decision to ``OPENROUTER_DECISIONS_URL`` (default
  ``https://openrouter.ai/api/alpha/decisions``) with ``OPENROUTER_API_KEY``.
  Server-side only; the key is never logged.
- The wire contract is written down in docs/decisions/openrouter-contract.md
  and pinned by the golden cases in docs/decisions/conformance/, which this
  client and the agent's TypeScript client both replay.
- Hard timeout per point, no retries on the hot path. A timeout, HTTP error,
  refusal, malformed body or a response without ``usage.cost`` is a
  *failure*, never a "no": the caller takes the point's rule-based fallback.
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
from ..observability import model_span

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

    def __init__(self, kind: str, message: str = "", *, status: int | None = None) -> None:
        super().__init__(f"{kind}: {message}" if message else kind)
        self.kind = kind
        self.status = status


@dataclass(frozen=True)
class RawDecision:
    answers: dict[str, dict[str, Any]]
    model: str
    cost_usd: Decimal
    tokens: int
    ms: int


def _to_wire(questions: q.Questions) -> dict[str, dict[str, Any]]:
    """Vendor-neutral questions to the Decisions API wire format. Choice
    options and score levels both travel as ``criteria`` (a map and an
    ordered list); see docs/decisions/openrouter-contract.md."""
    out: dict[str, dict[str, Any]] = {}
    for name, question in questions.items():
        if isinstance(question, q.YesNo):
            out[name] = {"type": "noul", "instructions": question.instructions}
        elif isinstance(question, q.Choice):
            out[name] = {
                "type": "choice",
                "instructions": question.instructions,
                "criteria": dict(question.options),
            }
        else:
            out[name] = {
                "type": "score",
                "instructions": question.instructions,
                "criteria": list(question.levels),
            }
    return out


def _number(x: Any, what: str) -> float:
    # JSON numbers only: a string or a boolean is an unrecognised shape.
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        raise DecisionError("invalid", f"{what} is not a number")
    v = float(x)
    if v != v or v in (float("inf"), float("-inf")):
        raise DecisionError("invalid", f"{what} is not finite")
    return v


def _unit(x: Any, what: str) -> float:
    v = _number(x, what)
    if not 0.0 <= v <= 1.0:
        raise DecisionError("invalid", f"{what} out of range")
    return v


_WIRE_TYPE = {"yesno": "noul", "choice": "choice", "score": "score"}


def _from_wire(questions: q.Questions, answers: Any) -> dict[str, dict[str, Any]]:
    """Normalise the model's answers; a refused, missing or malformed answer
    fails the whole call (partial answers would let a table act on half a
    picture). Every answer must carry the ``type`` its question asked for.

    A score comes back as the expected level, from 0 to ``len(levels) - 1``.
    ``level`` keeps that value; ``score`` is the same position on a 0..1
    scale, which is what the tables read."""
    if not isinstance(answers, dict):
        raise DecisionError("invalid", "answers missing")
    out: dict[str, dict[str, Any]] = {}
    for name, question in questions.items():
        a = answers.get(name)
        if not isinstance(a, dict):
            raise DecisionError("invalid", f"no answer for {name!r}")
        if a.get("type") == "refusal":
            raise DecisionError("refused", f"the provider refused {name!r}")
        if a.get("type") != _WIRE_TYPE[question.type]:
            raise DecisionError("invalid", f"{name!r} is not a {_WIRE_TYPE[question.type]} answer")
        if isinstance(question, q.YesNo):
            out[name] = {"type": "yesno", "probability": _unit(a.get("noul"), name)}
        elif isinstance(question, q.Choice):
            choice = a.get("choice")
            if not isinstance(choice, str) or choice not in question.options:
                raise DecisionError("invalid", f"{name!r} chose an unknown option")
            confidence = _unit(a.get("confidence"), name)
            given = a.get("probabilities")
            if given is not None and not isinstance(given, dict):
                raise DecisionError("invalid", f"{name!r} has malformed probabilities")
            # An option the response gives no probability for reads as 0; with
            # no map at all the chosen option carries the confidence.
            probabilities: dict[str, float] = {}
            for option in question.options:
                if given is not None and option in given:
                    probabilities[option] = _unit(given[option], f"{name}.{option}")
                else:
                    probabilities[option] = confidence if given is None and option == choice else 0.0
            out[name] = {
                "type": "choice",
                "choice": choice,
                "confidence": confidence,
                "probabilities": probabilities,
            }
        else:
            top = len(question.levels) - 1
            level = _number(a.get("score"), name)
            if top < 1 or not 0.0 <= level <= top:
                raise DecisionError("invalid", f"{name!r} score out of range")
            out[name] = {
                "type": "score",
                "score": level / top,
                "level": level,
                "confidence": _unit(a.get("confidence"), name),
            }
    return out


def _tokens(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    total = 0
    for key in ("input_tokens", "output_tokens"):
        v = usage.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            total += int(v)
    return total


def _cost(body: dict[str, Any]) -> Decimal:
    usage = body.get("usage")
    raw = usage.get("cost") if isinstance(usage, dict) else None
    if raw is None:
        # An unpriced call can't be metered, so it isn't trusted either.
        raise DecisionError("no_cost", "response has no usage.cost")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise DecisionError("no_cost", "usage.cost is not a number")
    try:
        cost = Decimal(str(raw))
    except InvalidOperation as e:
        raise DecisionError("no_cost", "usage.cost is not a number") from e
    if not cost.is_finite() or cost < 0:
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
            # The status only: an error body can echo request content.
            raise DecisionError("http", str(resp.status_code), status=resp.status_code)
        try:
            body = resp.json()
        except ValueError as e:
            raise DecisionError("invalid", "body is not JSON") from e
        if not isinstance(body, dict):
            raise DecisionError("invalid", "body is not an object")
        answers = _from_wire(questions, body.get("answers"))
        cost = _cost(body)
        served = body.get("model")
        return RawDecision(
            answers=answers,
            model=served if isinstance(served, str) and served else model,
            cost_usd=cost,
            tokens=_tokens(body.get("usage")),
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


def _is_not_null_violation(e: BaseException) -> bool:
    """Postgres 23502, without importing the driver here."""
    return getattr(e, "sqlstate", None) == "23502" or type(e).__name__ == "NotNullViolationError"


async def ledger_context(user_id: str, *, ad_campaign_id: UUID | None = None) -> Any | None:
    """A niche-less ``SpendContext`` for a decision made outside a job (an
    ad campaign has no niche). It carries the user's global daily cap and
    the prepaid-credit gate, like any other call, and attributes the row to
    the campaign where the ledger can. None when it cannot be built (no
    database): the decision then runs unmetered rather than not at all, and
    says so in the log."""
    try:
        from .spend_context import default_context

        if ad_campaign_id is not None:
            try:
                return await default_context(
                    user_id=user_id, niche_id=None, job_id=None, ad_campaign_id=ad_campaign_id
                )
            except TypeError:
                pass  # a SpendContext without campaign attribution: meter by user only
        return await default_context(user_id=user_id, niche_id=None, job_id=None)
    except Exception as e:  # noqa: BLE001 — metering must not break a decision
        log.warning("decision ledger context unavailable", extra={"error": type(e).__name__})
        return None


def _model_down(e: DecisionError) -> bool:
    """Worth a second try on another model: the model did not answer at all.
    A bad request, an auth or credit problem and a malformed or refused
    answer are not: another model would not fix them, or must not paper
    over them."""
    if e.kind in ("timeout", "transport"):
        return True
    return e.kind == "http" and e.status is not None and (e.status in (408, 429) or e.status >= 500)


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
    is called, metered or logged.

    A point marked ``second_tier`` (batch scoring off the hot path only)
    gets one more try on the D0 model when its model is down. The answer is
    logged under the model that gave it."""
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
    models = [model_for(tier or spec.tier)]
    if spec.second_tier and model_for("D0") not in models:
        models.append(model_for("D0"))
    decision.model = models[0]
    t0 = time.monotonic()
    async with model_span(
        "chat",
        model=models[0],
        provider=PROVIDER,
        tenant_id=user_id,
        name=f"decision.{point.value}",
        attributes={"marketer.decision.point": point.value, "marketer.decision.mode": decision.mode, "marketer.decision.questions_version": spec.version},
    ) as call:
        if call.content_allowed:
            # The state is what the decision is about (masked on export); the
            # decision_log keeps only its hash.
            call.prompt(json.dumps({"state": state, "questions": _to_wire(questions)}, default=str))
        try:
            if spend is not None:
                await spend.ensure_can_spend(Decimal(q.CALL_ESTIMATE_USD))
            http = client or DecisionClient()
            for i, model in enumerate(models):
                decision.model = model
                try:
                    raw = await http.decide(state, questions, model=model, timeout_s=spec.timeout_s)
                    break
                except DecisionError as e:
                    if i + 1 == len(models) or not _model_down(e):
                        raise
                    log.info(
                        "decision second tier",
                        extra={"point": point.value, "failed_model": model, "reason": e.kind},
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
                    if _is_not_null_violation(e):
                        # A niche-less row on a ledger that still requires a
                        # niche. The call was made and is in decision_log with
                        # its cost; only the ledger row is missing.
                        log.warning(
                            "decision metering skipped: spend_ledger needs a nullable niche_id",
                            extra={"point": point.value, "cost_usd": str(raw.cost_usd)},
                        )
                    else:
                        # The ledger row is written before any cap re-check raises;
                        # a tripped cap sets the job's abort flag, so the next real
                        # stage stops. The decision itself stays valid.
                        log.warning("decision metering raised", extra={"error": type(e).__name__})
        call.response_model(decision.model)
        call.cost(decision.cost_usd)
        if decision.ok:
            call.usage(total_tokens=raw.tokens)
            call.completion(json.dumps(decision.answers, default=str))
        else:
            call.set("marketer.decision.error", (decision.error or "").split(":", 1)[0])
        # 1 when the rule-based fallback answered (docs/observability/braintrust.md, Scores).
        call.score("decision_fallback", 0.0 if decision.ok else 1.0)
    decision.latency_ms = int((time.monotonic() - t0) * 1000)
    return decision
