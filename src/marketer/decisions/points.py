"""Per-point glue: build the state, call the model, apply the truth table under
the point's mode, log, and return what the pipeline should do.

Every function here is safe to call unconditionally from a pipeline:

- mode ``off`` (no key, or switched off): no call, no log, today's behaviour.
- mode ``shadow`` (the default with a key): call and log the table's choice,
  then act on today's rule.
- mode ``enforce``: act on the table, which can only tighten.
- a failed call in any mode: today's rule (the point's fallback), logged with
  ``fallback_used``.

Nothing here raises on a model or log failure. Spend-cap breaches raised by
the pipeline's own stages are untouched.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable
from uuid import UUID

from ..logging import get_logger
from ..services import decisions as svc
from . import keyframes as kf
from . import questions as q
from . import tables

log = get_logger(__name__)


def _clip(text: str | None, limit: int = q.MAX_CONTEXT_CHARS) -> str:
    text = text or ""
    return text if len(text) <= limit else text[:limit]


# ---------------------------------------------------------------------------
# Point 3: what to post next (ideation). Fails open to the judge's pick.
# ---------------------------------------------------------------------------


async def score_ideas(
    candidates: list[Any],
    *,
    niche_title: str,
    niche_description: str = "",
    target_audience: str = "",
    platform: str = "",
    recent_topics: list[str] | None = None,
    performance_context: str = "",
    spend: Any = None,
) -> tuple[svc.Decision, list[int]]:
    """Ask the per-candidate questions. Returns the decision and the table's
    ranking (empty when the call failed or every candidate dropped)."""
    n = len(candidates)
    state = {
        "niche": {"title": niche_title, "about": _clip(niche_description), "platform": platform},
        "audience": target_audience,
        "candidates": [
            {"topic": c.topic, "angle": c.angle, "hook": c.hook} for c in candidates
        ],
        "recent_topics": list(recent_topics or [])[:30],
        "recent_performance": _clip(performance_context),
    }
    tier: q.Tier = "D0" if n > q.D0_CANDIDATE_THRESHOLD else "D1"
    decision = await svc.decide(
        q.Point.WHAT_TO_POST,
        state,
        q.what_to_post_questions(n) if n >= 2 else {},
        user_id=getattr(spend, "user_id", None),
        spend=spend,
        subject_kind="job",
        subject_id=getattr(spend, "job_id", None),
        tier=tier,
    )
    ranking = tables.rank_candidates(decision.answers, n) if decision.ok else []
    return decision, ranking


async def pick_idea(scored: Awaitable[tuple[svc.Decision, list[int]]], judge_index: int) -> int:
    """The index ideation should return: the table's top pick in enforce, the
    judge's pick otherwise (and whenever every candidate dropped)."""
    try:
        decision, ranking = await scored
    except Exception:  # noqa: BLE001 — ranking is an upgrade, never a failure mode
        return judge_index
    table_pick = ranking[0] if ranking else None
    chosen = table_pick if (decision.enforce and table_pick is not None) else judge_index
    await decision.log(
        action=f"pick:{chosen}",
        rule_action=f"pick:{judge_index}",
        table_action=None if not decision.ok else (
            f"pick:{table_pick}" if table_pick is not None else "none"
        ),
        fallback_used=not decision.ok or (decision.enforce and table_pick is None),
    )
    return chosen


# ---------------------------------------------------------------------------
# Point 4: score a hook before spending. Fails open to "proceed".
# ---------------------------------------------------------------------------


def banned_word_hit(text: str, banned_words: list[str]) -> bool:
    lowered = text.lower()
    for w in banned_words:
        w = (w or "").strip().lower()
        if w and re.search(rf"(?<!\w){re.escape(w)}(?!\w)", lowered):
            return True
    return False


def hook_word_count_ok(hook: str) -> bool:
    from ..evals.script_checks import HOOK_MAX_WORDS

    return len(hook.split()) <= HOOK_MAX_WORDS


