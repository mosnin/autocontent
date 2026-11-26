"""Publish articles to the workspace's WordPress site, through the rails.

Every send is the HIGH action ``content.article.publish``
(``rails/actions.py``), dispatched through ``enforce_dispatch``: kill switch
(``publish`` scope), unresolved unknown outcome on the article, idempotency
key, and an execution record whose outcome is succeeded, failed or
indeterminate. An indeterminate send becomes a Required Action in the
inbox and is never retried on its own.

Who may do what:

- A person with ``content:publish`` may send a draft, publish live now, or
  schedule a live publish. Clicking publish is the person's approval.
- The agent may send drafts only. Publishing live, now or scheduled, needs a
  person (403), like the other loosenings the agent is refused outright.

Scheduled publishes are bound to the article as it was when scheduled: the
canonical hash of what will be sent (content, metadata, cover, site, mode)
is stored, and at send time it is recomputed and checked as an approval
binding. If the article changed, nothing is sent and it waits for a person
(``needs_review``).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from ..logging import get_logger
from ..rails import ApprovalBinding, OutcomeUnknown, RailsDenied, args_hash, enforce_dispatch
from ..repos import article_seo
from ..repos import articles as articles_repo
from ..repos import wordpress as wordpress_repo
from ..services import secret_box
from ..services.wordpress import PostInput, WordPressClient, WordPressRefused, WordPressSite
from . import html as article_html
from . import seo_meta
from .models import Article, ArticleStatus

log = get_logger(__name__)

ACTION = "content.article.publish"
SECRET_PURPOSE = "wordpress.app_password"
MIN_LEAD = timedelta(minutes=2)
MAX_LEAD = timedelta(days=366)


class PublishError(Exception):
    def __init__(self, message: str, status_code: int = 409, code: str = "publish_refused") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def _content_hash(article: Article) -> str:
    cover = (article.cover_image or {}).get("url") or ""
    blob = f"{article.title or ''}\n{article.article_markdown or ''}\n{cover}".encode()
    return hashlib.sha256(blob).hexdigest()


def publish_args(article: Article, site_url: str, seo_plugin: str, mode: str) -> dict[str, Any]:
    """What a publish sends, canonically hashed for the rails record and for
    the scheduled-publish binding."""
    return {
        "article_id": str(article.id),
        "site_url": site_url,
        "seo_plugin": seo_plugin,
        "mode": mode,
        "content_sha256": _content_hash(article),
        "meta_title": article.meta_title or "",
        "meta_description": article.meta_description or "",
        "slug": article.slug or "",
        "focus_keyword": article.focus_keyword or "",
        "secondary_keywords": list(article.keywords),
    }


def readiness(article: Article) -> list[str]:
    """Why the article can't be published yet (empty when it can)."""
    problems: list[str] = []
    if article.status != ArticleStatus.done or not article.article_markdown:
        problems.append("The article isn't finished yet.")
        return problems
    errors = seo_meta.validate(
        meta_title=article.meta_title or "", meta_description=article.meta_description or "",
        slug=article.slug or "", focus_keyword=article.focus_keyword or "",
        secondary_keywords=list(article.keywords),
    )
    problems += list(errors.values())
    return problems


def post_input(article: Article, *, live: bool) -> PostInput:
    body = article_html.to_html(article.article_markdown or "")
    figure = article_html.cover_figure(article.cover_image)
    return PostInput(
        title=article.title or article.meta_title or article.topic,
        html=f"{figure}\n{body}" if figure else body,
        slug=article.slug or "",
        excerpt=article.meta_description or "",
        meta_title=article.meta_title or "",
        meta_description=article.meta_description or "",
        focus_keyword=article.focus_keyword or "",
        secondary_keywords=tuple(article.keywords),
        live=live,
    )


async def _audit(user_id: str, action: str, outcome: str, article_id: UUID, metadata: dict[str, Any], actor_type: str) -> None:
    try:
        import asyncio

        from ..repos import security_audit

        await asyncio.wait_for(
            security_audit.insert(
                action=action, actor_type=actor_type, outcome=outcome, tenant_id=user_id,
                target_type="article", target_id=str(article_id), metadata=metadata,
            ),
            timeout=1.0,
        )
    except Exception:  # noqa: BLE001 - auditing never changes an outcome
        log.warning("article publish audit write failed", exc_info=True)


