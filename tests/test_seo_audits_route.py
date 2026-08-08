"""Route tests for /api/v1/seo-audits.

The repo, Context.dev, and the auditor's scrape half are all monkeypatched;
auth is bypassed via dependency_overrides. No DB, no network. Covers user
scoping, the fail-closed 409 gate, the stored-audit cache and its `refresh`
override, the text/plain prompt download, and 404s on foreign or missing rows.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.repos import seo_audits as seo_audits_repo
from marketer.seoaudit import audit as seo_audit
from marketer.seoaudit.audit import build_rule_context, score_context
from marketer.services.context_dev import ContextDevUnavailable

USER = "user_seo"
OTHER_USER = "user_other"
AUTH = {"Authorization": "Bearer mkt_x"}
AUDIT_ID = UUID("77777777-7777-7777-7777-777777777777")

_PAGE_HTML = (
    "<html><head><title>Acme</title>"
    '<link rel="canonical" href="https://acme.example/">'
    "</head><body><h1>Acme</h1>"
    "<p>Acme is a platform that helps teams ship faster every single week.</p>"
    "</body></html>"
)


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake_require_user():
        return AuthCtx(user_id=USER, email="s@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _enable_feature(monkeypatch):
    """On by default here; individual tests switch it back off."""
    monkeypatch.setattr(settings, "seo_audit_enabled", True)
    monkeypatch.setattr(settings, "context_dev_api_key", "ctx-test")
    monkeypatch.setattr(settings, "seo_audit_cache_ttl_sec", 86_400)
    _reset_limiter()
    yield


def _make_result(url: str = "https://acme.example/"):
    ctx = build_rule_context(url=url, markdown="", html=_PAGE_HTML)
    return score_context(ctx)


def _make_row(*, audit_id: UUID = AUDIT_ID, url: str = "https://acme.example/") -> dict:
    result = _make_result(url)
    return {
        "id": audit_id,
        "user_id": USER,
        "url": result.url,
        "host": result.host,
        "score": result.score,
        "band": result.band.label,
        "schema_version": seo_audit.CACHE_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc),
        "result": result.model_dump(mode="json"),
    }


class FakeStore:
    """In-memory stand-in for the seo_audits repo, scoped by user like the
    real one so foreign-row lookups can be exercised."""

    def __init__(self) -> None:
        self.rows: dict[UUID, dict] = {}
        self.fresh: dict | None = None
        self.find_fresh_calls: list[dict] = []
        self.created: list[dict] = []

    def install(self, monkeypatch) -> FakeStore:
        monkeypatch.setattr(seo_audits_repo, "create", self.create)
        monkeypatch.setattr(seo_audits_repo, "find_fresh", self.find_fresh)
        monkeypatch.setattr(seo_audits_repo, "get", self.get)
        monkeypatch.setattr(seo_audits_repo, "list_for_user", self.list_for_user)
        monkeypatch.setattr(seo_audits_repo, "delete", self.delete)
        return self

    async def create(self, **kwargs) -> dict:
        self.created.append(kwargs)
        row = {
            "id": uuid4(),
            "user_id": kwargs["user_id"],
            "url": kwargs["url"],
            "host": kwargs["host"],
            "score": kwargs["score"],
            "band": kwargs["band"],
            "schema_version": kwargs["schema_version"],
            "created_at": datetime.now(timezone.utc),
            "result": kwargs["result"],
        }
        self.rows[row["id"]] = row
        return row

    async def find_fresh(self, *, user_id: str, cache_key: str, max_age_sec: int):
        self.find_fresh_calls.append(
            {"user_id": user_id, "cache_key": cache_key, "max_age_sec": max_age_sec}
        )
        if self.fresh and self.fresh["user_id"] == user_id:
            return self.fresh
        return None

    async def get(self, audit_id: UUID, *, user_id: str):
        row = self.rows.get(audit_id)
        return row if row and row["user_id"] == user_id else None

    async def list_for_user(self, user_id: str, *, limit: int = 50) -> list[dict]:
        rows = [r for r in self.rows.values() if r["user_id"] == user_id]
        return rows[:limit]

    async def delete(self, audit_id: UUID, *, user_id: str) -> bool:
        row = self.rows.get(audit_id)
        if row and row["user_id"] == user_id:
            del self.rows[audit_id]
            return True
        return False


def _stub_run_audit(monkeypatch, result=None, error: Exception | None = None) -> list[str]:
    """Replace the whole scrape+score pipeline. Context.dev is never reached."""
    calls: list[str] = []

    async def _run(url: str):
        calls.append(url)
        if error:
            raise error
        return result if result is not None else _make_result(url)

    monkeypatch.setattr(seo_audit, "run_audit", _run)
    return calls


# ---------------------------------------------------------------------------
# Feature gate: 409, never a 500
# ---------------------------------------------------------------------------


def test_post_conflicts_when_the_feature_flag_is_off(monkeypatch):
    monkeypatch.setattr(settings, "seo_audit_enabled", False)
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)
    assert resp.status_code == 409
    assert "not enabled" in resp.json()["detail"]


def test_post_conflicts_when_context_dev_is_unconfigured(monkeypatch):
    """A missing vendor key is a deployment state, not a server error."""
    monkeypatch.setattr(settings, "context_dev_api_key", "   ")
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)
    assert resp.status_code == 409
    assert "context.dev is not configured" in resp.json()["detail"]


def test_the_gate_runs_before_any_scraping(monkeypatch):
    monkeypatch.setattr(settings, "seo_audit_enabled", False)
    store = FakeStore().install(monkeypatch)
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)
    client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)
    assert calls == []
    assert store.find_fresh_calls == []


# ---------------------------------------------------------------------------
# POST: validation, scoring, persistence
# ---------------------------------------------------------------------------


def test_post_runs_an_audit_and_stores_it(monkeypatch):
    store = FakeStore().install(monkeypatch)
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)

    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["cached"] is False
    assert body["host"] == "acme.example"
    assert body["audit"]["url"] == "https://acme.example/"
    assert len(body["audit"]["categories"]) == 6
    # Stored against the caller, with the current cache-schema generation.
    assert calls == ["https://acme.example/"]
    assert store.created[0]["user_id"] == USER
    assert store.created[0]["schema_version"] == seo_audit.CACHE_SCHEMA_VERSION
    assert store.created[0]["band"] == body["audit"]["band"]["label"]


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("acme.example", "https://acme.example/"),
        ("https://www.acme.example/a?q=1#frag", "https://acme.example/a?q=1"),
        ("HTTPS://ACME.EXAMPLE/Path", "https://acme.example/Path"),
        # The scheme's default port is dropped so one page has one cache key.
        ("https://acme.example:443/x", "https://acme.example/x"),
    ],
)
def test_post_normalizes_the_submitted_url(monkeypatch, raw, normalized):
    FakeStore().install(monkeypatch)
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": raw}, headers=AUTH)
    assert resp.status_code == 200
    assert calls == [normalized]


@pytest.mark.parametrize("raw", ["localhost", "not a url", "ftp://acme.example/", "https://"])
def test_post_rejects_unusable_urls(monkeypatch, raw):
    FakeStore().install(monkeypatch)
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": raw}, headers=AUTH)
    assert resp.status_code == 400
    assert calls == []


def test_post_rejects_an_empty_url_before_the_handler(monkeypatch):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": ""}, headers=AUTH)
    assert resp.status_code == 422


def test_post_surfaces_a_vendor_outage_as_502(monkeypatch):
    FakeStore().install(monkeypatch)
    _stub_run_audit(monkeypatch, error=ContextDevUnavailable("context.dev could not fetch"))
    client = _client(monkeypatch)
    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)
    assert resp.status_code == 502
    assert "could not fetch" in resp.json()["detail"]


def test_a_vendor_outage_stores_nothing(monkeypatch):
    """A failed scrape must not persist a near-zero score as if the page were
    genuinely that bad."""
    store = FakeStore().install(monkeypatch)
    _stub_run_audit(monkeypatch, error=ContextDevUnavailable("down"))
    client = _client(monkeypatch)
    client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)
    assert store.created == []


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------


def test_a_fresh_stored_audit_is_served_without_rescraping(monkeypatch):
    store = FakeStore().install(monkeypatch)
    store.fresh = _make_row()
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)

    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)

    assert resp.status_code == 200
    assert resp.json()["cached"] is True
    assert resp.json()["id"] == str(AUDIT_ID)
    assert calls == []
    assert store.created == []


def test_the_cache_lookup_is_scoped_to_the_caller_and_the_ttl(monkeypatch):
    """An audit row is a tenant artifact: a shared cache would hand out another
    tenant's row id and audit history."""
    monkeypatch.setattr(settings, "seo_audit_cache_ttl_sec", 1_800)
    store = FakeStore().install(monkeypatch)
    _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)
    client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)

    call = store.find_fresh_calls[0]
    assert call["user_id"] == USER
    assert call["max_age_sec"] == 1_800
    assert call["cache_key"] == seo_audit.audit_cache_key("https://acme.example/")