RewriteFn = Callable[[Any], Awaitable[Any]]


async def gate_hook(
    script: Any,
    *,
    niche_title: str,
    target_audience: str,
    brand_rules: list[str],
    banned_words: list[str],
    rewrite: RewriteFn,
    spend: Any = None,
) -> tuple[Any, str]:
    """Judge the hook after the scriptwriter, before any visual or TTS spend.

    Returns ``(script, action)`` with action ``proceed``, ``regenerated`` or
    ``hold``. Only enforce can hold or regenerate; a regeneration happens at
    most once and is kept only if it passes the code checks."""
    scene0 = script.scenes[0].narration if script.scenes else ""
    hook = script.idea.hook
    rules = list(brand_rules)[: q.MAX_BRAND_RULES]
    state = {
        "hook": hook,
        "scene0": scene0,
        "niche": niche_title,
        "audience": target_audience,
        "hook_word_count": len(hook.split()),  # a fact computed in code
        **({"brand_rules": rules} if rules else {}),
    }
    decision = await svc.decide(
        q.Point.HOOK_SCORE,
        state,
        q.hook_questions(has_brand_rules=bool(rules)),
        user_id=getattr(spend, "user_id", None),
        spend=spend,
        subject_kind="job",
        subject_id=getattr(spend, "job_id", None),
    )
    if not decision.ok:
        await decision.log(action="proceed", rule_action="proceed")
        return script, "proceed"

    table_action = tables.hook_action(
        decision.answers,
        word_count_ok=hook_word_count_ok(hook),
        banned_word_hit=banned_word_hit(f"{hook}\n{scene0}", banned_words),
    )
    action = "proceed"
    if decision.enforce and table_action == "hold":
        action = "hold"
    elif decision.enforce and table_action == "regenerate":
        try:
            rewritten = await rewrite(script)
        except Exception as e:  # noqa: BLE001 — a failed rewrite keeps the original
            from ..repos.spend import SpendCapExceeded

            if isinstance(e, SpendCapExceeded):
                await decision.log(action="proceed", rule_action="proceed", table_action=table_action)
                raise
            rewritten = None
        new_hook = getattr(getattr(rewritten, "idea", None), "hook", "") if rewritten else ""
        if (
            rewritten is not None
            and new_hook
            and hook_word_count_ok(new_hook)
            and not banned_word_hit(
                f"{new_hook}\n{rewritten.scenes[0].narration if rewritten.scenes else ''}",
                banned_words,
            )
        ):
            script, action = rewritten, "regenerated"
    await decision.log(action=action, rule_action="proceed", table_action=table_action)
    return script, action


# ---------------------------------------------------------------------------
# Point 5: budget shifts. Judgment only; fails closed to today's rule.
# ---------------------------------------------------------------------------


def _ratio(num: Decimal, den: Decimal) -> float | None:
    return None if den <= 0 else float(num / den)


def budget_state(
    campaign: Any, metrics: list[Any], *, recent_changes: list[dict], creative_age_days: list[int]
) -> dict:
    """Facts computed in code: CTR, CVR and ROAS per day. The model sees the
    numbers; it never computes or proposes one."""
    daily = []
    for m in sorted(metrics, key=lambda m: m.date):
        clicks = Decimal(m.clicks)
        daily.append(
            {
                "date": m.date.isoformat(),
                "spend_usd": str(m.spend_usd),
                "impressions": m.impressions,
                "clicks": m.clicks,
                "conversions": str(m.conversions),
                "revenue_usd": str(m.revenue_usd),
                "ctr": _ratio(clicks, Decimal(m.impressions)),
                "cvr": _ratio(Decimal(m.conversions), clicks),
                "roas": _ratio(m.revenue_usd, m.spend_usd),
            }
        )
    return {
        "campaign": getattr(campaign, "name", "") or "",
        "daily": daily,
        "recent_changes": recent_changes,
        "creative_age_days": creative_age_days,
    }


