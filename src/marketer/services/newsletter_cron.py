"""Newsletter digest generation and sending (Team Newsletters).

Wired into the nightly scheduler by the coordinator (modal_app.py's
press_growth_cron, hourly) as one of several independently fail-soft
growth scans. Must stay a cheap no-op when settings.newsletters_enabled is
False -- the scheduler calls run() unconditionally every hour.

For each user with newsletter_settings.enabled, run() checks two gates:
  1. cadence window elapsed since last_sent_at (weekly/biweekly/monthly),
  2. at least one 'done' article created since last_sent_at (never send an
     empty digest on cadence alone).
Both must hold before a digest is composed and sent. Each user is fully
isolated -- one user's LLM/email/DB failure must never stop the pass for
the rest.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..logging import get_logger

log = get_logger(__name__)

_CADENCE_DAYS: dict[str, int] = {"weekly": 7, "biweekly": 14, "monthly": 30}


def _cadence_elapsed(
    cadence: str, last_sent_at: datetime | None, *, now: datetime | None = None
) -> bool:
    """True when `cadence`'s window has elapsed since last_sent_at. A user
    who has never been sent a digest (last_sent_at is None) is always due
    -- the new-articles gate is what actually keeps a fresh signup quiet
    until they have something to send."""
    if last_sent_at is None:
        return True
    now = now or datetime.now(timezone.utc)
    days = _CADENCE_DAYS.get(cadence, 7)
    return now - last_sent_at >= timedelta(days=days)


async def _new_done_articles(user_id: str, since: datetime | None) -> list:
    """This user's 'done' articles created after `since` (or all of them,
    if `since` is None -- i.e. never sent). Reads articles read-only via
    the shared repo; this module never writes to articles."""
    from ..articles.models import ArticleStatus
    from ..repos import articles as articles_repo

    done = await articles_repo.list_for_user(user_id, status=ArticleStatus.done, limit=200)
    if since is None:
        return done
    return [a for a in done if a.created_at is not None and a.created_at > since]


async def run() -> dict:
    from ..config import settings

    if not settings.newsletters_enabled:
        return {"skipped": "disabled"}

    from ..repos import brand_kit as brand_kit_repo
    from ..repos import newsletters as newsletters_repo
    from ..repos import users as users_repo
    from ..repos.spend import SpendCapExceeded
    from .newsletter import compose, send
    from .spend_context import default_context

    sent = 0
    skipped = 0
    failed = 0

    for setting in await newsletters_repo.list_enabled_settings():
        try:
            if not _cadence_elapsed(setting.cadence, setting.last_sent_at):
                skipped += 1
                continue

            new_articles = await _new_done_articles(setting.user_id, setting.last_sent_at)
            if not new_articles:
                skipped += 1
                continue

            user = await users_repo.get(setting.user_id)
            if user is None:
                skipped += 1
                continue

            brand = await brand_kit_repo.get(setting.user_id)
            spend = await default_context(
                user_id=setting.user_id, niche_id=None, job_id=None, cap_usd=None
            )
            composed = await compose(user, new_articles, brand, spend=spend)

            digest = await newsletters_repo.create_digest(
                user_id=setting.user_id,
                subject=composed.subject,
                markdown=composed.markdown,
                html=composed.html,
                article_ids=composed.article_ids,
            )

            to = setting.send_to or user.email
            digest = await send(digest, to)

            if digest.status == "sent":
                await newsletters_repo.mark_sent_at(
                    setting.user_id, when=digest.sent_at or datetime.now(timezone.utc)
                )
                sent += 1
            else:
                failed += 1
        except SpendCapExceeded:
            failed += 1
        except Exception:  # noqa: BLE001 -- one user's failure must not stop the pass
            log.exception("newsletter_cron: failed for user %s", setting.user_id)
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}
