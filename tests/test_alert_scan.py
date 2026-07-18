"""services/alert_scan.py — the three alert rules (cadence_slip,
quality_drop, ranking_drop) on crafted rows, the missing-gsc_daily guard,
and the unacknowledged-alert dedupe. All repo calls are monkeypatched, so
no real Postgres is needed for this file (see test_competitors_repo_pg.py
for the real-DB coverage)."""
from __future__ import annotations

from uuid import uuid4

import pytest

from marketer.services import alert_scan


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "performance_alerts_enabled", True)


def _no_dedupe(monkeypatch, repo):
    async def _never(*a, **k):
        return False
    monkeypatch.setattr(repo, "has_unacknowledged", _never)


# --------------------------------------------------------------------------- top-level


async def test_disabled_is_full_noop(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "performance_alerts_enabled", False)

    from marketer.repos import competitors as competitors_repo

    async def _boom():
        raise AssertionError("must not scan when the feature is disabled")

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _boom)

    result = await alert_scan.run()
    assert result["skipped"] == "disabled"


async def test_run_aggregates_all_three_rule_counts(monkeypatch):
    monkeypatch.setattr(alert_scan, "_scan_cadence_slip", _const_int(2))
    monkeypatch.setattr(alert_scan, "_scan_quality_drop", _const_int(1))
    monkeypatch.setattr(alert_scan, "_scan_ranking_drop", _const_int(0))

    result = await alert_scan.run()
    assert result == {"cadence_slip": 2, "quality_drop": 1, "ranking_drop": 0}


async def test_one_rule_failure_does_not_sink_the_others(monkeypatch):
    async def _boom():
        raise RuntimeError("boom")

    monkeypatch.setattr(alert_scan, "_scan_cadence_slip", _boom)
    monkeypatch.setattr(alert_scan, "_scan_quality_drop", _const_int(3))
    monkeypatch.setattr(alert_scan, "_scan_ranking_drop", _const_int(0))

    result = await alert_scan.run()
    assert result == {"cadence_slip": 0, "quality_drop": 3, "ranking_drop": 0}


def _const_int(n):
    async def _fn():
        return n
    return _fn


# --------------------------------------------------------------------------- cadence_slip


async def test_cadence_slip_raises_for_stale_niche(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    niche_id = uuid4()

    async def _niches():
        return [{"id": niche_id, "user_id": "user_a", "title": "Home Espresso",
                  "articles_per_week": 3}]

    async def _days(nid):
        assert nid == niche_id
        return 14.0  # over the 10-day threshold

    calls = []

    async def _create(**kw):
        calls.append(kw)

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _niches)
    monkeypatch.setattr(competitors_repo, "latest_article_days_since", _days)
    monkeypatch.setattr(competitors_repo, "create_alert", _create)
    _no_dedupe(monkeypatch, competitors_repo)

    raised = await alert_scan._scan_cadence_slip()
    assert raised == 1
    assert calls[0]["kind"] == "cadence_slip"
    assert calls[0]["user_id"] == "user_a"
    assert calls[0]["severity"] == "warn"


async def test_cadence_slip_skips_recently_published_niche(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _niches():
        return [{"id": uuid4(), "user_id": "user_a", "title": "Home Espresso",
                  "articles_per_week": 3}]

    async def _days(nid):
        return 2.0  # well within cadence

    async def _create_boom(**kw):
        raise AssertionError("must not alert a niche that's on cadence")

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _niches)
    monkeypatch.setattr(competitors_repo, "latest_article_days_since", _days)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_boom)

    raised = await alert_scan._scan_cadence_slip()
    assert raised == 0


async def test_cadence_slip_never_published_is_critical(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _niches():
        return [{"id": uuid4(), "user_id": "user_a", "title": "New Niche",
                  "articles_per_week": 1}]

    async def _days(nid):
        return None  # never produced an article

    calls = []

    async def _create(**kw):
        calls.append(kw)

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _niches)
    monkeypatch.setattr(competitors_repo, "latest_article_days_since", _days)
    monkeypatch.setattr(competitors_repo, "create_alert", _create)
    _no_dedupe(monkeypatch, competitors_repo)

    raised = await alert_scan._scan_cadence_slip()
    assert raised == 1
    assert calls[0]["severity"] == "critical"
    assert "never" in calls[0]["message"]


async def test_cadence_slip_dedupes_against_unacknowledged_alert(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _niches():
        return [{"id": uuid4(), "user_id": "user_a", "title": "Home Espresso",
                  "articles_per_week": 3}]

    async def _days(nid):
        return 20.0

    async def _dupe(user_id, *, kind, message):
        return True

    async def _create_boom(**kw):
        raise AssertionError("must not re-raise an identical unacknowledged alert")

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _niches)
    monkeypatch.setattr(competitors_repo, "latest_article_days_since", _days)
    monkeypatch.setattr(competitors_repo, "has_unacknowledged", _dupe)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_boom)

    raised = await alert_scan._scan_cadence_slip()
    assert raised == 0


