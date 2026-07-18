"""Deterministic (no-LLM) scoring in services/content_intel.py: corpus
audit component scoring and cannibalization pairwise similarity, plus
plan_cluster's coverage-marking with a fake LLM call."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

from marketer.services import content_intel as service

_USER = "user_intel_service"


_UNSET = object()


def _article(
    *,
    id_=None,
    title="Best espresso grinders 2026",
    topic="",
    focus_keyword="best espresso grinders",
    quality=_UNSET,
    hero_image_path="hero.png",
    meta_description="A " * 30,  # 60 chars, above META_MIN_CHARS
    link_suggestions=_UNSET,
    created_at=None,
) -> dict:
    return {
        "id": id_ or uuid4(),
        "title": title,
        "topic": topic,
        "focus_keyword": focus_keyword,
        "keywords": [],
        "meta_description": meta_description,
        "hero_image_path": hero_image_path,
        "quality": {"overall": 1.0} if quality is _UNSET else quality,
        "link_suggestions": ([{}] * 5) if link_suggestions is _UNSET else link_suggestions,
        "word_count": 1500,
        "status": "done",
        "created_at": created_at or datetime.now(timezone.utc),
    }


# --------------------------------------------------------------------------- audit scoring


def test_score_article_perfect_scores_near_100():
    a = _article()
    score, findings = service._score_article(a, now=datetime.now(timezone.utc))
    assert score == 100.0
    assert findings == []


def test_score_article_penalizes_missing_signals():
    now = datetime.now(timezone.utc)
    a = _article(
        quality=None,
        hero_image_path=None,
        meta_description="",
        link_suggestions=[],
        created_at=now - timedelta(days=400),  # past FRESHNESS_ZERO_DAYS
    )
    score, findings = service._score_article(a, now=now)
    codes = {f["code"] for f in findings}
    assert score == 0.0
    assert "no_quality_score" in codes
    assert "missing_hero" in codes
    assert "missing_meta_description" in codes
    assert "no_internal_links" in codes
    assert "stale" in codes
    assert "needs_attention" in codes  # score below LOW_SCORE_THRESHOLD


def test_score_article_freshness_decays_linearly():
    now = datetime.now(timezone.utc)
    fresh = _article(created_at=now - timedelta(days=10))
    aging = _article(created_at=now - timedelta(days=200))
    stale = _article(created_at=now - timedelta(days=400))

    fresh_score, _ = service._score_article(fresh, now=now)
    aging_score, aging_findings = service._score_article(aging, now=now)
    stale_score, stale_findings = service._score_article(stale, now=now)

    assert fresh_score == 100.0
    assert stale_score < aging_score < fresh_score
    assert any(f["code"] == "aging" for f in aging_findings)
    assert any(f["code"] == "stale" for f in stale_findings)


async def test_audit_corpus_persists_one_row_per_article(monkeypatch):
    import marketer.repos.articles as articles_repo
    import marketer.repos.content_intel as repo

    now = datetime.now(timezone.utc)
    rows = [
        _article(id_=UUID(int=1)),
        _article(id_=UUID(int=2), quality=None, hero_image_path=None, created_at=now - timedelta(days=500)),
    ]

    async def _list_for_intel(user_id, *, status=None, limit=500):
        assert user_id == _USER
        return rows

    saved: list[dict] = []

    async def _save_audit(*, user_id, article_id, score, findings):
        saved.append({"user_id": user_id, "article_id": article_id, "score": score, "findings": findings})
        return SimpleNamespace(
            id=uuid4(), user_id=user_id, article_id=article_id, score=score,
            findings=findings, created_at=now,
        )

    monkeypatch.setattr(articles_repo, "list_for_intel", _list_for_intel)
    monkeypatch.setattr(repo, "save_audit", _save_audit)

    result = await service.audit_corpus(_USER)
    assert len(result) == 2
    assert len(saved) == 2
    assert saved[0]["score"] == 100.0
    # quality(0) + freshness(0, >365d) + hero(0) + meta(15, still default) + links(10, still default)
    assert saved[1]["score"] == 25.0


# --------------------------------------------------------------------------- cannibalization


def test_pair_similarity_near_duplicate_titles_score_high():
    a = _article(title="Best Espresso Grinders 2026", focus_keyword="best espresso grinders")
    b = _article(title="Best Espresso Grinders (2026 Guide)", focus_keyword="best espresso grinder")
    sim = service._pair_similarity(a, b)
    assert sim >= service.CANNIBALIZATION_THRESHOLD


def test_pair_similarity_distinct_topics_score_low():
    a = _article(title="Best Espresso Grinders 2026", focus_keyword="best espresso grinders")
    b = _article(title="How to Store Coffee Beans Long Term", focus_keyword="storing coffee beans")
    sim = service._pair_similarity(a, b)
    assert sim < service.CANNIBALIZATION_THRESHOLD


async def test_detect_cannibalization_flags_only_near_duplicates(monkeypatch):
    import marketer.repos.articles as articles_repo
    import marketer.repos.content_intel as repo

    dup_a = _article(id_=UUID(int=10), title="Best Espresso Grinders 2026", focus_keyword="best espresso grinders")
    dup_b = _article(id_=UUID(int=20), title="Best Espresso Grinders (2026 Guide)", focus_keyword="best espresso grinder")
    distinct = _article(id_=UUID(int=30), title="How to Store Coffee Beans", focus_keyword="storing coffee beans")

    async def _list_for_intel(user_id, *, status=None, limit=500):
        return [dup_a, dup_b, distinct]

    captured: list[dict] = []

    async def _upsert(*, user_id, article_a, article_b, keyword, similarity):
        captured.append({
            "user_id": user_id, "article_a": article_a, "article_b": article_b,
            "keyword": keyword, "similarity": similarity,
        })
        return SimpleNamespace(
            id=uuid4(), user_id=user_id, article_a=article_a, article_b=article_b,
            keyword=keyword, similarity=similarity, resolution="",
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(articles_repo, "list_for_intel", _list_for_intel)
    monkeypatch.setattr(repo, "upsert_finding", _upsert)

    findings = await service.detect_cannibalization(_USER)
    assert len(findings) == 1
    assert len(captured) == 1
    pair = captured[0]
    # Deterministic ordering: article_a < article_b by string id, regardless
    # of which order the corpus list happened to produce the pair in.
    assert str(pair["article_a"]) < str(pair["article_b"])
    assert {pair["article_a"], pair["article_b"]} == {dup_a["id"], dup_b["id"]}


# --------------------------------------------------------------------------- plan_cluster


async def test_plan_cluster_marks_already_covered_spokes(monkeypatch):
    from marketer.articles.models import TopicProposalPick  # noqa: F401  sanity import unrelated model exists

    niche = SimpleNamespace(title="home espresso", description="dial-in guides")
    corpus_titles = ["Best Espresso Grinders 2026", "How to Steam Milk"]

    async def _fake_parse_call(*, model, system, user, response_format, temperature, spend):
        return service.ClusterPlanBatch(
            pillarTitle="The Complete Espresso Guide",
            spokes=[
                service.ClusterSpokePick(title="Best Espresso Grinders 2026", focusKeyword="best espresso grinders"),
                service.ClusterSpokePick(title="Dialing In Your First Shot", focusKeyword="dial in espresso shot"),
            ],
        )

    monkeypatch.setattr(service, "_parse_call", _fake_parse_call)

    result = await service.plan_cluster(niche, None, corpus_titles, "espresso", spend=None)
    assert result.pillar_title == "The Complete Espresso Guide"
    assert len(result.spokes) == 2
    by_title = {s.title: s for s in result.spokes}
    assert by_title["Best Espresso Grinders 2026"].covered is True
    assert by_title["Dialing In Your First Shot"].covered is False
