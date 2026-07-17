"""Publishing — the last mile: push a finished article to a WordPress site
or a generic webhook.

Every attempt is recorded in article_publishes regardless of outcome
(pending row created up front, then flipped to ok/failed) so retries and
failures are auditable per article/target pair — mirroring the fail-closed,
always-record discipline the rest of the pipeline uses for spend.

WordPress auth is HTTP Basic with an application password (username +
secret). The webhook path reuses the exact HMAC scheme the outbound
webhook delivery service already uses (services/webhook_delivery.sign),
so a receiver that already verifies job.done/article.done events can
verify a publish payload with the same code.
"""
from __future__ import annotations

import html
import json
import re
import time

import httpx

from ..articles.models import Article, ArticlePublish
from ..logging import get_logger
from ..repos import articles as articles_repo
from ..repos.publish_targets import PublishTargetSecret
from .webhook_delivery import sign as hmac_sign

log = get_logger(__name__)

_TIMEOUT = 30.0


class PublishError(RuntimeError):
    """Raised after the failed attempt has already been recorded — callers
    (routes, scheduler) decide how to surface it; the article_publishes row
    is the durable record either way."""


def markdown_to_html(markdown: str) -> str:
    """Minimal markdown -> HTML: headings, paragraphs, bold/italic, links,
    and bullet lists. Not a full CommonMark implementation (no third-party
    markdown dependency in this repo) — good enough for a CMS block editor
    or a webhook consumer to render sanely."""
    if not markdown:
        return ""

    def _inline(text: str) -> str:
        text = html.escape(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", text)
        text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
        return text

    out: list[str] = []
    paragraph: list[str] = []
    in_list = False

    def _flush_paragraph() -> None:
        if paragraph:
            out.append(f"<p>{' '.join(_inline(p) for p in paragraph)}</p>")
            paragraph.clear()

    for raw_line in markdown.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        bullet = re.match(r"^[-*]\s+(.*)$", line)
        if heading:
            _flush_paragraph()
            if in_list:
                out.append("</ul>")
                in_list = False
            level = len(heading.group(1))
            out.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
        elif bullet:
            _flush_paragraph()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline(bullet.group(1))}</li>")
        elif not line:
            _flush_paragraph()
            if in_list:
                out.append("</ul>")
                in_list = False
        else:
            paragraph.append(line)

    _flush_paragraph()
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


async def _publish_wordpress(article: Article, target: PublishTargetSecret) -> str:
    if not target.username or not target.secret:
        raise PublishError("wordpress target is missing username/application password")
    payload = {
        "title": article.title or article.topic,
        "content": markdown_to_html(article.article_markdown or ""),
        "status": "publish",
    }
    if article.slug:
        payload["slug"] = article.slug
    if article.meta_description:
        payload["excerpt"] = article.meta_description
    url = target.base_url.rstrip("/") + "/wp-json/wp/v2/posts"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url, json=payload, auth=httpx.BasicAuth(target.username, target.secret)
        )
    if resp.status_code >= 400:
        raise PublishError(
            f"wordpress publish failed: {resp.status_code} {resp.text[:500]}"
        )
    link = (resp.json() or {}).get("link") or ""
    if not link:
        raise PublishError(f"wordpress response missing link: {resp.text[:500]}")
    return link


async def _publish_webhook(article: Article, target: PublishTargetSecret) -> str:
    if not target.secret:
        raise PublishError("webhook target is missing a signing secret")
    payload = {
        "article_id": str(article.id),
        "niche_id": str(article.niche_id),
        "title": article.title or article.topic,
        "slug": article.slug,
        "meta_description": article.meta_description,
        "keywords": article.keywords,
        "markdown": article.article_markdown,
        "html": markdown_to_html(article.article_markdown or ""),
        "schema_jsonld": article.schema_jsonld,
    }
    body = json.dumps(payload, separators=(",", ":"))
    timestamp = int(time.time())
    signature = hmac_sign(target.secret, timestamp, body)
    headers = {
        "content-type": "application/json",
        "user-agent": "marketer.sh-publish/1",
        "x-marketer-signature": f"t={timestamp},v1={signature}",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(target.base_url, content=body, headers=headers)
    if resp.status_code >= 400:
        raise PublishError(f"webhook publish failed: {resp.status_code} {resp.text[:500]}")
    return target.base_url


async def publish_article(article: Article, target: PublishTargetSecret) -> ArticlePublish:
    """Push `article` to `target`. Always records exactly one
    article_publishes row; raises PublishError on failure (after
    recording) so the caller can turn it into an HTTP error or a log line.
    Fail-closed: a disabled target or an unknown kind never fires the
    outbound call."""
    attempt = await articles_repo.create_publish_attempt(
        article_id=article.id, target_id=target.id
    )
    try:
        if target.disabled:
            raise PublishError("publish target is disabled")
        if target.kind == "wordpress":
            external_url = await _publish_wordpress(article, target)
        elif target.kind == "webhook":
            external_url = await _publish_webhook(article, target)
        else:
            raise PublishError(f"unknown publish target kind: {target.kind!r}")
    except Exception as exc:  # noqa: BLE001 — every failure mode gets recorded
        error = str(exc)[:2000]
        await articles_repo.mark_publish_failed(attempt.id, error=error)
        log.warning(
            "article publish failed",
            extra={"article_id": str(article.id), "target_id": str(target.id), "error": error},
        )
        attempt.status = "failed"
        attempt.error = error
        if isinstance(exc, PublishError):
            raise
        raise PublishError(error) from exc

    await articles_repo.mark_publish_ok(attempt.id, external_url=external_url)
    attempt.status = "ok"
    attempt.external_url = external_url
    return attempt
