"""Jev / System One surfaces for the web UI, SDK, and MCP.

Read-only status plus a small set of bounded decision endpoints. Every
write-adjacent call (ads, publish) still goes through the existing
fail-closed money path — this router only *judges*.
"""
from __future__ import annotations

import json
from collections.abc import Awaitable
from typing import Any, TypeVar

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from marketer.company_os import capture_from_state, route_workspace
from marketer.config import settings
from marketer.logging import get_logger
from marketer.repos import company_knowledge as knowledge_repo
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

router = APIRouter()
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


async def _run_decision(coro: Awaitable[T]) -> T:
    try:
        return await coro
    except DecisionUnavailable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


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
async def jev_ask_endpoint(body: AskBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    result = await _run_decision(jev_ask(body.state, _coerce_questions(body.questions)))
    return result.as_serializable()


class StateBody(BaseModel):
    state: Any

    @field_validator("state")
    @classmethod
    def _state_bound(cls, value: Any) -> Any:
        return _bounded_state(value)


@router.post("/route")
async def jev_route(body: StateBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    intent = await _run_decision(route_intent(body.state))
    model = await _run_decision(route_model(body.state))
    company = await _run_decision(route_workspace(body.state))
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
async def jev_knowledge(ctx: AuthCtx = CurrentUser) -> dict:
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
async def jev_next_action(body: NextActionBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    action = await _run_decision(next_action(body.state, targets=body.targets))
    return {
        "operation": action.operation,
        "target": action.target,
        "needs_generation": action.needs_generation,
        "confidence": action.confidence,
        "backend": action.backend,
    }


@router.post("/auto-mode")
async def jev_auto_mode(
    body: dict[str, Any], ctx: AuthCtx = CurrentUser
) -> dict:
    _require_available()
    tool = str(body.get("tool") or "unknown")
    state = body.get("state") or {}
    decision = await _run_decision(auto_mode(state, tool=tool))
    return decision.as_dict()


@router.post("/screen")
async def jev_screen(body: StateBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    v = await _run_decision(screen_content(body.state))
    return {
        "malicious": v.malicious,
        "jailbreak": v.jailbreak,
        "brand_safe": v.brand_safe,
        "block": v.block,
        "backend": v.backend,
    }


@router.post("/curate")
async def jev_curate(body: StateBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    v = await _run_decision(curate_asset(body.state))
    return {
        "keep": v.keep,
        "cluster": v.cluster,
        "quality": v.quality,
        "backend": v.backend,
    }


@router.post("/ads/judge")
async def jev_ads_judge(body: StateBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    v = await _run_decision(judge_ad_action(body.state))
    return {
        "action": v.action,
        "reason": v.reason,
        "confidence": v.confidence,
        "backend": v.backend,
    }


class CitationBody(BaseModel):
    claim: str
    source: str


@router.post("/citations/verify")
async def jev_citation(body: CitationBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    return await _run_decision(verify_citation(body.claim, body.source))


@router.post("/symbolic/foreman")
async def jev_foreman(body: StateBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    return (await _run_decision(foreman_assess(body.state))).as_dict()


class SymbolicBody(BaseModel):
    workflow: str | None = None
    request: str = ""
    task: str = ""
    diff: str = ""
    rules: str = ""
    acceptance: str = ""
    log_text: str = ""
    comments: list[str] = Field(default_factory=list)
    candidates: list[dict[str, str]] = Field(default_factory=list)


@router.post("/symbolic/code")
async def jev_code(body: SymbolicBody, ctx: AuthCtx = CurrentUser) -> dict:
    _require_available()
    workflow = body.workflow
    if not workflow and body.request:
        workflow = await _run_decision(classify_request(body.request))
    if workflow == "find":
        return (await _run_decision(find_relevant(body.task or body.request, body.candidates))).as_dict()
    if workflow == "triage_failures":
        return (await _run_decision(triage_failures(body.log_text or body.request))).as_dict()
    if workflow == "triage_review":
        return (await _run_decision(triage_review(body.comments))).as_dict()
    return (
        await _run_decision(
            check_changes(
                body.task or body.request,
                body.diff,
                rules=body.rules,
                acceptance=body.acceptance,
            )
        )
    ).as_dict()
