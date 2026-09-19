"""Product-loop adapters — the high-leverage wiring.

Library packs in ``decisions`` / ``harness`` / ``symbolic`` do nothing
until a pipeline calls them. Each helper here:

- no-ops when Jev is off or unconfigured (fail-open, same as ideation/QA)
- never relaxes an existing fail-closed guard
- returns a small verdict the caller already knows how to act on
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..logging import get_logger
from ..services.spend_context import SpendContext
from .ask import available
from .decisions import (
    audit_sources,
    curate_asset,
    grade_seo_metadata,
    rank_passages,
    screen_content,
    suggest_repurpose,
)
from .harness import auto_mode, next_action
from .primitives import State

log = get_logger(__name__)


def _live() -> bool:
    return bool(settings.jev_enabled) and available()


@dataclass
class LoopVerdict:
    park: bool = False
    fail: bool = False
    retry: bool = False
    hold: bool = False
    reason: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


async def after_content_qa(
    state: State,
    *,
    spend: SpendContext | None = None,
) -> LoopVerdict:
    """Foreman + outbound guardrail after a video/article QA pass.

    stop → fail the job (supervision, only when Jev actually answered).
    retry/steer → one bounded regenerate (caller enforces the bound).
    verify → park for a human.
    """
    out = LoopVerdict()
    if not _live():
        return out
    import asyncio

    async def _foreman():
        from ..symbolic.foreman import assess

        return await assess(state, spend=spend)

    foreman_res, screen_res = await asyncio.gather(
        _foreman(),
        screen_content(state, spend=spend),
        return_exceptions=True,
    )
    if isinstance(foreman_res, Exception):
        log.warning("jev.loops.foreman_failed", extra={"error": str(foreman_res)})
    else:
        out.payload["foreman"] = foreman_res.as_dict()
        if foreman_res.action == "stop":
            out.fail = True
            out.reason = "foreman stop: worker stuck or off-brief"
        elif foreman_res.action in {"retry", "steer"}:
            out.retry = True
            out.reason = f"foreman {foreman_res.action}"
        elif foreman_res.action == "verify":
            out.park = True
            out.reason = "foreman verify: needs a human look"
    if isinstance(screen_res, Exception):
        log.warning("jev.loops.screen_failed", extra={"error": str(screen_res)})
    else:
        out.payload["screen"] = {
            "malicious": screen_res.malicious,
            "jailbreak": screen_res.jailbreak,
            "brand_safe": screen_res.brand_safe,
            "block": screen_res.block,
            "backend": screen_res.backend,
        }
        if screen_res.block and not out.fail and not out.retry:
            out.park = True
            out.reason = out.reason or "content screen blocked publish"
    return out


async def publish_gate(
    state: State,
    *,
    tool: str = "schedule_post",
    human_approved: bool = False,
    spend: SpendContext | None = None,
) -> LoopVerdict:
    """LangChain Auto Mode on the publish tool.

    Autonomous path: block/confirm parks for a human (never silently posts).
    Human-approved path: block fails closed — the operator already said go,
    so a high-confidence risk refuses rather than posting.
    """
    out = LoopVerdict()
    if not _live():
        return out
    try:
        decision = await auto_mode(state, tool=tool, spend=spend)
        out.payload["auto_mode"] = decision.as_dict()
        if decision.verdict == "allow":
            return out
        out.reason = f"auto-mode {decision.verdict} on {tool}"
        if human_approved and decision.verdict == "block":
            out.fail = True
        else:
            out.park = True
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.publish_gate_failed", extra={"error": str(exc)})
    return out


async def campaign_tick_gate(
    state: State,
    *,
    targets: dict[str, str],
    spend: SpendContext | None = None,
) -> LoopVerdict:
    """Ultrafast next_action: HOLD / BLOCKED / ROUTE_HUMAN / DONE skip the tick."""
    out = LoopVerdict()
    if not _live() or len(targets) < 1:
        return out
    try:
        action = await next_action(state, targets=targets, spend=spend)
        out.payload["next_action"] = {
            "operation": action.operation,
            "target": action.target,
            "confidence": action.confidence,
            "backend": action.backend,
        }
        if action.operation in {"HOLD", "BLOCKED", "ROUTE_HUMAN", "DONE"}:
            out.hold = True
            out.reason = f"next_action {action.operation}"
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.campaign_gate_failed", extra={"error": str(exc)})
    return out


async def filter_research_pages(
    query: str,
    pages: list[dict[str, Any]],
    *,
    spend: SpendContext | None = None,
) -> list[dict[str, Any]]:
    """jev-search retrieve-then-judge. Empty rank falls back to the Exa list."""
    if not _live() or len(pages) < 2:
        return pages
    try:
        safe: list[dict[str, str]] = []
        for p in pages:
            highlights = p.get("highlights") or []
            highlight_text = (
                " ".join(str(h) for h in highlights)
                if isinstance(highlights, list)
                else str(highlights)
            )
            safe.append(
                {
                    "title": str(p.get("title") or ""),
                    "url": str(p.get("url") or ""),
                    "domain": str(p.get("domain") or ""),
                    "excerpt": str(p.get("excerpt") or highlight_text),
                }
            )
        ranked = await rank_passages(query, safe, spend=spend)
        if not ranked:
            return pages
        keep = {str(r.get("url") or "") for r in ranked}
        filtered = [p for p in pages if str(p.get("url") or "") in keep]
        return filtered or pages
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.rank_passages_failed", extra={"error": str(exc)})
        return pages


async def source_audit_notes(
    article_md: str,
    pages: list[dict[str, Any]],
    *,
    spend: SpendContext | None = None,
) -> list[str]:
    if not _live() or not pages:
        return []
    from .grounding import extract_claim_sentences

    if not extract_claim_sentences(article_md):
        return []
    try:
        passages = [
            {
                "domain": str(p.get("domain") or ""),
                "url": str(p.get("url") or ""),
                "text": " ".join(p.get("highlights") or []) or str(p.get("excerpt") or ""),
            }
            for p in pages[:4]
        ]
        passages = [p for p in passages if p["text"]]
        return await audit_sources(article_md, passages, spend=spend)
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.audit_sources_failed", extra={"error": str(exc)})
        return []


async def source_audit_penalty(
    article_md: str,
    pages: list[dict[str, Any]],
    *,
    spend: SpendContext | None = None,
) -> tuple[list[str], float]:
    """Citation-verifier notes plus the quality-score drop they imply."""
    from .grounding import audit_penalty

    notes = await source_audit_notes(article_md, pages, spend=spend)
    return notes, audit_penalty(notes)


async def seo_metadata_notes(
    *,
    title: str,
    meta_description: str,
    focus_keyword: str,
    article_excerpt: str,
    spend: SpendContext | None = None,
) -> list[str]:
    if not _live():
        return []
    from ..articles.fastpath import metadata_is_publishable

    if metadata_is_publishable(title, meta_description, focus_keyword):
        return []
    try:
        verdict = await grade_seo_metadata(
            title=title,
            meta_description=meta_description,
            focus_keyword=focus_keyword,
            article_excerpt=article_excerpt,
            spend=spend,
        )
        return verdict.notes
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.seo_grade_failed", extra={"error": str(exc)})
        return []


async def should_index_asset(
    state: State,
    *,
    spend: SpendContext | None = None,
) -> bool:
    """jev-curate: skip library indexing when Jev says discard. Default keep."""
    if not _live():
        return True
    try:
        verdict = await curate_asset(state, spend=spend)
        return verdict.keep
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.curate_failed", extra={"error": str(exc)})
        return True


async def repurpose_hint(
    state: State,
    *,
    spend: SpendContext | None = None,
) -> dict[str, Any] | None:
    if not _live():
        return None
    try:
        v = await suggest_repurpose(state, spend=spend)
        return {"target": v.target, "confidence": v.confidence, "backend": v.backend}
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.repurpose_failed", extra={"error": str(exc)})
        return None


def should_spawn_repurpose(
    hint: dict[str, Any] | None, *, min_confidence: float = 0.7
) -> bool:
    """High-confidence article remix only — other targets stay as hints."""
    if not hint:
        return False
    try:
        confidence = float(hint.get("confidence") or 0)
    except (TypeError, ValueError):
        return False
    return hint.get("target") == "article" and confidence >= min_confidence


async def enrich_failure_rows(
    rows: list[dict[str, Any]],
    *,
    spend: SpendContext | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """jev-code triage_failures over the newest inbox rows (one fan-out)."""
    if not _live() or not rows:
        return rows
    slice_ = rows[:limit]
    try:
        from ..symbolic.jev_code import triage_failures

        blob = "\n".join(
            f"[{i}] {r.get('kind')} {r.get('error') or ''}" for i, r in enumerate(slice_)
        )
        report = await triage_failures(blob, spend=spend)
        finding = report.findings[0] if report.findings else {}
        # One log-level triage applies to the batch; per-row class stays
        # the deterministic classifier. We attach the Jev overlay.
        for row in slice_:
            row["jev_class"] = finding.get("class")
            row["jev_actionable"] = finding.get("actionable")
            row["jev_severity"] = finding.get("severity")
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.failure_triage_failed", extra={"error": str(exc)})
    return rows