async def test_cadence_slip_one_niche_failure_does_not_sink_others(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    bad_id, ok_id = uuid4(), uuid4()

    async def _niches():
        return [
            {"id": bad_id, "user_id": "user_a", "title": "Bad", "articles_per_week": 1},
            {"id": ok_id, "user_id": "user_b", "title": "Ok", "articles_per_week": 1},
        ]

    async def _days(nid):
        if nid == bad_id:
            raise RuntimeError("boom")
        return 15.0

    calls = []

    async def _create(**kw):
        calls.append(kw)

    monkeypatch.setattr(competitors_repo, "niches_with_cadence", _niches)
    monkeypatch.setattr(competitors_repo, "latest_article_days_since", _days)
    monkeypatch.setattr(competitors_repo, "create_alert", _create)
    _no_dedupe(monkeypatch, competitors_repo)

    raised = await alert_scan._scan_cadence_slip()
    assert raised == 1
    assert calls[0]["user_id"] == "user_b"


# --------------------------------------------------------------------------- quality_drop


async def test_quality_drop_raises_when_latest_below_trailing_average(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    art_id = uuid4()
    niche_id = uuid4()

    async def _users():
        return ["user_a"]

    async def _scores(user_id, **kw):
        # newest first: latest is a big drop from a consistent 0.9 trailing average
        return [
            {"id": art_id, "niche_id": niche_id, "overall": 0.60},
            {"id": uuid4(), "niche_id": niche_id, "overall": 0.90},
            {"id": uuid4(), "niche_id": niche_id, "overall": 0.88},
            {"id": uuid4(), "niche_id": niche_id, "overall": 0.92},
        ]

    calls = []

    async def _create(**kw):
        calls.append(kw)

    monkeypatch.setattr(competitors_repo, "distinct_users_with_scored_articles", _users)
    monkeypatch.setattr(competitors_repo, "quality_scores_for_user", _scores)
    monkeypatch.setattr(competitors_repo, "create_alert", _create)
    _no_dedupe(monkeypatch, competitors_repo)

    raised = await alert_scan._scan_quality_drop()
    assert raised == 1
    assert calls[0]["kind"] == "quality_drop"
    assert calls[0]["context"]["article_id"] == str(art_id)


async def test_quality_drop_skips_within_margin(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _users():
        return ["user_a"]

    async def _scores(user_id, **kw):
        return [
            {"id": uuid4(), "niche_id": uuid4(), "overall": 0.85},
            {"id": uuid4(), "niche_id": uuid4(), "overall": 0.90},
            {"id": uuid4(), "niche_id": uuid4(), "overall": 0.88},
            {"id": uuid4(), "niche_id": uuid4(), "overall": 0.87},
        ]

    async def _create_boom(**kw):
        raise AssertionError("must not alert a drop within the margin")

    monkeypatch.setattr(competitors_repo, "distinct_users_with_scored_articles", _users)
    monkeypatch.setattr(competitors_repo, "quality_scores_for_user", _scores)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_boom)

    raised = await alert_scan._scan_quality_drop()
    assert raised == 0


async def test_quality_drop_skips_insufficient_history(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _users():
        return ["user_a"]

    async def _scores(user_id, **kw):
        return [{"id": uuid4(), "niche_id": uuid4(), "overall": 0.10}]  # only one score ever

    async def _create_boom(**kw):
        raise AssertionError("must not alert without enough trailing history")

    monkeypatch.setattr(competitors_repo, "distinct_users_with_scored_articles", _users)
    monkeypatch.setattr(competitors_repo, "quality_scores_for_user", _scores)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_boom)

    raised = await alert_scan._scan_quality_drop()
    assert raised == 0


# --------------------------------------------------------------------------- ranking_drop + missing-gsc_daily guard


async def test_ranking_drop_skips_cleanly_when_gsc_daily_missing(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _absent():
        return False

    async def _boom():
        raise AssertionError("must not query gsc users when gsc_daily doesn't exist")

    monkeypatch.setattr(competitors_repo, "gsc_daily_exists", _absent)
    monkeypatch.setattr(competitors_repo, "distinct_gsc_users", _boom)

    raised = await alert_scan._scan_ranking_drop()
    assert raised == 0


async def test_ranking_drop_raises_when_gsc_daily_present(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _present():
        return True

    async def _users():
        return ["user_a"]

    async def _drops(user_id):
        return [{"query": "best espresso grinder", "prior_position": 3.0, "current_position": 12.0}]

    calls = []

    async def _create(**kw):
        calls.append(kw)

    monkeypatch.setattr(competitors_repo, "gsc_daily_exists", _present)
    monkeypatch.setattr(competitors_repo, "distinct_gsc_users", _users)
    monkeypatch.setattr(competitors_repo, "ranking_drops_for_user", _drops)
    monkeypatch.setattr(competitors_repo, "create_alert", _create)
    _no_dedupe(monkeypatch, competitors_repo)

    raised = await alert_scan._scan_ranking_drop()
    assert raised == 1
    assert calls[0]["kind"] == "ranking_drop"
    assert calls[0]["context"]["query"] == "best espresso grinder"


async def test_ranking_drop_dedupes_against_unacknowledged_alert(monkeypatch):
    from marketer.repos import competitors as competitors_repo

    async def _present():
        return True

    async def _users():
        return ["user_a"]

    async def _drops(user_id):
        return [{"query": "best espresso grinder", "prior_position": 3.0, "current_position": 12.0}]

    async def _dupe(user_id, *, kind, message):
        return True

    async def _create_boom(**kw):
        raise AssertionError("must not re-raise an identical unacknowledged alert")

    monkeypatch.setattr(competitors_repo, "gsc_daily_exists", _present)
    monkeypatch.setattr(competitors_repo, "distinct_gsc_users", _users)
    monkeypatch.setattr(competitors_repo, "ranking_drops_for_user", _drops)
    monkeypatch.setattr(competitors_repo, "has_unacknowledged", _dupe)
    monkeypatch.setattr(competitors_repo, "create_alert", _create_boom)

    raised = await alert_scan._scan_ranking_drop()
    assert raised == 0