async def _load(user_id: str, article_id: UUID) -> Article:
    article = await articles_repo.get(article_id, user_id=user_id)
    if article is None:
        raise PublishError("article not found", 404, "not_found")
    return article


async def _site(user_id: str) -> tuple[wordpress_repo.WordPressConnection, str]:
    found = await wordpress_repo.connection_secret(user_id)
    if found is None:
        raise PublishError("Connect a WordPress site first.", 409, "not_connected")
    return found


def _guard_agent(principal: str, live: bool) -> None:
    if principal == "agent" and live:
        raise PublishError("Publishing live needs a person. The agent can send drafts.", 403, "person_required")


async def schedule(
    *, user_id: str, article_id: UUID, publish_at: datetime, principal: str, now: datetime | None = None,
) -> Article:
    """Schedule a live publish. Nothing is sent now."""
    _guard_agent(principal, True)
    now = now or datetime.now(timezone.utc)
    if publish_at.tzinfo is None:
        publish_at = publish_at.replace(tzinfo=timezone.utc)
    if publish_at < now + MIN_LEAD:
        raise PublishError("Pick a time at least a few minutes from now, or publish now.", 422, "too_soon")
    if publish_at > now + MAX_LEAD:
        raise PublishError("Pick a time within the next year.", 422, "too_far")
    article = await _load(user_id, article_id)
    problems = readiness(article)
    if problems:
        raise PublishError(problems[0], 409, "not_ready")
    conn, _ = await _site(user_id)
    h = args_hash(ACTION, publish_args(article, conn.site_url, conn.seo_plugin, "live"))
    out = await article_seo.schedule(article_id, user_id=user_id, mode="live", publish_at=publish_at, args_hash=h)
    if out is None:
        raise PublishError(f"The article is {article.publish_status}; it can't be scheduled now.", 409, "busy")
    return out


async def reschedule(*, user_id: str, article_id: UUID, publish_at: datetime, principal: str, now: datetime | None = None) -> Article:
    """Move a scheduled publish. The binding is unchanged: the same article
    goes out, at another time."""
    _guard_agent(principal, True)
    now = now or datetime.now(timezone.utc)
    if publish_at.tzinfo is None:
        publish_at = publish_at.replace(tzinfo=timezone.utc)
    if publish_at < now + MIN_LEAD:
        raise PublishError("Pick a time at least a few minutes from now.", 422, "too_soon")
    if publish_at > now + MAX_LEAD:
        raise PublishError("Pick a time within the next year.", 422, "too_far")
    out = await article_seo.reschedule(article_id, user_id=user_id, publish_at=publish_at)
    if out is None:
        await _load(user_id, article_id)
        raise PublishError("Only a scheduled article can be moved.", 409, "not_scheduled")
    return out


