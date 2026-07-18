"""services/newsletter.py -- compose() and send() with a fake LLM and a
fake email sender (no real OpenAI/Resend calls in any test here).

compose():
  - zero articles -> a canned "nothing new" digest, no LLM call at all.
  - articles present -> one metered LLM call producing subject/intro/hooks;
    the actual title/url/ordering in the rendered markdown always comes
    from the Article rows (and article_publishes), never the LLM, so a
    hook keyed to an id the model didn't return is simply blank rather
    than fabricated.
  - a published article's most recent 'ok' article_publishes.external_url
    is linked; an unpublished one renders as plain text (no link).
  - the LLM call is logged to spend via SpendContext.log with sku
    "llm:<model>".

send():
  - a successful email send flips the digest to 'sent' with sent_at set.
  - a rejected/failed send (send_email returns False) flips it to
    'failed' with an explanatory error -- and never leaves it 'draft'.
  - an empty `to` fails without calling the email service at all.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4


from marketer.articles.models import Article, ArticleStatus, ArticlePublish
from marketer.models import SpendEntry
from marketer.repos.newsletters import NewsletterDigest
from marketer.services import newsletter as newsletter_svc
from marketer.services.spend_context import SpendContext

_USER_ID = "user_nl_1"


def _article(title="Espresso 101", **overrides) -> Article:
    base = dict(
        id=uuid4(), user_id=_USER_ID, niche_id=uuid4(), status=ArticleStatus.done,
        topic=title, title=title, meta_description="A short excerpt.",
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Article(**base)


@dataclass
class _FakeRecorder:
    entries: list[SpendEntry] = field(default_factory=list)

    async def __call__(self, entry: SpendEntry) -> None:
        self.entries.append(entry)


def _fake_spend() -> tuple[SpendContext, _FakeRecorder]:
    rec = _FakeRecorder()
    ctx = SpendContext(user_id=_USER_ID, niche_id=None, job_id=None, record=rec, cap_usd=None)
    return ctx, rec


class _FakeUsage:
    prompt_tokens = 100
    completion_tokens = 50


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]
        self.usage = _FakeUsage()


class _FakeCompletions:
    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeResponse(json.dumps(self._payload))


class _FakeClient:
    def __init__(self, payload: dict) -> None:
        self.chat = SimpleNamespace(completions=_FakeCompletions(payload))


def _install_fake_llm(monkeypatch, payload: dict) -> _FakeClient:
    client = _FakeClient(payload)
    monkeypatch.setattr(newsletter_svc, "_oai", lambda: client)
    return client


# ---------------------------------------------------------------------------
# compose()
# ---------------------------------------------------------------------------


async def test_compose_with_no_articles_skips_the_llm_entirely(monkeypatch):
    def _boom():
        raise AssertionError("must not call the LLM when there are no articles")

    monkeypatch.setattr(newsletter_svc, "_oai", _boom)

    digest = await newsletter_svc.compose(SimpleNamespace(email="a@b.com"), [], None)

    assert digest.article_ids == []
    assert "No new posts" in digest.markdown
    assert digest.subject


async def test_compose_builds_markdown_from_articles_not_the_llm(monkeypatch):
    art1 = _article(title="Grinders Compared")
    art2 = _article(title="Espresso Ratios")

    payload = {
        "subject": "Two fresh posts worth your coffee break",
        "intro": "Here is what shipped this week.",
        "hooks": [
            {"id": str(art1.id), "hook": "Which burr grinder actually holds a grind curve."},
            {"id": str(art2.id), "hook": "The ratio math nobody explains well."},
        ],
    }
    _install_fake_llm(monkeypatch, payload)

    import marketer.repos.articles as articles_repo

    async def _list_publishes(article_id, *, user_id):
        if article_id == art1.id:
            return [
                ArticlePublish(
                    id=uuid4(), article_id=art1.id, target_id=uuid4(), status="ok",
                    external_url="https://blog.example.com/grinders-compared",
                    created_at=datetime.now(timezone.utc),
                )
            ]
        return []  # art2 was never published

    monkeypatch.setattr(articles_repo, "list_publishes", _list_publishes)

    spend, rec = _fake_spend()
    digest = await newsletter_svc.compose(
        SimpleNamespace(email="a@b.com"), [art1, art2], None, spend=spend
    )

    assert digest.subject == payload["subject"]
    assert digest.article_ids == [art1.id, art2.id]
    # Published article gets a real markdown link built from the DB row,
    # not anything the LLM said.
    assert "[Grinders Compared](https://blog.example.com/grinders-compared)" in digest.markdown
    assert "Which burr grinder actually holds a grind curve." in digest.markdown
    # Unpublished article renders as plain text, no link.
    assert "### Espresso Ratios" in digest.markdown
    assert "The ratio math nobody explains well." in digest.markdown
    assert "[Espresso Ratios]" not in digest.markdown

    # The LLM call was metered.
    assert len(rec.entries) == 1
    assert rec.entries[0].sku.startswith("llm:")
    assert rec.entries[0].cost_usd > 0


async def test_compose_missing_hook_for_an_id_renders_blank_not_fabricated(monkeypatch):
    art = _article(title="Solo Post")
    payload = {"subject": "One thing shipped", "intro": "", "hooks": []}
    _install_fake_llm(monkeypatch, payload)

    import marketer.repos.articles as articles_repo

    async def _list_publishes(article_id, *, user_id):
        return []

    monkeypatch.setattr(articles_repo, "list_publishes", _list_publishes)

    digest = await newsletter_svc.compose(SimpleNamespace(email="a@b.com"), [art], None)
    assert "### Solo Post" in digest.markdown
    assert digest.article_ids == [art.id]


async def test_compose_malformed_llm_json_degrades_gracefully(monkeypatch):
    art = _article(title="Solo Post")
    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                create=_make_raw_content_stub("not valid json{{{")
            )
        )
    )
    monkeypatch.setattr(newsletter_svc, "_oai", lambda: client)

    import marketer.repos.articles as articles_repo

    async def _list_publishes(article_id, *, user_id):
        return []

    monkeypatch.setattr(articles_repo, "list_publishes", _list_publishes)

    digest = await newsletter_svc.compose(SimpleNamespace(email="a@b.com"), [art], None)
    # Falls back to a generated subject rather than raising.
    assert digest.subject
    assert "### Solo Post" in digest.markdown


def _make_raw_content_stub(raw: str):
    async def _create(**kwargs):
        return _FakeResponse(raw)

    return _create


# ---------------------------------------------------------------------------
# send()
# ---------------------------------------------------------------------------


def _digest(**overrides) -> NewsletterDigest:
    base = dict(
        id=uuid4(), user_id=_USER_ID, subject="Hi", markdown="body", html="<p>body</p>",
        status="draft",
    )
    base.update(overrides)
    return NewsletterDigest(**base)


async def test_send_success_marks_sent_with_sent_at(monkeypatch):
    digest = _digest()
    sent_calls = []

    async def _fake_send_email(*, to, subject, html):
        sent_calls.append({"to": to, "subject": subject, "html": html})
        return True

    monkeypatch.setattr(newsletter_svc, "send_email", _fake_send_email)

    import marketer.repos.newsletters as newsletters_repo

    marked = {}

    async def _mark_sent(digest_id, *, sent_at):
        marked["id"] = digest_id
        marked["sent_at"] = sent_at
        return NewsletterDigest(
            id=digest_id, user_id=_USER_ID, subject=digest.subject, status="sent", sent_at=sent_at
        )

    monkeypatch.setattr(newsletters_repo, "mark_sent", _mark_sent)

    updated = await newsletter_svc.send(digest, "reader@example.com")

    assert sent_calls == [{"to": "reader@example.com", "subject": "Hi", "html": "<p>body</p>"}]
    assert updated.status == "sent"
    assert updated.sent_at is not None
    assert marked["id"] == digest.id


async def test_send_email_service_failure_marks_failed(monkeypatch):
    digest = _digest()

    async def _fake_send_email(*, to, subject, html):
        return False

    monkeypatch.setattr(newsletter_svc, "send_email", _fake_send_email)

    import marketer.repos.newsletters as newsletters_repo

    async def _mark_failed(digest_id, *, error):
        assert error
        return NewsletterDigest(
            id=digest_id, user_id=_USER_ID, subject=digest.subject, status="failed", error=error
        )

    monkeypatch.setattr(newsletters_repo, "mark_failed", _mark_failed)

    updated = await newsletter_svc.send(digest, "reader@example.com")
    assert updated.status == "failed"
    assert updated.error


async def test_send_with_no_recipient_fails_without_calling_email_service(monkeypatch):
    digest = _digest()

    def _boom(**kwargs):
        raise AssertionError("must not call the email service with no recipient")

    monkeypatch.setattr(newsletter_svc, "send_email", _boom)

    import marketer.repos.newsletters as newsletters_repo

    async def _mark_failed(digest_id, *, error):
        return NewsletterDigest(
            id=digest_id, user_id=_USER_ID, subject=digest.subject, status="failed", error=error
        )

    monkeypatch.setattr(newsletters_repo, "mark_failed", _mark_failed)

    updated = await newsletter_svc.send(digest, "")
    assert updated.status == "failed"
