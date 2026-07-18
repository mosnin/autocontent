"""Keyword research routes (POST /keywords/harvest, GET /keywords,
POST /keywords/{id}/track|dismiss|score|promote). Fake repos/service
transports, same pattern as tests/test_press_topics.py."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.repos.keywords import KeywordCandidate
from marketer.repos.topic_proposals import TopicProposal

_USER = "user_keywords_route"
_NICHE_ID = UUID("88888888-8888-8888-8888-888888888888")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="k@k.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _candidate(
    *, status="candidate", keyword="best espresso grinders", difficulty=None,
    rationale="high intent, low competition",
) -> KeywordCandidate:
    return KeywordCandidate(
        id=uuid4(), user_id=_USER, niche_id=_NICHE_ID, keyword=keyword,
        intent="commercial", difficulty=difficulty, volume_hint="", rationale=rationale,
        status=status, created_at=datetime.now(timezone.utc),
    )


def _proposal(**kw) -> TopicProposal:
    defaults = dict(
        id=uuid4(), user_id=_USER, niche_id=_NICHE_ID, title="Best grinders",
        focus_keyword="best grinders", rationale="", score=0.0, status="pending",
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(kw)
    return TopicProposal(**defaults)


# --------------------------------------------------------------------------- POST /harvest


def test_harvest_creates_candidates(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.keyword_research as kr
    import marketer.services.spend_context as sc

    async def _niche_get(niche_id, *, user_id):
        assert niche_id == _NICHE_ID
        return SimpleNamespace(
            id=niche_id, title="home espresso", description="dial-in guides",
            daily_spend_cap_usd=Decimal("5"),
        )

    async def _brand_get(user_id):
        return None

    async def _existing(user_id, *, niche_id=None, status=None, limit=200):
        return []

    async def _ctx(**kwargs):
        return SimpleNamespace()

    seen_n: dict = {}

    async def _harvest(niche, brand, existing, n, *, spend=None):
        seen_n["n"] = n
        return [
            kr.HarvestPick(keyword=f"kw{i}", intent="informational", rationale="r")
            for i in range(n)
        ]

    created: list[dict] = []

    async def _create(*, user_id, niche_id, keyword, intent, rationale):
        created.append({"keyword": keyword, "intent": intent, "rationale": rationale})
        return _candidate(keyword=keyword, rationale=rationale)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(keywords_repo, "list_for_user", _existing)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(kr, "harvest", _harvest)
    monkeypatch.setattr(keywords_repo, "create", _create)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/keywords/harvest",
        json={"niche_id": str(_NICHE_ID), "n": 3},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen_n["n"] == 3
    assert len(created) == 3
    assert len(resp.json()) == 3


def test_harvest_defaults_n(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.keyword_research as kr
    import marketer.services.spend_context as sc

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, title="t", description="d", daily_spend_cap_usd=None)

    async def _brand_get(user_id):
        return None

    async def _existing(user_id, *, niche_id=None, status=None, limit=200):
        return []

    async def _ctx(**kwargs):
        return SimpleNamespace()

    seen_n: dict = {}

    async def _harvest(niche, brand, existing, n, *, spend=None):
        seen_n["n"] = n
        return []

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(keywords_repo, "list_for_user", _existing)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(kr, "harvest", _harvest)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/keywords/harvest",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen_n["n"] == kr.DEFAULT_HARVEST_N


def test_harvest_skips_duplicate_conflicts(monkeypatch):
    """repos.keywords.create() returns None on a unique-constraint
    conflict (upsert-skip) — the route must drop those rather than
    erroring or padding the response with Nones."""
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.keyword_research as kr
    import marketer.services.spend_context as sc

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, title="t", description="d", daily_spend_cap_usd=None)

    async def _brand_get(user_id):
        return None

    async def _existing(user_id, *, niche_id=None, status=None, limit=200):
        return [_candidate(keyword="kw0")]

    async def _ctx(**kwargs):
        return SimpleNamespace()

    async def _harvest(niche, brand, existing, n, *, spend=None):
        return [kr.HarvestPick(keyword="kw0", intent="", rationale=""),
                kr.HarvestPick(keyword="kw1", intent="", rationale="")]

    async def _create(*, user_id, niche_id, keyword, intent, rationale):
        if keyword == "kw0":
            return None  # simulates the unique-constraint conflict
        return _candidate(keyword=keyword)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(keywords_repo, "list_for_user", _existing)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(kr, "harvest", _harvest)
    monkeypatch.setattr(keywords_repo, "create", _create)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/keywords/harvest",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["keyword"] == "kw1"


def test_harvest_404_missing_niche(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/keywords/harvest",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_harvest_402_on_spend_cap(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.keyword_research as kr
    import marketer.services.spend_context as sc
    from marketer.repos.spend import SpendCapExceeded

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, title="t", description="d", daily_spend_cap_usd=Decimal("1"))

    async def _brand_get(user_id):
        return None

    async def _existing(user_id, *, niche_id=None, status=None, limit=200):
        return []

    async def _ctx(**kwargs):
        return SimpleNamespace()

    async def _harvest(*a, **k):
        raise SpendCapExceeded("niche cap hit", scope="niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(keywords_repo, "list_for_user", _existing)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(kr, "harvest", _harvest)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/keywords/harvest",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402


# --------------------------------------------------------------------------- GET /keywords


def test_list_keywords_passes_filters(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo

    seen: dict = {}

    async def _list(user_id, *, niche_id=None, status=None, limit=200):
        seen["niche_id"] = niche_id
        seen["status"] = status
        return [_candidate(status="tracked")]

    monkeypatch.setattr(keywords_repo, "list_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get(
        f"/api/v1/keywords?niche_id={_NICHE_ID}&status=tracked",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "tracked"
    assert seen["niche_id"] == _NICHE_ID
    assert resp.json()[0]["status"] == "tracked"


def test_list_keywords_rejects_bad_status(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/keywords?status=bogus",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


# --------------------------------------------------------------------------- track / dismiss


def test_track_keyword_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo

    seen: dict = {}

    async def _set_status(candidate_id, *, user_id, status, from_statuses):
        seen["status"] = status
        seen["from_statuses"] = from_statuses
        return _candidate(status=status)

    monkeypatch.setattr(keywords_repo, "set_status", _set_status)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/track",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "tracked"
    assert seen["from_statuses"] == ("candidate",)
    assert resp.json()["status"] == "tracked"


def test_track_keyword_404_when_not_trackable(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo

    async def _set_status(candidate_id, *, user_id, status, from_statuses):
        return None

    monkeypatch.setattr(keywords_repo, "set_status", _set_status)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/track",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_dismiss_keyword_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo

    seen: dict = {}

    async def _set_status(candidate_id, *, user_id, status, from_statuses):
        seen["status"] = status
        seen["from_statuses"] = from_statuses
        return _candidate(status=status)

    monkeypatch.setattr(keywords_repo, "set_status", _set_status)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/dismiss",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "dismissed"
    assert set(seen["from_statuses"]) == {"candidate", "tracked"}


# --------------------------------------------------------------------------- score


def test_score_keyword_persists_difficulty(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo
    import marketer.services.keyword_research as kr

    cid = uuid4()

    async def _get(candidate_id, *, user_id):
        assert candidate_id == cid
        return _candidate(keyword="best espresso grinders")

    async def _score_difficulty(keyword, **kwargs):
        assert keyword == "best espresso grinders"
        return kr.KeywordDifficulty(keyword=keyword, difficulty=42.5, top_domains=["a.com"])

    seen: dict = {}

    async def _set_difficulty(candidate_id, *, user_id, difficulty):
        seen["difficulty"] = difficulty
        return _candidate(keyword="best espresso grinders", difficulty=difficulty)

    monkeypatch.setattr(keywords_repo, "get", _get)
    monkeypatch.setattr(kr, "score_difficulty", _score_difficulty)
    monkeypatch.setattr(keywords_repo, "set_difficulty", _set_difficulty)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{cid}/score",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["difficulty"] == Decimal("42.5")
    assert resp.json()["difficulty"] == "42.5" or float(resp.json()["difficulty"]) == 42.5


def test_score_keyword_handles_none_difficulty(monkeypatch):
    """Exa unconfigured -> difficulty stays null, not an error."""
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo
    import marketer.services.keyword_research as kr

    async def _get(candidate_id, *, user_id):
        return _candidate()

    async def _score_difficulty(keyword, **kwargs):
        return kr.KeywordDifficulty(keyword=keyword, difficulty=None, top_domains=[])

    seen: dict = {}

    async def _set_difficulty(candidate_id, *, user_id, difficulty):
        seen["difficulty"] = difficulty
        return _candidate(difficulty=None)

    monkeypatch.setattr(keywords_repo, "get", _get)
    monkeypatch.setattr(kr, "score_difficulty", _score_difficulty)
    monkeypatch.setattr(keywords_repo, "set_difficulty", _set_difficulty)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/score",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["difficulty"] is None
    assert resp.json()["difficulty"] is None


def test_score_keyword_404_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo

    async def _get(candidate_id, *, user_id):
        return None

    monkeypatch.setattr(keywords_repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/score",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------- promote


def test_promote_keyword_creates_proposal_and_marks_promoted(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.topic_proposals as proposals_repo

    cid = uuid4()

    async def _set_status(candidate_id, *, user_id, status, from_statuses):
        assert candidate_id == cid
        assert status == "promoted"
        assert set(from_statuses) == {"candidate", "tracked"}
        return _candidate(
            keyword="best espresso grinders", status="promoted",
            rationale="carried-over rationale",
        )

    created: dict = {}

    async def _create(*, user_id, niche_id, title, focus_keyword, rationale):
        created["title"] = title
        created["focus_keyword"] = focus_keyword
        created["rationale"] = rationale
        created["niche_id"] = niche_id
        return _proposal(title=title, focus_keyword=focus_keyword, rationale=rationale)

    monkeypatch.setattr(keywords_repo, "set_status", _set_status)
    monkeypatch.setattr(proposals_repo, "create", _create)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{cid}/promote",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "promoted"
    assert created["focus_keyword"] == "best espresso grinders"
    assert created["rationale"] == "carried-over rationale"
    assert created["niche_id"] == _NICHE_ID


def test_promote_keyword_404_when_already_promoted(monkeypatch):
    _reset_limiter()
    import marketer.repos.keywords as keywords_repo
    import marketer.repos.topic_proposals as proposals_repo

    async def _set_status(candidate_id, *, user_id, status, from_statuses):
        return None  # already promoted/dismissed — guarded transition fails

    called = {"create": False}

    async def _create(**kwargs):
        called["create"] = True
        return _proposal()

    monkeypatch.setattr(keywords_repo, "set_status", _set_status)
    monkeypatch.setattr(proposals_repo, "create", _create)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/keywords/{uuid4()}/promote",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
    assert called["create"] is False  # no proposal created for a failed transition