async def publish(
    *, user_id: str, article_id: UUID, mode: str, principal: str, actor_email: str = "",
    scheduled: bool = False, transport: Any = None, resolver: Any = None,
) -> Article:
    """Send the article now (``mode`` 'draft' or 'live'). ``scheduled`` is the
    cron's path for a due scheduled publish."""
    if mode not in ("draft", "live"):
        raise PublishError("mode must be draft or live", 422, "bad_mode")
    live = mode == "live"
    _guard_agent(principal, live)
    article = await _load(user_id, article_id)
    problems = readiness(article)
    if problems:
        raise PublishError(problems[0], 409, "not_ready")
    if not live and article.wp_post_id and article.published_at is not None:
        # Sending a draft over a live post would take it off the site.
        raise PublishError("This article is already live on WordPress. Update it live instead.", 409, "already_live")
    conn, sealed = await _site(user_id)
    try:
        password = secret_box.open_sealed(sealed, purpose=SECRET_PURPOSE, tenant_id=user_id)
    except secret_box.SecretsUnavailable as exc:
        raise PublishError("Integration secrets aren't configured on this server.", 503, "secrets_unavailable") from exc
    except secret_box.SecretUnreadable as exc:
        await wordpress_repo.mark_error(user_id, "Reconnect WordPress: the saved password can't be read.")
        raise PublishError("Reconnect WordPress: the saved password can't be read.", 409, "reconnect") from exc

    stored_hash = await article_seo.scheduled_args_hash(article_id, user_id=user_id) if scheduled else None
    claimed = await article_seo.claim_publish(article_id, user_id=user_id, mode=mode, from_scheduled_only=scheduled)
    if claimed is None:
        raise PublishError(
            f"The article is {article.publish_status}; wait for it to finish or resolve it in the inbox.",
            409, "busy",
        )
    args = publish_args(claimed, conn.site_url, conn.seo_plugin, mode)
    binding = None
    if scheduled:
        binding = ApprovalBinding(status="approved", stored_args_hash=stored_hash, current_args_hash=args_hash(ACTION, args))
    actor_type = {"agent": "agent", "system": "system"}.get(principal, "user")

    try:
        dispatch = await enforce_dispatch(
            ACTION, user_id=user_id, principal=principal, args=args, actor_email=actor_email,
            target_type="article", target_id=str(article_id), approval=binding,
            idempotency_key="" if scheduled else None,
        )
    except RailsDenied as exc:
        review = exc.code.startswith("approval_")
        message = (
            "The article changed after it was scheduled. Check it and schedule it again."
            if review else exc.reason
        )
        await article_seo.finish_publish(
            article_id, user_id=user_id, status="needs_review" if review else "failed", error=message,
        )
        await _audit(user_id, "content.article.publish", "denied", article_id, {"code": exc.code, "mode": mode}, actor_type)
        raise

    client = WordPressClient(
        WordPressSite(site_url=conn.site_url, username=conn.username, app_password=password, seo_plugin=conn.seo_plugin),
        transport=transport, resolver=resolver,
    )
    try:
        result = await dispatch.run(
            lambda: client.publish(post_input(claimed, live=live), existing_id=claimed.wp_post_id),
            definite=(WordPressRefused,),
            detail=lambda r: {"post_id": r.post_id, "status": r.status},
        )
    except WordPressRefused as exc:
        await article_seo.finish_publish(article_id, user_id=user_id, status="failed", error=exc.message, wp_post_id=exc.post_id)
        if exc.status in (401, 403):
            await wordpress_repo.mark_error(user_id, exc.message)
        await _audit(user_id, "content.article.publish", "failure", article_id, {"mode": mode}, actor_type)
        raise PublishError(exc.message, 422, "wordpress_refused") from exc
    except OutcomeUnknown:
        await article_seo.finish_publish(
            article_id, user_id=user_id, status="unknown",
            error="We sent the article and got no answer. Check WordPress before trying again.",
        )
        await _audit(user_id, "content.article.publish", "failure", article_id, {"mode": mode, "outcome": "unknown"}, actor_type)
        raise
    except BaseException:
        await article_seo.finish_publish(article_id, user_id=user_id, status="failed", error="Publishing failed.")
        raise

    await article_seo.finish_publish(
        article_id, user_id=user_id, status="published", wp_post_id=result.post_id,
        wp_post_url=result.link or result.edit_url, published=live,
    )
    await _audit(
        user_id, "content.article.publish", "success", article_id,
        {"mode": mode, "post_id": result.post_id, "scheduled": scheduled}, actor_type,
    )
    out = await articles_repo.get(article_id, user_id=user_id)
    return out or claimed


async def run_due(now: datetime | None = None, *, limit: int = 50) -> dict[str, int]:
    """Send every scheduled publish that is due. One failure never stops
    the rest; each outcome is on the article and in the rails ledger."""
    now = now or datetime.now(timezone.utc)
    sent = failed = 0
    for article_id, user_id in await article_seo.due_scheduled(now, limit=limit):
        try:
            await publish(user_id=user_id, article_id=article_id, mode="live", principal="system", scheduled=True)
            sent += 1
        except PublishError as exc:
            failed += 1
            if exc.code in ("not_ready", "not_connected", "reconnect", "secrets_unavailable", "already_live"):
                # Refused before anything was claimed or sent: park it for a person
                # instead of retrying every tick.
                await article_seo.finish_publish(article_id, user_id=user_id, status="needs_review", error=exc.message)
            log.warning("scheduled article publish refused", extra={"article_id": str(article_id), "code": exc.code})
        except Exception as exc:  # noqa: BLE001
            failed += 1
            log.warning("scheduled article publish did not complete", extra={"article_id": str(article_id), "error": type(exc).__name__})
    return {"sent": sent, "failed": failed}
