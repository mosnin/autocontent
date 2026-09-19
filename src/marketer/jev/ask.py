"""Public ``ask`` entry: Jev first, Qwen System One wrapper as fallback.

This is the only function most of marketer should call. It:

1. Prefers TypeSafe Jev when a key is configured (fast, calibrated).
2. Falls back to Qwen-via-OpenRouter answering the same primitives.
3. Logs spend when a SpendContext is provided.
4. Never raises just because one backend is missing — only when BOTH
   backends fail (or neither is configured).
"""
from __future__ import annotations

from decimal import Decimal

from ..logging import get_logger
from ..services.spend_context import SpendContext
from . import cache as ask_cache
from . import client as jev_client
from . import fallback as qwen_fallback
from .primitives import Questions, State, SystemOneResult

log = get_logger(__name__)


class DecisionUnavailable(RuntimeError):
    """Neither Jev nor the Qwen wrapper could answer."""


def available() -> bool:
    return jev_client.enabled() or qwen_fallback.fallback_enabled()


async def _log_spend(
    result: SystemOneResult,
    spend: SpendContext | None,
) -> None:
    if spend is None:
        return
    if result.backend == "jev":
        cost = jev_client.jev_cost(result.usage.input_tokens, result.usage.output_tokens)
        provider = jev_client.PROVIDER
        sku = f"jev:{result.model}"
    else:
        from ..services import openrouter

        model = openrouter.get_model(result.model)
        if model is not None:
            cost = openrouter.llm_cost(
                model, result.usage.input_tokens, result.usage.output_tokens
            )
        else:
            # Unknown Qwen id — still record tokens at DeepSeek-like cheap rates
            # so the ledger is never silent. Better than dropping the row.
            from decimal import Decimal as D

            cost = (
                D("0.10") * D(result.usage.input_tokens)
                + D("0.30") * D(result.usage.output_tokens)
            ) / D(1_000_000)
        provider = openrouter.PROVIDER
        sku = f"llm:{result.model}"
    await spend.log(
        provider=provider,
        sku=sku,
        units=Decimal(result.usage.input_tokens + result.usage.output_tokens),
        cost_usd=cost,
    )


async def ask(
    state: State,
    questions: Questions,
    *,
    spend: SpendContext | None = None,
    prefer: str = "jev",
    use_cache: bool = True,
) -> SystemOneResult:
    """Answer typed questions about ``state``.

    ``prefer`` is ``"jev"`` (default) or ``"qwen"``. The other backend is
    always the fallback. Spend is logged for whichever backend answered.
    Identical ``state`` + ``questions`` reuse a 5-minute LRU so retries
    and resume paths do not pay another 70–500ms (or a Qwen fallback).
    Cache hits do not re-log spend.
    """
    key = ask_cache.cache_key(state, questions, prefer) if use_cache else ""
    if use_cache:
        hit = ask_cache.get(key)
        if hit is not None:
            return hit
    errors: list[Exception] = []
    order = ("jev", "qwen") if prefer != "qwen" else ("qwen", "jev")
    for backend in order:
        try:
            if backend == "jev":
                if not jev_client.enabled():
                    continue
                result = await jev_client.system_one(state, questions)
            else:
                if not qwen_fallback.fallback_enabled():
                    continue
                result = await qwen_fallback.system_one_qwen(state, questions)
            await _log_spend(result, spend)
            if use_cache:
                ask_cache.put(key, result)
            return result
        except Exception as exc:  # noqa: BLE001 — try the other backend
            errors.append(exc)
            log.warning(
                "jev.ask.backend_failed",
                extra={"backend": backend, "error": str(exc)},
            )
    if errors:
        raise DecisionUnavailable(
            "no System One backend answered: " + "; ".join(str(e) for e in errors)
        )
    raise DecisionUnavailable(
        "neither TypeSafe Jev nor OpenRouter Qwen is configured"
    )