async def _budget_context(user_id: str, campaign_id: UUID) -> tuple[list[dict], list[int]]:
    """Recent change log and creative ages. Best-effort: missing context is
    stated as empty rather than blocking the judgment."""
    today = date.today()
    changes: list[dict] = []
    ages: list[int] = []
    try:
        from ..repos import ad_actions as ad_actions_repo

        for a in await ad_actions_repo.list_(
            user_id=user_id, target_id=str(campaign_id), limit=10
        ):
            changes.append(
                {
                    "action": a.action,
                    "days_ago": (today - a.created_at.date()).days,
                    "dollar_delta_usd": str(a.dollar_delta_usd),
                }
            )
    except Exception:  # noqa: BLE001
        pass
    try:
        from ..repos import ads as ads_repo

        now = datetime.now(timezone.utc)
        for c in await ads_repo.list_creatives(user_id, campaign_id=campaign_id):
            ages.append((now - c.created_at).days)
    except Exception:  # noqa: BLE001
        pass
    return changes, ages


async def _alert_tracking_break(user_id: str, campaign: Any) -> None:
    """Tell a person tracking looks broken. Fail-open, honours the user's
    email preference; the decision_log row and the warning line remain."""
    name = getattr(campaign, "name", "") or str(getattr(campaign, "id", ""))
    log.warning("ad tracking looks broken; budget change held", extra={"campaign": name})
    try:
        from ..repos import users as users_repo
        from ..services import email as email_svc

        user = await users_repo.get(user_id)
        if user is None or not user.email or not user.email_notifications:
            return
        await email_svc.send_email(
            to=user.email,
            subject="Ad tracking may be broken: budget change held",
            html=(
                "<p>Conversions dropped to near zero while spend continued on "
                f"campaign <strong>{_escape(name)}</strong>. Marketer did not change its "
                "budget. Check the conversion tracking before approving any change.</p>"
            ),
        )
    except Exception:  # noqa: BLE001
        pass


def _escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def judge_budget_change(
    *, user_id: str, campaign: Any, metrics: list[Any]
) -> str:
    """Called only when today's rule wants to propose a budget change.
    Returns ``rule`` (propose as today), ``hold_alert`` (no change, person
    alerted) or ``creative_refresh`` (no budget change, refresh suggested).
    Only enforce returns anything but ``rule``; a failed call is ``rule``,
    which is still guarded and approval-gated downstream."""
    if await svc.resolve_mode(q.Point.BUDGET_SHIFT) == "off":
        return "rule"
    changes, ages = await _budget_context(user_id, campaign.id)
    state = budget_state(campaign, metrics, recent_changes=changes, creative_age_days=ages)
    decision = await svc.decide(
        q.Point.BUDGET_SHIFT,
        state,
        q.BUDGET_QUESTIONS_V1,
        user_id=user_id,
        # An ad campaign has no niche: the call is metered on a niche-less
        # ledger row, under the user's global cap and credit balance.
        spend=await svc.ledger_context(user_id, ad_campaign_id=campaign.id),
        subject_kind="ad_campaign",
        subject_id=campaign.id,
    )
    if not decision.ok:
        await decision.log(action="rule", rule_action="rule")
        return "rule"
    table_action = tables.budget_action(decision.answers)
    action = table_action if decision.enforce else "rule"
    await decision.log(action=action, rule_action="rule", table_action=table_action)
    if action == "hold_alert":
        await _alert_tracking_break(user_id, campaign)
    return action


# ---------------------------------------------------------------------------
# Point 9: QA verify. Fails closed to today's QA (which still gates).
# ---------------------------------------------------------------------------


