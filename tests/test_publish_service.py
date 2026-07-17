"""services/publishing.py — WordPress + webhook delivery, all httpx mocked.

Verifies: WordPress gets a Basic-auth POST with the rendered HTML payload;
the webhook gets the exact HMAC scheme webhook_delivery.sign already uses;
every attempt (success or failure) is recorded via the articles_repo
publish-attempt helpers; a disabled target fails closed without any
outbound call."""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from marketer.articles.models import Article, ArticlePublish
from marketer.repos.publish_targets import PublishTargetSecret
from marketer.services import publishing
from marketer.services.webhook_delivery import sign as hmac_sign


def _article(**overrides) -> Article:
    base = dict(
        id=uuid4(), user_id="user_pub", niche_id=uuid4(), status="done",
        topic="espresso", title="Dial in espresso", slug="dial-in-espresso",
        meta_description="A guide.", keywords=["espresso"],
        article_markdown="# Dial in espresso\n\n## Grind size\n\nUse a **burr** grinder.\n\n- tip one\n- tip two\n",
        schema_jsonld='{"@context": "https://schema.org"}',
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Article(**base)


def _target(**overrides) -> PublishTargetSecret:
    base = dict(
        id=uuid4(), user_id="user_pub", kind="wordpress", name="Blog",
        base_url="https://blog.example.com", username="editor", secret="app-pass",
        disabled=False, created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return PublishTargetSecret(**base)


@pytest.fixture
def patch_async_client(monkeypatch):
    """Force every httpx.AsyncClient(...) inside publishing.py to use a
    caller-supplied MockTransport — same pattern as test_scheduler.py."""
    holder: dict = {}
    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        if "transport" not in kwargs and holder.get("transport") is not None:
            kwargs["transport"] = holder["transport"]
        return original(*args, **kwargs)

    monkeypatch.setattr(publishing.httpx, "AsyncClient", _factory)

    def install(transport: httpx.MockTransport) -> None:
        holder["transport"] = transport

    return install


@pytest.fixture
def stub_publish_repo(monkeypatch):
    """No DB: capture create/mark_ok/mark_failed calls in-memory."""
    state = {"attempts": [], "ok": [], "failed": []}

    async def _create_attempt(*, article_id, target_id):
        att = ArticlePublish(
            id=uuid4(), article_id=article_id, target_id=target_id,
            status="pending", created_at=datetime.now(timezone.utc),
        )
        state["attempts"].append(att)
        return att

    async def _mark_ok(publish_id, *, external_url):
        state["ok"].append((publish_id, external_url))

    async def _mark_failed(publish_id, *, error):
        state["failed"].append((publish_id, error))

    monkeypatch.setattr(publishing.articles_repo, "create_publish_attempt", _create_attempt)
    monkeypatch.setattr(publishing.articles_repo, "mark_publish_ok", _mark_ok)
    monkeypatch.setattr(publishing.articles_repo, "mark_publish_failed", _mark_failed)
    return state


async def test_publish_wordpress_sends_basic_auth_and_html(
    patch_async_client, stub_publish_repo
):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201, json={"id": 42, "link": "https://blog.example.com/dial-in-espresso"}
        )

    patch_async_client(httpx.MockTransport(handler))

    article = _article()
    target = _target()
    result = await publishing.publish_article(article, target)

    assert result.status == "ok"
    assert result.external_url == "https://blog.example.com/dial-in-espresso"
    assert captured["url"] == "https://blog.example.com/wp-json/wp/v2/posts"

    expected = base64.b64encode(b"editor:app-pass").decode()
    assert captured["auth"] == f"Basic {expected}"

    body = captured["body"]
    assert body["title"] == "Dial in espresso"
    assert body["status"] == "publish"
    assert body["slug"] == "dial-in-espresso"
    assert "<h2>Grind size</h2>" in body["content"]
    assert "<strong>burr</strong>" in body["content"]
    assert "<li>tip one</li>" in body["content"]

    assert stub_publish_repo["ok"] and stub_publish_repo["ok"][0][1] == result.external_url
    assert not stub_publish_repo["failed"]


async def test_publish_wordpress_failure_records_error(patch_async_client, stub_publish_repo):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="bad application password")

    patch_async_client(httpx.MockTransport(handler))

    with pytest.raises(publishing.PublishError):
        await publishing.publish_article(_article(), _target())

    assert stub_publish_repo["failed"]
    assert "401" in stub_publish_repo["failed"][0][1]
    assert not stub_publish_repo["ok"]


async def test_publish_webhook_signature_matches_scheme(patch_async_client, stub_publish_repo):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(200, json={"ok": True})

    patch_async_client(httpx.MockTransport(handler))

    article = _article()
    target = _target(kind="webhook", base_url="https://relay.example.com/hook",
                      username="", secret="whsec_test123")
    result = await publishing.publish_article(article, target)

    assert result.status == "ok"
    sig_header = captured["headers"]["x-marketer-signature"]
    assert sig_header.startswith("t=")
    ts_str, v1 = sig_header.split(",")
    ts = int(ts_str[2:])
    expected_sig = hmac_sign("whsec_test123", ts, captured["body"].decode())
    assert v1 == f"v1={expected_sig}"

    payload = json.loads(captured["body"])
    assert payload["article_id"] == str(article.id)
    assert payload["title"] == "Dial in espresso"
    assert "<h2>Grind size</h2>" in payload["html"]


async def test_publish_webhook_missing_secret_fails_without_network(
    patch_async_client, stub_publish_repo
):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not make an HTTP call without a secret")

    patch_async_client(httpx.MockTransport(handler))

    target = _target(kind="webhook", base_url="https://relay.example.com/hook", secret="")
    with pytest.raises(publishing.PublishError, match="signing secret"):
        await publishing.publish_article(_article(), target)
    assert stub_publish_repo["failed"]


async def test_publish_disabled_target_fails_closed_without_network(
    patch_async_client, stub_publish_repo
):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not make an HTTP call to a disabled target")

    patch_async_client(httpx.MockTransport(handler))

    target = _target(disabled=True)
    with pytest.raises(publishing.PublishError, match="disabled"):
        await publishing.publish_article(_article(), target)
    assert stub_publish_repo["failed"]
    assert not stub_publish_repo["ok"]


def test_markdown_to_html_headings_lists_and_inline():
    out = publishing.markdown_to_html(
        "# Title\n\nSome **bold** and *italic* text with a [link](https://x.com).\n\n"
        "- one\n- two\n\n## Sub\n\nMore text."
    )
    assert "<h1>Title</h1>" in out
    assert "<strong>bold</strong>" in out
    assert "<em>italic</em>" in out
    assert '<a href="https://x.com">link</a>' in out
    assert "<ul>" in out and "<li>one</li>" in out and "<li>two</li>" in out
    assert "<h2>Sub</h2>" in out


def test_markdown_to_html_empty_input():
    assert publishing.markdown_to_html("") == ""
    assert publishing.markdown_to_html(None) == ""
