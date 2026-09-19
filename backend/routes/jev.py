"""Jev / System One surfaces for the web UI, SDK, and MCP.

Read-only status plus a small set of bounded decision endpoints. Every
write-adjacent call (ads, publish) still goes through the existing
fail-closed money path — this router only *judges*.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from typing import Any, TypeVar

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from marketer.company_os import capture_from_state, route_workspace
from marketer.config import settings
from marketer.jev import available, enabled
from marketer.jev.ask import DecisionUnavailable
from marketer.jev.ask import ask as jev_ask
from marketer.jev.client import choice, noul, score
from marketer.jev.decisions import (
    curate_asset,
    judge_ad_action,
    screen_content,
    verify_citation,
)
from marketer.jev.harness import auto_mode, default_generation_model, next_action, route_model
from marketer.jev.router import route_intent
from marketer.logging import get_logger
from marketer.repos import company_knowledge as knowledge_repo
from marketer.services import openrouter
from marketer.symbolic import assess as foreman_assess
from marketer.symbolic.jev_code import (
    check_changes,
    classify_request,
    find_relevant,
    triage_failures,
    triage_review,
)

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()
_JEV_LIMIT = "40/minute"
_ADS_LIMIT = "20/minute"
_KNOWLEDGE_LIMIT = "30/minute"
log = get_logger(__name__)

T = TypeVar("T")
_MAX_STATE_CHARS = 24_000
_MAX_QUESTIONS = 32


def _bounded_state(state: Any) -> Any:
    """Reject oversized payloads before they hit TypeSafe or the brain."""
    try:
        blob = json.dumps(state, default=str)
    except TypeError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="state is not JSON-serializable",
        ) from exc
    if len(blob) > _MAX_STATE_CHARS:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"state exceeds {_MAX_STATE_CHARS} characters",
        )
    return state


def _require_available() -> None:
    if not available():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Jev is not configured (need TYPESAFE or OpenRouter key)",
        )


async def _optional_spend(ctx: AuthCtx):
    """Ledger HTTP judges. Fail-open — a missing user row must not block."""
    try:
        from marketer.services.spend_context import default_context

        return await default_context(
            user_id=ctx.user_id, niche_id=None, job_id=None
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.spend_context_failed", extra={"error": str(exc)})
        return None


async def _run_decision(coro: Awaitable[T]) -> T:
    try:
        return await coro
    except DecisionUnavailable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        log.warning("jev.route.backend_error", extra={"error": str(exc)})
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="decision backend failed",
        ) from exc


class JevStatus(BaseModel):
    jev_enabled: bool
    typesafe_configured: bool
    qwen_fallback_configured: bool
    available: bool
    jev_model: str
    fallback_model: str
    default_generation_model: str
    voice_realtime_model: str
    voice_ready: bool


@router.get("/status", response_model=JevStatus)
async def jev_status(ctx: AuthCtx = CurrentUser) -> JevStatus:
    return JevStatus(
        jev_enabled=settings.jev_enabled,
        typesafe_configured=enabled(),
        qwen_fallback_configured=openrouter.enabled(),
        available=available(),
        jev_model=settings.jev_model,
        fallback_model=settings.jev_fallback_model,
        default_generation_model=default_generation_model(),
        voice_realtime_model=settings.voice_realtime_model,
        voice_ready=bool(settings.openai_api_key),
    )


class AskBody(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]] = Field(min_length=1, max_length=_MAX_QUESTIONS)

    @field_validator("state")
    @classmethod
    def _state_bound(cls, value: Any) -> Any:
        return _bounded_state(value)


def _coerce_questions(raw: dict[str, dict[str, Any]]) -> dict:
    out = {}
    for key, spec in raw.items():
        kind = spec.get("type")
        instructions = spec.get("instructions")
        if not isinstance(instructions, str) or not instructions.strip():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"question {key!r} needs instructions",
            )
        if kind == "noul":
            crit = spec.get("criteria")
            yes = crit.get("true") if isinstance(crit, dict) else None
            no = crit.get("false") if isinstance(crit, dict) else None
            out[key] = noul(instructions, yes=yes, no=no)
        elif kind == "choice":
            criteria = spec.get("criteria")
            if not isinstance(criteria, dict) or len(criteria) < 2:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"choice {key!r} needs ≥2 criteria",
                )
            out[key] = choice(instructions, criteria)
        elif kind == "score":
            criteria = spec.get("criteria")
            if not isinstance(criteria, list) or len(criteria) < 2:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"score {key!r} needs ≥2 levels",
                )
            out[key] = score(instructions, [str(x) for x in criteria])
        else:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"question {key!r} has unknown type {kind!r}",
            )
    return out


@router.post("/ask")
@limiter.limit(_JEV_LIMIT)
async def jev_ask_endpoint(
    request: Request, body: AskBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    result = await _run_decision(
        jev_ask(body.state, _coerce_questions(body.questions), spend=spend)
    )
    return result.as_serializable()


class StateBody(BaseModel):
    state: Any

    @field_validator("state")
    @classmethod
    def _state_bound(cls, value: Any) -> Any:
        return _bounded_state(value)


@router.post("/route")
@limiter.limit(_JEV_LIMIT)
async def jev_route(
    request: Request, body: StateBody, ctx: AuthCtx = CurrentUser
) -> dict:
    """Intent + company OS in parallel. Model tier rides on the intent fan-out."""
    _require_available()
    spend = await _optional_spend(ctx)
    intent, company = await asyncio.gather(
        _run_decision(route_intent(body.state, spend=spend)),
        _run_decision(route_workspace(body.state, spend=spend)),
    )
    if intent.model is not None:
        model = intent.model
    else:
        model = await _run_decision(route_model(body.state, spend=spend))
    knowledge: list[dict] = []
    if company.knowledge_write:
        try:
            knowledge = await capture_from_state(
                ctx.user_id, body.state, source="route"
            )
        except Exception as exc:  # noqa: BLE001 — brain never blocks routing
            log.warning("jev.route.knowledge_failed", extra={"error": str(exc)})
            knowledge = []
    return {
        "intent": {
            "kind": intent.kind,
            "skill": intent.skill,
            "urgency": intent.urgency,
            "confidence": intent.confidence,
            "gate": intent.gate,
            "backend": intent.backend,
        },
        "model": model.as_dict(),
        "company": company.as_dict(),
        "knowledge": knowledge,
    }


@router.get("/knowledge")
@limiter.limit(_KNOWLEDGE_LIMIT)
async def jev_knowledge(request: Request, ctx: AuthCtx = CurrentUser) -> dict:
    rows = await knowledge_repo.list_for_user(ctx.user_id, limit=40)
    return {
        "items": [r.model_dump(mode="json") for r in rows],
        "prompt_block": knowledge_repo.as_prompt_block(rows),
    }


class NextActionBody(BaseModel):
    state: Any
    targets: dict[str, str] = Field(max_length=32)

    @field_validator("state")
    @classmethod
    def _state_bound(cls, value: Any) -> Any:
        return _bounded_state(value)


@router.post("/next-action")
@limiter.limit(_JEV_LIMIT)
async def jev_next_action(
    request: Request, body: NextActionBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    action = await _run_decision(
        next_action(body.state, targets=body.targets, spend=spend)
    )
    return {
        "operation": action.operation,
        "target": action.target,
        "needs_generation": action.needs_generation,
        "confidence": action.confidence,
        "backend": action.backend,
    }


class AutoModeBody(BaseModel):
    tool: str = Field(default="unknown", max_length=64)
    state: Any = None

    @field_validator("state")
    @classmethod
    def _state_bound(cls, value: Any) -> Any:
        return _bounded_state(value if value is not None else {})


@router.post("/auto-mode")
@limiter.limit(_JEV_LIMIT)
async def jev_auto_mode(
    request: Request, body: AutoModeBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    decision = await _run_decision(
        auto_mode(body.state or {}, tool=body.tool, spend=spend)
    )
    return decision.as_dict()


@router.post("/screen")
@limiter.limit(_JEV_LIMIT)
async def jev_screen(
    request: Request, body: StateBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    v = await _run_decision(screen_content(body.state, spend=spend))
    return {
        "malicious": v.malicious,
        "jailbreak": v.jailbreak,
        "brand_safe": v.brand_safe,
        "block": v.block,
        "backend": v.backend,
    }


@router.post("/curate")
@limiter.limit(_JEV_LIMIT)
async def jev_curate(
    request: Request, body: StateBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    v = await _run_decision(curate_asset(body.state, spend=spend))
    return {
        "keep": v.keep,
        "cluster": v.cluster,
        "quality": v.quality,
        "backend": v.backend,
    }


@router.post("/ads/judge")
@limiter.limit(_ADS_LIMIT)
async def jev_ads_judge(
    request: Request, body: StateBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    v = await _run_decision(judge_ad_action(body.state, spend=spend))
    return {
        "action": v.action,
        "reason": v.reason,
        "confidence": v.confidence,
        "backend": v.backend,
    }


class CitationBody(BaseModel):
    claim: str = Field(max_length=4_000)
    source: str = Field(max_length=8_000)


@router.post("/citations/verify")
@limiter.limit(_JEV_LIMIT)
async def jev_citation(
    request: Request, body: CitationBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    return await _run_decision(
        verify_citation(body.claim, body.source, spend=spend)
    )


@router.post("/symbolic/foreman")
@limiter.limit(_JEV_LIMIT)
async def jev_foreman(
    request: Request, body: StateBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    return (await _run_decision(foreman_assess(body.state, spend=spend))).as_dict()


class SymbolicBody(BaseModel):
    workflow: str | None = Field(default=None, max_length=40)
    request: str = Field(default="", max_length=8_000)
    task: str = Field(default="", max_length=8_000)
    diff: str = Field(default="", max_length=_MAX_STATE_CHARS)
    rules: str = Field(default="", max_length=8_000)
    acceptance: str = Field(default="", max_length=4_000)
    log_text: str = Field(default="", max_length=_MAX_STATE_CHARS)
    comments: list[str] = Field(default_factory=list, max_length=32)
    candidates: list[dict[str, str]] = Field(default_factory=list, max_length=16)


@router.post("/symbolic/code")
@limiter.limit(_JEV_LIMIT)
async def jev_code(
    request: Request, body: SymbolicBody, ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    spend = await _optional_spend(ctx)
    workflow = body.workflow
    if not workflow and body.request:
        workflow = await _run_decision(classify_request(body.request, spend=spend))
    if workflow == "find":
        return (
            await _run_decision(
                find_relevant(body.task or body.request, body.candidates, spend=spend)
            )
        ).as_dict()
    if workflow == "triage_failures":
        return (
            await _run_decision(
                triage_failures(body.log_text or body.request, spend=spend)
            )
        ).as_dict()
    if workflow == "triage_review":
        return (
            await _run_decision(triage_review(body.comments, spend=spend))
        ).as_dict()
    return (
        await _run_decision(
            check_changes(
                body.task or body.request,
                body.diff,
                rules=body.rules,
                acceptance=body.acceptance,
                spend=spend,
            )
        )
    ).as_dict()
