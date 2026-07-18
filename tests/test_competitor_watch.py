"""services/competitor_watch.py — the hourly competitor scan: disabled /
unconfigured no-ops, Exa-domain-search diffing against competitor_articles
via a fake Exa transport, focus-area keyword matching, and per-competitor
failure isolation."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest

from marketer.repos.competitors import Competitor, CompetitorArticle
from marketer.services import competitor_watch


def _competitor(**overrides) -> Competitor:
    base = dict(
        id=uuid4(), user_id="user_a", niche_id=None, domain="rival.com",
        label="", created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Competitor(**base)


def _article(competitor_id, **overrides) -> CompetitorArticle:
    base = dict(
        id=uuid4(), competitor_id=competitor_id, url="https://rival.com/x",
        title="", published_hint="", first_seen=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return CompetitorArticle(**base)


@pytest.fixture(autouse=True)
def _enable_and_configure(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "competitor_watch_enabled", True)
    monkeypatch.setattr(settings, "exa_api_key", "exa-test-key")


def _install_exa_transport(monkeypatch, results_by_domain: dict[str, list[dict]]):
    """Fake Exa /search transport: returns `results_by_domain[domain]` for
    a domain-filtered search, keyed off the includeDomains payload field."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        import json
        payload = json.loads(request.content)
        domains = payload.get("includeDomains") or []
        domain = domains[0] if domains else ""
        return httpx.Response(200, json={"results": results_by_domain.get(domain, [])})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient  # capture before patching to avoid self-recursion

    def _fake_async_client(*, timeout=None):
        return real_async_client(transport=transport, timeout=timeout)

    monkeypatch.setattr(competitor_watch.httpx, "AsyncClient", _fake_async_client)


# --------------------------------------------------------------------------- no-ops


async def test_disabled_is_full_noop(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "competitor_watch_enabled", False)

    from marketer.repos import competitors as competitors_repo

    async def _boom():
        raise AssertionError("must not touch the DB when the feature is disabled")

    monkeypatch.setattr(competitors_repo, "list_active", _boom)

    result = await competitor_watch.run()
    assert result["skipped"] == "disabled"
    assert result["competitors_scanned"] == 0


async def test_no_exa_key_is_noop(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "exa_api_key", "")

    from marketer.repos import competitors as competitors_repo

    async def _boom():
        raise AssertionError("must not touch the DB without an Exa key")

    monkeypatch.setattr(competitors_repo, "list_active", _boom)

    result = await competitor_watch.run()
    assert result["skipped"] == "exa not configured"
    assert result["found"] == 0


async def test_no_tracked_competitors_is_cheap_noop(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _empty():
        return []

    async def _boom():
        raise AssertionError("must not fetch niches with nothing to scan")

    monkeypatch.setattr(competitors_repo, "list_active", _empty)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _boom)

    result = await competitor_watch.run()
    assert result == {"competitors_scanned": 0, "found": 0, "alerts_raised": 0}


# --------------------------------------------------------------------------- diffing + alerting


async def test_new_article_matching_niche_focus_raises_alert(monkeypatch):
    comp = _competitor(domain="rival.com", label="Rival Co")
    _install_exa_transport(monkeypatch, {
        "rival.com": [
            {"url": "https://rival.com/best-espresso-grinders", "title": "Best Espresso Grinders 2026"},
        ],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [comp]

    async def _niches():
        return [{
            "id": uuid4(), "user_id": "user_a", "title": "Home Espresso",
            "description": "grinders, machines, and dialing in espresso shots",
            "hashtags": [],
        }]

    async def _seen(competitor_id, urls):
        return set()  # nothing seen yet -> everything is new

    inserted_calls = []

    async def _insert(competitor_id, articles):
        inserted_calls.append(articles)
        return [
            _article(competitor_id, url=a["url"], title=a["title"]) for a in articles
        ]

    async def _has_unacked(user_id, *, kind, message):
        return False

    alert_calls = []

    async def _create_alert(*, user_id, kind, severity, message, context=None):
        alert_calls.append({"user_id": user_id, "kind": kind, "severity": severity,
                             "message": message, "context": context})

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert)
    monkeypatch.setattr(competitors_repo, "has_unacknowledged", _has_unacked)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_alert)

    result = await competitor_watch.run()

    assert result == {"competitors_scanned": 1, "found": 1, "alerts_raised": 1}
    assert len(inserted_calls) == 1
    assert alert_calls[0]["kind"] == "competitor_activity"
    assert alert_calls[0]["severity"] == "info"
    assert alert_calls[0]["user_id"] == "user_a"
    assert "Rival Co" in alert_calls[0]["message"]


