"""Publishing articles to WordPress through the rails (fakes, no network)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from marketer.articles import publishing
from marketer.rails import OutcomeUnknown, RailsDenied
from tests.seo_fakes import TENANT, FakeWordPress, SeoStore, connect, done_article, public_resolver


@pytest.fixture
def store(monkeypatch):
    s = SeoStore().install(monkeypatch)
    connect(s, monkeypatch)
    return s


async def _publish(store, article, *, mode="draft", principal="user", wp=None, **kw):
    wp = wp or FakeWordPress()
    out = await publishing.publish(
        user_id=TENANT, article_id=article.id, mode=mode, principal=principal,
        transport=wp.transport, resolver=public_resolver, **kw,
    )
    return out, wp


async def test_draft_publish_succeeds_and_is_recorded(store, rails_store):
    a = store.add(done_article())
    out, wp = await _publish(store, a)
    assert out.publish_status == "published" and out.wp_post_id == 321
    assert out.published_at is None  # a draft is not live
    rows = list(rails_store.rows.values())
    assert [(r.action, r.outcome, r.target_id) for r in rows] == [("content.article.publish", "succeeded", str(a.id))]
    assert store.audits[-1][:2] == ("content.article.publish", "success")
    # The password reached WordPress only as Basic auth, never in the body.
    assert b"abcd" not in wp.requests[0].content


async def test_live_publish_sets_published_at(store):
    a = store.add(done_article())
    out, _ = await _publish(store, a, mode="live")
    assert out.published_at is not None


async def test_agent_may_send_drafts_but_not_publish_live(store):
    a = store.add(done_article())
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a, mode="live", principal="agent")
    assert e.value.status_code == 403 and e.value.code == "person_required"
    out, _ = await _publish(store, a, mode="draft", principal="agent")
    assert out.publish_status == "published"


async def test_kill_switch_blocks_publish_and_nothing_is_sent(store, rails_store):
    rails_store.kill_switches.add("publish")
    a = store.add(done_article())
    wp = FakeWordPress()
    with pytest.raises(RailsDenied) as e:
        await _publish(store, a, wp=wp)
    assert e.value.code == "kill_switch"
    assert wp.requests == []
    assert store.articles[a.id].publish_status == "failed"


async def test_wordpress_refusal_is_a_definite_failure(store, rails_store):
    a = store.add(done_article())
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a, wp=FakeWordPress(fail=401))
    assert e.value.code == "wordpress_refused"
    assert store.articles[a.id].publish_status == "failed"
    assert store.errors  # the connection is marked as needing attention
    assert [r.outcome for r in rails_store.rows.values()] == ["failed"]


async def test_no_answer_is_an_unknown_outcome_and_blocks_a_second_try(store, rails_store):
    a = store.add(done_article())
    with pytest.raises(OutcomeUnknown):
        await _publish(store, a, wp=FakeWordPress(raise_exc=httpx.ReadTimeout("slow")))
    assert store.articles[a.id].publish_status == "unknown"
    assert [r.outcome for r in rails_store.rows.values()] == ["indeterminate"]
    required = await rails_store.open_required_actions(TENANT)
    assert [r.action for r in required] == ["content.article.publish"]
    # A person resolves it in the inbox; until then a new publish is refused.
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a)
    assert e.value.code == "busy"


async def test_unfinished_or_invalid_article_is_not_published(store):
    a = store.add(done_article(meta_description="x" * 200))
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a)
    assert e.value.code == "not_ready"


async def test_draft_over_live_post_refused(store):
    a = store.add(done_article(wp_post_id=9, published_at=datetime.now(timezone.utc), publish_status="published"))
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a, mode="draft")
    assert e.value.code == "already_live"


async def test_not_connected(store):
    store.conn = None
    a = store.add(done_article())
    with pytest.raises(publishing.PublishError) as e:
        await _publish(store, a)
    assert e.value.code == "not_connected"


async def test_schedule_then_due_publish_goes_out(store, rails_store, monkeypatch):
    a = store.add(done_article())
    when = datetime.now(timezone.utc) + timedelta(hours=1)
    out = await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=when, principal="user")
    assert out.publish_status == "scheduled"
    wp = FakeWordPress()
    real = publishing.publish

    async def with_fakes(**kw):
        return await real(**kw, transport=wp.transport, resolver=public_resolver)

    monkeypatch.setattr(publishing, "publish", with_fakes)
    result = await publishing.run_due(now=when + timedelta(minutes=1))
    assert result == {"sent": 1, "failed": 0}
    assert store.articles[a.id].publish_status == "published"
    assert [r.principal for r in rails_store.rows.values()] == ["system"]


async def test_scheduled_publish_refused_when_article_changed(store, rails_store, monkeypatch):
    a = store.add(done_article())
    when = datetime.now(timezone.utc) + timedelta(hours=1)
    await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=when, principal="user")
    store.articles[a.id].article_markdown += "\n\nA paragraph added after scheduling."
    wp = FakeWordPress()
    with pytest.raises(RailsDenied) as e:
        await publishing.publish(
            user_id=TENANT, article_id=a.id, mode="live", principal="system", scheduled=True,
            transport=wp.transport, resolver=public_resolver,
        )
    assert e.value.code == "approval_args_mismatch"
    assert wp.requests == []
    assert store.articles[a.id].publish_status == "needs_review"


async def test_schedule_rules(store):
    a = store.add(done_article())
    now = datetime.now(timezone.utc)
    with pytest.raises(publishing.PublishError) as e:
        await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=now, principal="user")
    assert e.value.code == "too_soon"
    with pytest.raises(publishing.PublishError) as e:
        await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=now + timedelta(days=400), principal="user")
    assert e.value.code == "too_far"
    with pytest.raises(publishing.PublishError) as e:
        await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=now + timedelta(hours=2), principal="agent")
    assert e.value.code == "person_required"


async def test_reschedule_moves_only_scheduled(store):
    a = store.add(done_article())
    now = datetime.now(timezone.utc)
    with pytest.raises(publishing.PublishError) as e:
        await publishing.reschedule(user_id=TENANT, article_id=a.id, publish_at=now + timedelta(hours=3), principal="user")
    assert e.value.code == "not_scheduled"
    await publishing.schedule(user_id=TENANT, article_id=a.id, publish_at=now + timedelta(hours=1), principal="user")
    out = await publishing.reschedule(user_id=TENANT, article_id=a.id, publish_at=now + timedelta(days=2), principal="user")
    assert out.publish_at > now + timedelta(days=1)


async def test_due_publish_for_a_disconnected_site_waits_for_a_person(store):
    a = store.add(done_article(publish_status="scheduled", publish_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
    store.conn = None
    result = await publishing.run_due()
    assert result["failed"] == 1
    assert store.articles[a.id].publish_status == "needs_review"


def test_publish_args_change_with_content():
    a = done_article()
    h1 = publishing.publish_args(a, "https://x.test", "yoast", "live")
    a.article_markdown = (a.article_markdown or "") + "!"
    assert publishing.publish_args(a, "https://x.test", "yoast", "live") != h1
