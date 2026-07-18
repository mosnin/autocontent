"""Content intelligence routes (POST/GET /intelligence/*): cluster
planning (fake LLM), promote-to-proposal, audit run/list, and
cannibalization scan/list — all with the repo layer mocked."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

_USER = "user_intel_route"
_NICHE_ID = UUID("77777777-7777-7777-7777-777777777777")
_CLUSTER_ID = UUID("88888888-8888-8888-8888-888888888888")
_ITEM_ID = UUID("99999999-9999-9999-9999-999999999999")


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


def _cluster(**overrides):
    base = dict(
        id=_CLUSTER_ID, user_id=_USER, niche_id=_NICHE_ID, title="The Complete Espresso Guide",
        pillar_keyword="espresso", description="Cluster around 'espresso'",
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    from marketer.repos.content_intel import ContentCluster
    return ContentCluster(**base)


def _item(**overrides):
    base = dict(
        id=_ITEM_ID, cluster_id=_CLUSTER_ID, article_id=None,
        proposed_title="Dialing In Your First Shot", focus_keyword="dial in espresso shot",
        status="proposed",
    )
    base.update(overrides)
    from marketer.repos.content_intel import ContentClusterItem
    return ContentClusterItem(**base)


# --------------------------------------------------------------------------- POST /clusters/plan


def test_plan_cluster_creates_cluster_with_items(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.content_intel as content_intel_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.content_intel as service
    import marketer.services.spend_context as sc

    async def _niche_get(niche_id, *, user_id):
        assert niche_id == _NICHE_ID
        return SimpleNamespace(
            id=niche_id, title="home espresso", description="dial-in guides",
            daily_spend_cap_usd=Decimal("5"),
        )

    async def _brand_get(user_id):
        return None

    async def _ctx(**kwargs):
        return SimpleNamespace()

    async def _recent(niche_id, *, user_id, limit=25):
        return ["Best Espresso Grinders 2026"]

    async def _plan_cluster(niche, brand, corpus_titles, pillar_keyword, *, spend=None):
        assert pillar_keyword == "espresso"
        return service.ClusterPlanResult(
            pillar_title="The Complete Espresso Guide",
            spokes=[
                service.ClusterPlanSpoke(title="Best Espresso Grinders 2026", focus_keyword="best espresso grinders", covered=True),
                service.ClusterPlanSpoke(title="Dialing In Your First Shot", focus_keyword="dial in espresso shot", covered=False),
            ],
        )

    created_items: list[dict] = []

    async def _create_cluster(*, user_id, niche_id, title, pillar_keyword, description):
        return _cluster(title=title, pillar_keyword=pillar_keyword, description=description)

    async def _add_item(*, cluster_id, proposed_title, focus_keyword, status, article_id=None):
        created_items.append({"title": proposed_title, "status": status})
        return _item(proposed_title=proposed_title, focus_keyword=focus_keyword, status=status)

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(sc, "default_context", _ctx)

    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(articles_repo, "recent_titles_for_niche", _recent)
    monkeypatch.setattr(service, "plan_cluster", _plan_cluster)
    monkeypatch.setattr(content_intel_repo, "create_cluster", _create_cluster)
    monkeypatch.setattr(content_intel_repo, "add_item", _add_item)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/intelligence/clusters/plan",
        json={"niche_id": str(_NICHE_ID), "pillar_keyword": "espresso"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "The Complete Espresso Guide"
    assert len(body["items"]) == 2
    assert {i["status"] for i in body["items"]} == {"proposed", "covered"}
    assert len(created_items) == 2


def test_plan_cluster_404_missing_niche(monkeypatch):
    _reset_limiter()
    import marketer.repos.niches as niches_repo

    async def _niche_get(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/intelligence/clusters/plan",
        json={"niche_id": str(_NICHE_ID), "pillar_keyword": "espresso"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_plan_cluster_402_on_spend_cap(monkeypatch):
    _reset_limiter()
    import marketer.repos.brand_kit as brand_kit_repo
    import marketer.repos.niches as niches_repo
    import marketer.services.content_intel as service
    import marketer.services.spend_context as sc
    from marketer.repos.spend import SpendCapExceeded

    async def _niche_get(niche_id, *, user_id):
        return SimpleNamespace(id=niche_id, title="t", description="d", daily_spend_cap_usd=Decimal("1"))

    async def _brand_get(user_id):
        return None

    async def _ctx(**kwargs):
        return SimpleNamespace()

    async def _recent(niche_id, *, user_id, limit=25):
        return []

    async def _plan_cluster(*a, **k):
        raise SpendCapExceeded("niche cap hit", scope="niche")

    monkeypatch.setattr(niches_repo, "get", _niche_get)
    monkeypatch.setattr(brand_kit_repo, "get", _brand_get)
    monkeypatch.setattr(sc, "default_context", _ctx)
    monkeypatch.setattr(service, "plan_cluster", _plan_cluster)

    import marketer.repos.articles as articles_repo
    monkeypatch.setattr(articles_repo, "recent_titles_for_niche", _recent)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/intelligence/clusters/plan",
        json={"niche_id": str(_NICHE_ID), "pillar_keyword": "espresso"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402


# --------------------------------------------------------------------------- clusters CRUD


def test_list_clusters(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _list(user_id, *, limit=100):
        assert user_id == _USER
        return [_cluster()]

    monkeypatch.setattr(content_intel_repo, "list_clusters", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/intelligence/clusters", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_get_cluster_with_items(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _get(cluster_id, *, user_id):
        return _cluster()

    async def _items(cluster_id):
        return [_item()]

    monkeypatch.setattr(content_intel_repo, "get_cluster", _get)
    monkeypatch.setattr(content_intel_repo, "list_items", _items)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/intelligence/clusters/{_CLUSTER_ID}", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1


def test_get_cluster_404(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _get(cluster_id, *, user_id):
        return None

    monkeypatch.setattr(content_intel_repo, "get_cluster", _get)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/intelligence/clusters/{_CLUSTER_ID}", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 404


def test_delete_cluster_ok_and_404(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    calls: list[UUID] = []

    async def _delete(cluster_id, *, user_id):
        calls.append(cluster_id)
        return cluster_id == _CLUSTER_ID

    monkeypatch.setattr(content_intel_repo, "delete_cluster", _delete)
    client = _client(monkeypatch)

    resp_ok = client.delete(f"/api/v1/intelligence/clusters/{_CLUSTER_ID}", headers={"Authorization": "Bearer mkt_x"})
    assert resp_ok.status_code == 204

    resp_missing = client.delete(f"/api/v1/intelligence/clusters/{uuid4()}", headers={"Authorization": "Bearer mkt_x"})
    assert resp_missing.status_code == 404


# --------------------------------------------------------------------------- promote


def test_promote_item_creates_proposal_and_marks_covered(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo
    import marketer.repos.topic_proposals as proposals_repo
    from marketer.repos.content_intel import ClusterItemWithNiche

    async def _get_item(cluster_id, item_id, *, user_id):
        assert cluster_id == _CLUSTER_ID
        assert item_id == _ITEM_ID
        return ClusterItemWithNiche(**_item().model_dump(), niche_id=_NICHE_ID)

    created: dict = {}

    async def _create(*, user_id, niche_id, title, focus_keyword, rationale, score):
        created.update(user_id=user_id, niche_id=niche_id, title=title, focus_keyword=focus_keyword)
        return SimpleNamespace(
            id=uuid4(), user_id=user_id, niche_id=niche_id, title=title,
            focus_keyword=focus_keyword, rationale=rationale, score=score,
            status="pending", created_at=datetime.now(timezone.utc), decided_at=None,
        )

    marked: list[UUID] = []

    async def _mark_covered(item_id, *, article_id=None):
        marked.append(item_id)
        return _item(status="covered")

    monkeypatch.setattr(content_intel_repo, "get_item_with_niche", _get_item)
    monkeypatch.setattr(proposals_repo, "create", _create)
    monkeypatch.setattr(content_intel_repo, "mark_item_covered", _mark_covered)

    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/intelligence/clusters/{_CLUSTER_ID}/items/{_ITEM_ID}/promote",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "Dialing In Your First Shot"
    assert created["niche_id"] == str(_NICHE_ID) or created["niche_id"] == _NICHE_ID
    assert marked == [_ITEM_ID]


def test_promote_item_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _get_item(cluster_id, item_id, *, user_id):
        return None

    monkeypatch.setattr(content_intel_repo, "get_item_with_niche", _get_item)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/intelligence/clusters/{_CLUSTER_ID}/items/{_ITEM_ID}/promote",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404


def test_promote_item_409_when_already_covered(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo
    from marketer.repos.content_intel import ClusterItemWithNiche

    async def _get_item(cluster_id, item_id, *, user_id):
        return ClusterItemWithNiche(**_item(status="covered").model_dump(), niche_id=_NICHE_ID)

    monkeypatch.setattr(content_intel_repo, "get_item_with_niche", _get_item)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/intelligence/clusters/{_CLUSTER_ID}/items/{_ITEM_ID}/promote",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


# --------------------------------------------------------------------------- audit


def test_run_audit_returns_summary(monkeypatch):
    _reset_limiter()
    import marketer.services.content_intel as service

    async def _audit_corpus(user_id):
        assert user_id == _USER
        now = datetime.now(timezone.utc)
        return [
            SimpleNamespace(id=uuid4(), user_id=user_id, article_id=uuid4(), score=90.0, findings=[], created_at=now),
            SimpleNamespace(id=uuid4(), user_id=user_id, article_id=uuid4(), score=10.0, findings=[], created_at=now),
        ]

    monkeypatch.setattr(service, "audit_corpus", _audit_corpus)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/intelligence/audit/run", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["audited"] == 2
    assert body["average_score"] == 50.0
    assert body["low_score_count"] == 1


def test_run_audit_empty_corpus(monkeypatch):
    _reset_limiter()
    import marketer.services.content_intel as service

    async def _audit_corpus(user_id):
        return []

    monkeypatch.setattr(service, "audit_corpus", _audit_corpus)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/intelligence/audit/run", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == {"audited": 0, "average_score": 0.0, "low_score_count": 0}


def test_list_audits(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _latest(user_id, *, limit=500):
        now = datetime.now(timezone.utc)
        return [
            content_intel_repo.ArticleAudit(
                id=uuid4(), user_id=user_id, article_id=uuid4(), score=77.5,
                findings=[{"code": "aging", "severity": "medium", "message": "m"}],
                created_at=now,
            )
        ]

    monkeypatch.setattr(content_intel_repo, "latest_audits", _latest)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/intelligence/audit", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json()[0]["score"] == 77.5


# --------------------------------------------------------------------------- cannibalization


def test_scan_cannibalization(monkeypatch):
    _reset_limiter()
    import marketer.services.content_intel as service

    async def _detect(user_id):
        assert user_id == _USER
        return []

    monkeypatch.setattr(service, "detect_cannibalization", _detect)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/intelligence/cannibalization/scan", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_cannibalization(monkeypatch):
    _reset_limiter()
    import marketer.repos.content_intel as content_intel_repo

    async def _list(user_id, *, limit=500):
        now = datetime.now(timezone.utc)
        return [
            content_intel_repo.CannibalizationFinding(
                id=uuid4(), user_id=user_id, article_a=uuid4(), article_b=uuid4(),
                keyword="best espresso grinders", similarity=0.91, resolution="",
                created_at=now,
            )
        ]

    monkeypatch.setattr(content_intel_repo, "list_findings", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/intelligence/cannibalization", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json()[0]["similarity"] == 0.91
