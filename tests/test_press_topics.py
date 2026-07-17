"""Topic proposals — the approval loop (POST /press/topics/generate,
GET /press/topics, POST /press/topics/{id}/approve|reject)."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from marketer.repos.topic_proposals import TopicProposal

_USER = "user_press_topics"
_NICHE_ID = UUID("77777777-7777-7777-7777-777777777777")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="p@p.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _proposal(*, status="pending", title="Best espresso grinders 2026") -> TopicProposal:
    return TopicProposal(
        id=uuid4(), user_id=_USER, niche_id=_NICHE_ID, title=title,
        focus_keyword="best espresso grinders", rationale="high intent, low competition",
        score=0.8, status=status, created_at=datetime.now(timezone.utc),
    )


def test_generate_topics_creates_proposals(monkeypatch):
    _reset_limiter()
    import marketer.articles.llm as llm
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.niches as niches_repo
    import marketer.repos.topic_proposals as proposals_repo
    import marketer.services.spend_context as sc
    from marketer.articles.models import TopicProposalPick

    async def _niche_get(niche_id, *, user_id):
        assert niche_id == _NICHE_ID
        return SimpleNamespace(
            id=niche_id, title="home espresso", description="dial-in guides",
            daily_spend_cap_usd=Decimal("5"),
        )

    async def _brand_get(user_id):
        return None

    async def _recent(niche_id, *, user_id, limit=25):
        return ["Old post"]

    async def _ctx(**kwargs):
        return SimpleNamespace()

    seen_n: dict = {}

    async def _propose(niche, brand, recent, n, *, spend=None):
        seen_n["n"] = n
        return [
            TopicProposalPick(title=f"Topic {i}", focusKeyword=f"kw{i}", rationale="r", score=0.5)
            for i in range(n)
        ]

    created: list[dict] = []

    async def _create(*, user_id, niche_id, title, focus_keyword, rationale, score):
        created.append({"title": title, "focus_keyword": focus_keyword, "score": score})
        return _proposal(title=title)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(llm, "propose_topics", _propose)
    monkeypatch.setattr(proposals_repo, "create", _create)

    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(articles_repo, "recent_titles_for_niche", _recent)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/topics/generate",
        json={"niche_id": str(_NICHE_ID), "n": 3},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen_n["n"] == 3
    assert len(created) == 3
    assert len(resp.json()) == 3


def test_generate_topics_defaults_n_to_press_topic_batch(monkeypatch):
    _reset_limiter()
    import marketer.articles.llm as llm
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.niches as niches_repo
    import marketer.repos.topic_proposals as proposals_repo
    import marketer.services.spend_context as sc
    from marketer.config import settings

    monkeypatch.setattr(settings, "press_topic_batch", 2)

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(
            id=niche_id, title="t", description="d", daily_spend_cap_usd=None,
        )

    async def _brand_get(user_id):
        return None

    async def _recent(niche_id, *, user_id, limit=25):
        return []

    async def _ctx(**kwargs):
        return SimpleNamespace()

    seen_n: dict = {}

    async def _propose(niche, brand, recent, n, *, spend=None):
        seen_n["n"] = n
        return []

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(llm, "propose_topics", _propose)
    monkeypatch.setattr(proposals_repo, "create", lambda **kw: None)

    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(articles_repo, "recent_titles_for_niche", _recent)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/topics/generate",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen_n["n"] == 2


def test_generate_topics_404_missing_niche(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/topics/generate",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_generate_topics_402_on_spend_cap(monkeypatch):
    _reset_limiter()
    import marketer.articles.llm as llm
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.spend_context as sc
    from marketer.repos.spend import SpendCapExceeded

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, title="t", description="d", daily_spend_cap_usd=Decimal("1"))

    async def _brand_get(user_id):
        return None

    async def _recent(niche_id, *, user_id, limit=25):
        return []

    async def _ctx(**kwargs):
        return SimpleNamespace()

    async def _propose(*a, **k):
        raise SpendCapExceeded("niche cap hit", scope="niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(llm, "propose_topics", _propose)

    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(articles_repo, "recent_titles_for_niche", _recent)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/topics/generate",
        json={"niche_id": str(_NICHE_ID)},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402


def test_list_topics_passes_status_filter(monkeypatch):
    _reset_limiter()
    import marketer.repos.topic_proposals as proposals_repo

    seen: dict = {}

    async def _list(user_id, *, status=None, niche_id=None, limit=100):
        seen["status"] = status
        seen["niche_id"] = niche_id
        return [_proposal(status="approved")]

    monkeypatch.setattr(proposals_repo, "list_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/press/topics?status=approved",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "approved"
    assert resp.json()[0]["status"] == "approved"


def test_list_topics_rejects_bad_status(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/press/topics?status=bogus",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_approve_topic_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.topic_proposals as proposals_repo

    pid = uuid4()
    seen: dict = {}

    async def _decide(proposal_id, *, user_id, status):
        seen["status"] = status
        return _proposal(status=status)

    monkeypatch.setattr(proposals_repo, "decide", _decide)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/topics/{pid}/approve",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "approved"
    assert resp.json()["status"] == "approved"


def test_reject_topic_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.topic_proposals as proposals_repo

    seen: dict = {}

    async def _decide(proposal_id, *, user_id, status):
        seen["status"] = status
        return _proposal(status=status)

    monkeypatch.setattr(proposals_repo, "decide", _decide)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/topics/{uuid4()}/reject",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert seen["status"] == "rejected"


def test_approve_topic_404_when_already_decided(monkeypatch):
    _reset_limiter()
    import marketer.repos.topic_proposals as proposals_repo

    async def _decide(proposal_id, *, user_id, status):
        return None

    monkeypatch.setattr(proposals_repo, "decide", _decide)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/press/topics/{uuid4()}/approve",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
