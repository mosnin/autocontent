"""Company knowledge brain — verbatim spans only, never generated prose.

Writes and reads fail-open: a missing DB, a pending migration, or a
pool error must never block a video, article, or route call. The brain
seasons prompts; it is never a reason work cannot run.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..logging import get_logger

log = get_logger(__name__)

ALLOWED_KINDS = frozenset({"brand_rule", "constraint", "decision", "audience"})


class KnowledgeRow(BaseModel):
    id: str = ""
    kind: str
    span: str
    source: str = ""
    confidence: float = 0.0
    backend: str = ""
    created_at: datetime | None = None


_COLS = "id, kind, span, source, confidence, backend, created_at"


def _row(row) -> KnowledgeRow:
    d = dict(row)
    d["id"] = str(d.get("id") or "")
    return KnowledgeRow(**d)


async def insert(
    user_id: str,
    *,
    kind: str,
    span: str,
    source: str = "",
    confidence: float = 0.0,
    backend: str = "",
) -> KnowledgeRow | None:
    if kind not in ALLOWED_KINDS:
        return None
    text = (span or "").strip()
    if not text or len(text) > 800:
        return None
    try:
        from ..db import get_pool

        pool = await get_pool()
        existing = await pool.fetchrow(
            f"""
            select {_COLS} from company_knowledge
             where user_id = $1 and lower(span) = lower($2)
             limit 1
            """,
            user_id, text,
        )
        if existing:
            return _row(existing)
        try:
            row = await pool.fetchrow(
                f"""
                insert into company_knowledge
                    (user_id, kind, span, source, confidence, backend)
                values ($1, $2, $3, $4, $5, $6)
                returning {_COLS}
                """,
                user_id, kind, text, source[:400], confidence, backend[:80],
            )
            return _row(row) if row else None
        except Exception as race:  # noqa: BLE001 — concurrent duplicate after 0027
            if type(race).__name__ != "UniqueViolationError":
                raise
            raced = await pool.fetchrow(
                f"""
                select {_COLS} from company_knowledge
                 where user_id = $1 and lower(span) = lower($2)
                 limit 1
                """,
                user_id, text,
            )
            return _row(raced) if raced else None
    except Exception as exc:  # noqa: BLE001 — knowledge never blocks
        log.warning("company_knowledge.insert_failed", extra={"error": str(exc)})
        return None


async def list_for_user(user_id: str, *, limit: int = 24) -> list[KnowledgeRow]:
    try:
        from ..db import get_pool

        pool = await get_pool()
        rows = await pool.fetch(
            f"""
            select {_COLS} from company_knowledge
             where user_id = $1
             order by created_at desc
             limit $2
            """,
            user_id, max(1, min(limit, 100)),
        )
        return [_row(r) for r in rows]
    except Exception as exc:  # noqa: BLE001
        log.warning("company_knowledge.list_failed", extra={"error": str(exc)})
        return []


def as_prompt_block(rows: list[KnowledgeRow]) -> str:
    """Render stored spans as a compact markdown block for writers.

    Spans are verbatim. We never rewrite them.
    """
    if not rows:
        return ""
    lines: list[str] = []
    for row in rows:
        if row.kind not in ALLOWED_KINDS or not row.span.strip():
            continue
        lines.append(f"- [{row.kind}] {row.span.strip()}")
    if not lines:
        return ""
    return (
        "Company knowledge (verbatim constraints — follow these, do not "
        "paraphrase away):\n" + "\n".join(lines)
    )