def test_another_tenants_stored_audit_is_never_served(monkeypatch):
    store = FakeStore().install(monkeypatch)
    foreign = _make_row()
    foreign["user_id"] = OTHER_USER
    store.fresh = foreign
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)

    resp = client.post("/api/v1/seo-audits", json={"url": "acme.example"}, headers=AUTH)

    assert resp.status_code == 200
    assert resp.json()["cached"] is False
    assert calls == ["https://acme.example/"]


def test_refresh_true_skips_the_cache(monkeypatch):
    store = FakeStore().install(monkeypatch)
    store.fresh = _make_row()
    calls = _stub_run_audit(monkeypatch)
    client = _client(monkeypatch)

    resp = client.post(
        "/api/v1/seo-audits", json={"url": "acme.example", "refresh": True}, headers=AUTH
    )

    assert resp.status_code == 200
    assert resp.json()["cached"] is False
    assert calls == ["https://acme.example/"]
    # The cache is not even consulted.
    assert store.find_fresh_calls == []


def test_the_cache_key_is_per_url_and_per_schema_version():
    a = seo_audit.audit_cache_key("https://acme.example/a")
    b = seo_audit.audit_cache_key("https://acme.example/b")
    assert a != b
    assert len(a) == 64
    # Bumping the schema version must retire the whole cache generation.
    original = seo_audit.CACHE_SCHEMA_VERSION
    try:
        seo_audit.CACHE_SCHEMA_VERSION = "v-next"
        assert seo_audit.audit_cache_key("https://acme.example/a") != a
    finally:
        seo_audit.CACHE_SCHEMA_VERSION = original


