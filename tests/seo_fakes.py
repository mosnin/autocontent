"""In-memory stand-ins for the SEO article repos (no database, no network)."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import httpx

from marketer.articles.models import Article, ArticleStatus
from marketer.repos.wordpress import WordPressConnection

TENANT = "user_test"
KEY = base64.b64encode(b"k" * 32).decode()


def done_article(**kw: Any) -> Article:
    base = dict(
        id=uuid4(), user_id=TENANT, niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        status=ArticleStatus.done, topic="cold brew at home", focus_keyword="cold brew",
        title="Cold Brew at Home", meta_title="Cold Brew at Home: A Simple Guide",
        meta_description="How to make smooth cold brew at home with a jar and a filter.",
        slug="cold-brew-at-home", keywords=["iced coffee", "coffee ratio"],
        article_markdown="# Cold Brew at Home\n\n## Why it works\n\nSteep coarse grounds **overnight**.",
        created_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return Article(**base)


@dataclass
class SeoStore:
    articles: dict[UUID, Article] = field(default_factory=dict)
    conn: WordPressConnection | None = None
    sealed: str = ""
    hashes: dict[UUID, str | None] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    audits: list[tuple] = field(default_factory=list)

    def add(self, article: Article) -> Article:
        self.articles[article.id] = article
        return article

    def install(self, monkeypatch) -> SeoStore:
        from marketer.articles import publishing
        from marketer.repos import article_seo, wordpress as wp_repo
        from marketer.repos import articles as articles_repo

        store = self

        async def get(article_id, *, user_id):
            a = store.articles.get(article_id)
            return a.model_copy(deep=True) if a and a.user_id == user_id else None

        async def connection_secret(user_id):
            return (store.conn, store.sealed) if store.conn and store.conn.user_id == user_id else None

        async def mark_error(user_id, error):
            store.errors.append(error)

        async def scheduled_args_hash(article_id, *, user_id):
            return store.hashes.get(article_id)

        async def schedule(article_id, *, user_id, mode, publish_at, args_hash):
            a = store.articles[article_id]
            if a.publish_status not in article_seo.PUBLISHABLE_FROM:
                return None
            a.publish_status, a.publish_mode, a.publish_at = "scheduled", mode, publish_at
            store.hashes[article_id] = args_hash
            return a.model_copy(deep=True)

        async def reschedule(article_id, *, user_id, publish_at):
            a = store.articles.get(article_id)
            if a is None or a.publish_status != "scheduled":
                return None
            a.publish_at = publish_at
            return a.model_copy(deep=True)

        async def claim_publish(article_id, *, user_id, mode, from_scheduled_only=False):
            a = store.articles[article_id]
            allowed = ("scheduled",) if from_scheduled_only else article_seo.PUBLISHABLE_FROM
            if a.publish_status not in allowed:
                return None
            a.publish_status, a.publish_mode = "publishing", mode
            return a.model_copy(deep=True)

        async def finish_publish(article_id, *, user_id, status, wp_post_id=None, wp_post_url=None, error=None, published=False):
            a = store.articles[article_id]
            a.publish_status = status
            a.wp_post_id = wp_post_id or a.wp_post_id
            a.wp_post_url = wp_post_url or a.wp_post_url
            a.publish_error = error
            if published:
                a.published_at = datetime.now(timezone.utc)

        async def due_scheduled(now, *, limit=50):
            return [(a.id, a.user_id) for a in store.articles.values() if a.publish_status == "scheduled" and a.publish_at and a.publish_at <= now]

        async def audit(user_id, action, outcome, article_id, metadata, actor_type):
            store.audits.append((action, outcome, metadata, actor_type))

        monkeypatch.setattr(articles_repo, "get", get)
        monkeypatch.setattr(wp_repo, "connection_secret", connection_secret)
        monkeypatch.setattr(wp_repo, "mark_error", mark_error)
        for name, fn in {
            "scheduled_args_hash": scheduled_args_hash, "schedule": schedule, "reschedule": reschedule,
            "claim_publish": claim_publish, "finish_publish": finish_publish, "due_scheduled": due_scheduled,
        }.items():
            monkeypatch.setattr(article_seo, name, fn)
        monkeypatch.setattr(publishing, "_audit", audit)
        return self


def connect(store: SeoStore, monkeypatch, *, plugin: str = "yoast") -> None:
    from marketer.config import settings
    from marketer.services import secret_box

    monkeypatch.setattr(settings, "integration_secret_key", KEY)
    store.conn = WordPressConnection(
        id=uuid4(), user_id=TENANT, site_url="https://blog.example.com", username="editor",
        seo_plugin=plugin, status="active",
    )
    store.sealed = secret_box.seal("abcd efgh ijkl mnop", purpose="wordpress.app_password", tenant_id=TENANT)


def public_resolver(url: str):
    """Resolve every host to one public documentation address."""
    return True, "", "93.184.216.34"


class FakeWordPress:
    """An httpx MockTransport that behaves like the WP REST API."""

    def __init__(self, *, status_after_publish: str = "publish", fail: int | None = None, raise_exc: Exception | None = None):
        self.requests: list[httpx.Request] = []
        self.status_after_publish = status_after_publish
        self.fail = fail
        self.raise_exc = raise_exc
        self.transport = httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.raise_exc is not None:
            raise self.raise_exc
        if self.fail:
            return httpx.Response(self.fail, json={"message": "nope"})
        if request.url.path.endswith("/users/me"):
            return httpx.Response(200, json={"id": 7, "name": "Editor", "capabilities": {"publish_posts": True}})
        if "/posts" in request.url.path and request.method == "POST":
            import json

            body = json.loads(request.content)
            status = body["status"] if body["status"] == "draft" else self.status_after_publish
            return httpx.Response(201, json={"id": 321, "status": status, "link": "https://blog.example.com/cold-brew-at-home/"})
        return httpx.Response(404, json={"message": "not found"})