async def _verify(
    point: q.Point,
    state: dict,
    checks: dict[str, q.Check],
    *,
    grounded: q.Choice | None,
    rule_passed: bool,
    user_id: str | None,
    spend: Any,
    subject_kind: str,
    subject_id: Any,
) -> list[str] | None:
    decision = await svc.decide(
        point,
        state,
        q.verify_questions(checks, grounded=grounded),
        user_id=user_id,
        spend=spend,
        subject_kind=subject_kind,
        subject_id=subject_id,
    )
    rule_action = "pass" if rule_passed else "fail"
    if not decision.ok:
        await decision.log(action=rule_action, rule_action=rule_action)
        return None
    verdict = tables.verify(decision.answers, checks, grounded_asked=grounded is not None)
    table_action = "pass" if verdict.passed else "bounce"
    bounce = decision.enforce and not verdict.passed
    await decision.log(
        action="bounce" if bounce else rule_action,
        rule_action=rule_action,
        table_action=table_action,
    )
    return verdict.failures if bounce else None


async def verify_video(
    *,
    script: Any,
    transcript: str,
    niche_title: str,
    brand_rules: list[str],
    rule_passed: bool,
    spend: Any = None,
    video_path: Any = None,
    keyframes: list[bytes] | None = None,
) -> list[str] | None:
    """Failed check names when enforce bounces the video, else None.

    With ``video_path`` (or ready ``keyframes``, PNG or JPEG bytes) the model
    also looks at a few frames and one more check is asked: garbled,
    misspelled or unreadable on-screen text. No frames, no extra check."""
    rules = list(brand_rules)[: q.MAX_BRAND_RULES]
    frames: list[dict] = []
    if kf.enabled() and (keyframes or video_path is not None):
        # Sampling costs an ffmpeg run, so not when the point is off.
        if await svc.resolve_mode(q.Point.QA_VIDEO) != "off":
            frames = kf.image_parts(keyframes or await kf.sample_async(video_path))
    state = {
        "script": {
            "hook": script.idea.hook,
            "angle": script.idea.angle,
            "narration": [s.narration for s in script.scenes],
        },
        "transcript": _clip(transcript, q.MAX_DRAFT_CHARS),
        "niche": niche_title,
        **({"brand_rules": rules} if rules else {}),
        **({"keyframes": frames} if frames else {}),
    }
    return await _verify(
        q.Point.QA_VIDEO,
        state,
        q.video_checks(rules, has_keyframes=bool(frames)),
        grounded=None,
        rule_passed=rule_passed,
        user_id=getattr(spend, "user_id", None),
        spend=spend,
        subject_kind="job",
        subject_id=getattr(spend, "job_id", None),
    )


async def verify_article(
    *,
    markdown: str,
    focus_keyword: str,
    research: Any,
    brand_rules: list[str],
    rule_passed: bool,
    spend: Any = None,
) -> list[str] | None:
    """Failed check names when enforce bounces the article, else None.
    Grounding is only asked when there is research to ground against."""
    rules = list(brand_rules)[: q.MAX_BRAND_RULES]
    has_research = bool(getattr(research, "topResults", None))
    state: dict = {
        "draft": _clip(markdown, q.MAX_DRAFT_CHARS),
        "focus_keyword": focus_keyword,
        **({"brand_rules": rules} if rules else {}),
    }
    if has_research:
        state["research"] = _clip(
            json.dumps(research.model_dump(), default=str), q.MAX_CONTEXT_CHARS * 4
        )
    return await _verify(
        q.Point.QA_ARTICLE,
        state,
        q.article_checks(rules),
        grounded=q.ARTICLE_GROUNDED if has_research else None,
        rule_passed=rule_passed,
        user_id=getattr(spend, "user_id", None),
        spend=spend,
        subject_kind="article",
        subject_id=getattr(spend, "article_id", None),
    )


def start(coro: Awaitable[Any]) -> asyncio.Task:
    """Run a scoring call alongside other work (e.g. the ideation judge)."""
    return asyncio.ensure_future(coro)
