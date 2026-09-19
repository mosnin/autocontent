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
    try:
        from ..symbolic.foreman import assess

        foreman = await assess(state, spend=spend)
        out.payload["foreman"] = foreman.as_dict()
        if foreman.action == "stop":
            out.fail = True
            out.reason = "foreman stop: worker stuck or off-brief"
            return out
        if foreman.action in {"retry", "steer"}:
            out.retry = True
            out.reason = f"foreman {foreman.action}"
            return out
        if foreman.action == "verify":
            out.park = True
            out.reason = "foreman verify: needs a human look"
            return out
    except Exception as exc:  # noqa: BLE001 — Foreman is an upgrade
        log.warning("jev.loops.foreman_failed", extra={"error": str(exc)})
    try:
        safety = await screen_content(state, spend=spend)
        out.payload["screen"] = {
            "malicious": safety.malicious,
            "jailbreak": safety.jailbreak,
            "brand_safe": safety.brand_safe,
            "block": safety.block,
            "backend": safety.backend,
        }
        if safety.block:
            out.park = True
            out.reason = "content screen blocked publish"
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.loops.screen_failed", extra={"error": str(exc)})
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