# ---------------------------------------------------------------------------
# GET list / detail
# ---------------------------------------------------------------------------


def test_list_returns_summaries_for_the_caller_only(monkeypatch):
    store = FakeStore().install(monkeypatch)
    mine = _make_row()
    theirs = _make_row(audit_id=uuid4())
    theirs["user_id"] = OTHER_USER
    store.rows[mine["id"]] = mine
    store.rows[theirs["id"]] = theirs

    client = _client(monkeypatch)
    resp = client.get("/api/v1/seo-audits", headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert [row["id"] for row in body] == [str(AUDIT_ID)]
    # The list view never ships the multi-hundred-KB result blob.
    assert "audit" not in body[0]
    assert set(body[0]) == {"id", "url", "host", "score", "band", "created_at"}


def test_list_works_when_the_feature_is_disabled(monkeypatch):
    """History stays readable after the flag is switched off."""
    monkeypatch.setattr(settings, "seo_audit_enabled", False)
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    store.rows[row["id"]] = row
    client = _client(monkeypatch)
    assert client.get("/api/v1/seo-audits", headers=AUTH).status_code == 200


@pytest.mark.parametrize("limit", ["0", "201", "-1", "abc"])
def test_list_rejects_a_bad_limit(monkeypatch, limit):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/seo-audits?limit={limit}", headers=AUTH)
    assert resp.status_code == 422


def test_get_returns_the_full_stored_result(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    store.rows[row["id"]] = row
    client = _client(monkeypatch)

    resp = client.get(f"/api/v1/seo-audits/{AUDIT_ID}", headers=AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["cached"] is True
    assert len(body["audit"]["categories"]) == 6
    assert body["audit"]["agent_prompts"]["full"]


def test_get_404s_on_a_missing_audit(monkeypatch):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    assert client.get(f"/api/v1/seo-audits/{uuid4()}", headers=AUTH).status_code == 404


def test_get_404s_on_another_tenants_audit(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    row["user_id"] = OTHER_USER
    store.rows[row["id"]] = row
    client = _client(monkeypatch)
    assert client.get(f"/api/v1/seo-audits/{AUDIT_ID}", headers=AUTH).status_code == 404


def test_get_422s_on_a_non_uuid_id(monkeypatch):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    assert client.get("/api/v1/seo-audits/not-a-uuid", headers=AUTH).status_code == 422


# ---------------------------------------------------------------------------
# Prompt download
# ---------------------------------------------------------------------------


def test_prompt_downloads_as_plain_text(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    store.rows[row["id"]] = row
    client = _client(monkeypatch)

    resp = client.get(f"/api/v1/seo-audits/{AUDIT_ID}/prompt", headers=AUTH)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.text.startswith("You are an AI SEO implementation agent.")
    disposition = resp.headers["content-disposition"]
    assert disposition == (
        f'attachment; filename="seo-audit-acme.example-{AUDIT_ID}.txt"'
    )


def test_prompt_404s_on_a_missing_audit(monkeypatch):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/seo-audits/{uuid4()}/prompt", headers=AUTH)
    assert resp.status_code == 404


def test_prompt_404s_on_another_tenants_audit(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    row["user_id"] = OTHER_USER
    store.rows[row["id"]] = row
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/seo-audits/{AUDIT_ID}/prompt", headers=AUTH)
    assert resp.status_code == 404


def test_prompt_404s_when_a_stored_audit_predates_prompt_generation(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    row["result"]["agent_prompts"] = {"full": "", "top_issues": []}
    store.rows[row["id"]] = row
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/seo-audits/{AUDIT_ID}/prompt", headers=AUTH)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "audit has no fix prompt"


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


def test_delete_removes_the_audit(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    store.rows[row["id"]] = row
    client = _client(monkeypatch)

    resp = client.delete(f"/api/v1/seo-audits/{AUDIT_ID}", headers=AUTH)

    assert resp.status_code == 204
    assert store.rows == {}


def test_delete_404s_on_a_missing_audit(monkeypatch):
    FakeStore().install(monkeypatch)
    client = _client(monkeypatch)
    assert client.delete(f"/api/v1/seo-audits/{uuid4()}", headers=AUTH).status_code == 404


def test_delete_404s_on_another_tenants_audit(monkeypatch):
    store = FakeStore().install(monkeypatch)
    row = _make_row()
    row["user_id"] = OTHER_USER
    store.rows[row["id"]] = row
    client = _client(monkeypatch)

    assert client.delete(f"/api/v1/seo-audits/{AUDIT_ID}", headers=AUTH).status_code == 404
    # ...and it is still there.
    assert AUDIT_ID in store.rows


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/seo-audits"),
        ("post", "/api/v1/seo-audits"),
        ("get", f"/api/v1/seo-audits/{AUDIT_ID}"),
        ("get", f"/api/v1/seo-audits/{AUDIT_ID}/prompt"),
        ("delete", f"/api/v1/seo-audits/{AUDIT_ID}"),
    ],
)
def test_every_endpoint_requires_authentication(monkeypatch, method, path):
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    FakeStore().install(monkeypatch)

    from backend.main import create_app

    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.request(method.upper(), path, json={"url": "acme.example"})
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Orchestration (audit.py) — the route's direct dependency
# ---------------------------------------------------------------------------


def _stub_scrapes(monkeypatch, *, markdown=None, html=None):
    """Replace the two Context.dev calls. Pass an Exception to fail one."""
    from marketer.services import context_dev

    async def _md(url: str, **kwargs):
        if isinstance(markdown, Exception):
            raise markdown
        return markdown or ""

    async def _html(url: str, **kwargs):
        if isinstance(html, Exception):
            raise html
        return html or ""

    monkeypatch.setattr(context_dev, "scrape_markdown", _md)
    monkeypatch.setattr(context_dev, "scrape_html", _html)


async def test_run_audit_refuses_when_the_feature_is_off(monkeypatch):
    monkeypatch.setattr(settings, "seo_audit_enabled", False)
    with pytest.raises(seo_audit.SeoAuditDisabled):
        await seo_audit.run_audit("https://acme.example/")


async def test_run_audit_refuses_when_context_dev_is_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "context_dev_api_key", "")
    with pytest.raises(seo_audit.SeoAuditDisabled):
        await seo_audit.run_audit("https://acme.example/")


async def test_run_audit_scores_both_scrapes(monkeypatch):
    _stub_scrapes(monkeypatch, markdown="# Acme\n\nAcme is a platform.", html=_PAGE_HTML)
    result = await seo_audit.run_audit("https://acme.example/")
    assert result.diagnostics.context_dev_markdown == "ready"
    assert result.diagnostics.context_dev_html == "ready"
    assert result.score > 0


async def test_run_audit_survives_a_failed_markdown_scrape(monkeypatch):
    """One half failing must degrade, not abort: the page is still auditable
    from the raw HTML, and the diagnostics say which half landed so a low
    score is never mistaken for a scrape problem."""
    _stub_scrapes(monkeypatch, markdown=ContextDevUnavailable("md down"), html=_PAGE_HTML)
    result = await seo_audit.run_audit("https://acme.example/")
    assert result.diagnostics.context_dev_markdown == "failed"
    assert result.diagnostics.context_dev_html == "ready"
    assert result.title == "Acme"


async def test_run_audit_survives_a_failed_html_scrape(monkeypatch):
    _stub_scrapes(
        monkeypatch, markdown="# Acme\n\nAcme is a platform.", html=ContextDevUnavailable("x")
    )
    result = await seo_audit.run_audit("https://acme.example/")
    assert result.diagnostics.context_dev_markdown == "ready"
    assert result.diagnostics.context_dev_html == "failed"


async def test_run_audit_raises_when_both_scrapes_fail(monkeypatch):
    """Nothing was seen, so persisting a near-zero score would be a lie about
    the page. Surface the vendor failure instead."""
    _stub_scrapes(
        monkeypatch,
        markdown=ContextDevUnavailable("md down"),
        html=ContextDevUnavailable("html down"),
    )
    with pytest.raises(ContextDevUnavailable):
        await seo_audit.run_audit("https://acme.example/")


async def test_run_audit_reports_empty_scrapes_distinctly_from_failed_ones(monkeypatch):
    _stub_scrapes(monkeypatch, markdown="", html="")
    result = await seo_audit.run_audit("https://acme.example/")
    assert result.diagnostics.context_dev_markdown == "empty"
    assert result.diagnostics.context_dev_html == "empty"


async def test_find_fresh_short_circuits_when_the_ttl_is_disabled():
    """A zero or negative TTL turns caching off without touching the DB —
    there is no pool in this test, so a query would raise."""
    assert await seo_audits_repo.find_fresh(user_id=USER, cache_key="k", max_age_sec=0) is None
    assert await seo_audits_repo.find_fresh(user_id=USER, cache_key="k", max_age_sec=-1) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://www.acme.example/x", "acme.example"),
        ("https://acme.example:8443/x", "acme.example"),
        ("not a url", "not a url"),
    ],
)
def test_display_host_strips_www(raw, expected):
    assert seo_audit.display_host(raw) == expected
