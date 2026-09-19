"""Company knowledge brain — extract verbatim, classify, persist, inject.

Jev cannot generate knowledge sentences. Code slices the operator turn
into candidate spans; Jev only clusters them. Persistence and prompt
injection fail-open so a missing DB never blocks a job.
"""
from __future__ import annotations

import json
import re
from typing import Any

from ..jev.decisions import KnowledgeSpan, classify_knowledge_spans
from ..jev.primitives import State
from ..logging import get_logger
from ..repos import company_knowledge as knowledge_repo
from ..services.spend_context import SpendContext

log = get_logger(__name__)

_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_MIN_SPAN = 12
_MAX_SPAN = 400
_MAX_CANDIDATES = 8
_PROMPT_LIMIT = 12


def state_text(state: State | Any) -> str:
    """Flatten a route/pipeline state into searchable prose."""
    if isinstance(state, str):
        return state
    if isinstance(state, dict):
        parts: list[str] = []
        for value in state.values():
            if isinstance(value, str):
                parts.append(value)
            elif isinstance(value, (list, dict)):
                parts.append(json.dumps(value, default=str)[:800])
        return "\n".join(parts)
    return str(state)


def candidate_spans(text: str, *, limit: int = _MAX_CANDIDATES) -> list[str]:
    """Split source text into verbatim spans. Never rewrite."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in _SPLIT.split((text or "").strip()):
        span = raw.strip().strip("\"'")
        if _MIN_SPAN <= len(span) <= _MAX_SPAN and span.lower() not in seen:
            seen.add(span.lower())
            out.append(span)
        if len(out) >= limit:
            break
    return out


async def extract_constraints(
    state: State | Any,
    *,
    spend: SpendContext | None = None,
) -> list[KnowledgeSpan]:
    """Slice state, then let Jev cluster. Empty when nothing durable."""
    spans = candidate_spans(state_text(state))
    if not spans:
        return []
    try:
        return await classify_knowledge_spans(spans, spend=spend)
    except Exception as exc:  # noqa: BLE001 — brain is an upgrade
        log.warning("company_os.extract_failed", extra={"error": str(exc)})
        return []


async def capture_from_state(
    user_id: str,
    state: State | Any,
    *,
    source: str = "route",
    spend: SpendContext | None = None,
) -> list[dict[str, object]]:
    """Classify + persist. Returns the rows that landed (may be empty)."""
    extracted = await extract_constraints(state, spend=spend)
    written: list[dict[str, object]] = []
    for span in extracted:
        row = await knowledge_repo.insert(
            user_id,
            kind=span.kind,
            span=span.text,
            source=source,
            confidence=span.confidence,
            backend=span.backend,
        )
        if row is not None:
            written.append(row.model_dump(mode="json"))
    return written


async def prompt_block(user_id: str) -> str:
    """Latest durable spans as a writer-facing block. Empty on miss."""
    rows = await knowledge_repo.list_for_user(user_id, limit=_PROMPT_LIMIT)
    return knowledge_repo.as_prompt_block(rows)