async def test_already_seen_urls_are_not_reinserted(monkeypatch):
    comp = _competitor(domain="rival.com")
    _install_exa_transport(monkeypatch, {
        "rival.com": [{"url": "https://rival.com/old-post", "title": "Old Post"}],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [comp]

    async def _niches():
        return []

    async def _seen(competitor_id, urls):
        return set(urls)  # already have everything

    async def _insert_boom(competitor_id, articles):
        raise AssertionError("must not insert URLs already on file")

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert_boom)

    result = await competitor_watch.run()
    assert result == {"competitors_scanned": 1, "found": 0, "alerts_raised": 0}


async def test_off_topic_article_does_not_raise_alert(monkeypatch):
    comp = _competitor(domain="rival.com")
    _install_exa_transport(monkeypatch, {
        "rival.com": [{"url": "https://rival.com/hiring", "title": "We're Hiring a Sales Rep"}],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [comp]

    async def _niches():
        return [{"id": uuid4(), "user_id": "user_a", "title": "Home Espresso",
                  "description": "grinders and machines", "hashtags": []}]

    async def _seen(competitor_id, urls):
        return set()

    async def _insert(competitor_id, articles):
        return [_article(competitor_id, url=a["url"], title=a["title"]) for a in articles]

    async def _create_alert_boom(**kw):
        raise AssertionError("must not raise an alert for an off-focus article")

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_alert_boom)

    result = await competitor_watch.run()
    assert result == {"competitors_scanned": 1, "found": 1, "alerts_raised": 0}


async def test_niche_scoped_competitor_only_matches_its_own_niche(monkeypatch):
    """A competitor pinned to one niche_id must not trigger an alert for a
    keyword match against a *different* niche belonging to the same user."""
    scoped_niche_id = uuid4()
    comp = _competitor(domain="rival.com", niche_id=scoped_niche_id)
    _install_exa_transport(monkeypatch, {
        "rival.com": [{"url": "https://rival.com/tiktok-growth", "title": "TikTok Growth Hacks"}],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [comp]

    async def _niches():
        return [
            {"id": scoped_niche_id, "user_id": "user_a", "title": "Home Espresso",
             "description": "grinders and machines", "hashtags": []},
            {"id": uuid4(), "user_id": "user_a", "title": "TikTok Growth",
             "description": "growth hacks and viral tactics", "hashtags": ["tiktok"]},
        ]

    async def _seen(competitor_id, urls):
        return set()

    async def _insert(competitor_id, articles):
        return [_article(competitor_id, url=a["url"], title=a["title"]) for a in articles]

    async def _create_alert_boom(**kw):
        raise AssertionError("must not match a niche outside the competitor's niche_id scope")

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_alert_boom)

    result = await competitor_watch.run()
    assert result == {"competitors_scanned": 1, "found": 1, "alerts_raised": 0}


async def test_dedupe_skips_alert_when_already_unacknowledged(monkeypatch):
    comp = _competitor(domain="rival.com")
    _install_exa_transport(monkeypatch, {
        "rival.com": [{"url": "https://rival.com/best-espresso-grinders", "title": "Best Espresso Grinders"}],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [comp]

    async def _niches():
        return [{"id": uuid4(), "user_id": "user_a", "title": "Espresso Grinders",
                  "description": "", "hashtags": []}]

    async def _seen(competitor_id, urls):
        return set()

    async def _insert(competitor_id, articles):
        return [_article(competitor_id, url=a["url"], title=a["title"]) for a in articles]

    async def _has_unacked(user_id, *, kind, message):
        return True  # already an identical unacknowledged alert on file

    async def _create_alert_boom(**kw):
        raise AssertionError("must not raise a duplicate alert")

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert)
    monkeypatch.setattr(competitors_repo, "has_unacknowledged", _has_unacked)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_alert_boom)

    result = await competitor_watch.run()
    assert result == {"competitors_scanned": 1, "found": 1, "alerts_raised": 0}


async def test_one_competitor_failure_does_not_sink_the_scan(monkeypatch):
    ok_comp = _competitor(domain="rival-ok.com")
    bad_comp = _competitor(domain="rival-bad.com")
    _install_exa_transport(monkeypatch, {
        "rival-ok.com": [{"url": "https://rival-ok.com/post", "title": "Post"}],
    })

    from marketer.repos import competitors as competitors_repo

    async def _list_active():
        return [bad_comp, ok_comp]

    async def _niches():
        return []

    async def _seen(competitor_id, urls):
        if competitor_id == bad_comp.id:
            raise RuntimeError("boom")
        return set()

    inserted_for = []

    async def _insert(competitor_id, articles):
        inserted_for.append(competitor_id)
        return [_article(competitor_id, url=a["url"], title=a["title"]) for a in articles]

    monkeypatch.setattr(competitors_repo, "list_active", _list_active)
    monkeypatch.setattr(competitors_repo, "all_niches_for_focus_match", _niches)
    monkeypatch.setattr(competitors_repo, "seen_urls", _seen)
    monkeypatch.setattr(competitors_repo, "insert_articles", _insert)

    result = await competitor_watch.run()

    # The bad competitor's failure is swallowed; the good one still scans.
    assert inserted_for == [ok_comp.id]
    assert result["found"] == 1


# --------------------------------------------------------------------------- keyword matching (pure)


def test_matching_niche_finds_word_overlap():
    niches = [
        {"id": uuid4(), "title": "Home Espresso", "description": "grinders and machines",
         "hashtags": []},
    ]
    match = competitor_watch._matching_niche("Best Espresso Grinders 2026", niches)
    assert match is not None
    assert match["title"] == "Home Espresso"


def test_matching_niche_returns_none_without_overlap():
    niches = [
        {"id": uuid4(), "title": "Home Espresso", "description": "grinders and machines",
         "hashtags": []},
    ]
    match = competitor_watch._matching_niche("Quarterly Sales Report", niches)
    assert match is None
