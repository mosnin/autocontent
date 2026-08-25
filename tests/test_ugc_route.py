"""Route-level tests for /api/v1/ugc.

Repos, the MUAPI client, the SSRF resolver, and the spend context are all
monkeypatched; auth is bypassed via dependency_overrides. No DB, no
network. Covers the fail-closed config gate, pre-spend parameter
validation, metering order, and — explicitly — that the provider webhook
refuses unsigned and wrong-secret deliveries.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.repos import ugc_renders as renders_repo
from marketer.services import muapi
from marketer.services.spend_context import SpendContext
from marketer.ugc import render as render_svc

USER = "user_ugc"
AUTH = {"Authorization": "Bearer mkt_x"}
SECRET = "webhook-s3cret"


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import ugc as ugc_routes

    async def _fake():
        return AuthCtx(user_id=USER, email="u@t.com")

    app = create_app()
    # The router is mounted here when main.py hasn't wired it yet, so this
    # suite exercises the real router either way.
    mounted = any(
        str(getattr(r, "path", "")).startswith("/api/v1/ugc") for r in app.routes
    )
    if not mounted:
        app.include_router(ugc_routes.router, prefix="/api/v1/ugc", tags=["ugc"])
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


class FakeStore:
    """In-memory stand-in for the ugc_renders repo."""

    def __init__(self) -> None:
        self.rows: dict[UUID, dict] = {}

    def seed(self, **over) -> dict:
        row = {
            "id": uuid4(),
            "user_id": USER,
            "niche_id": None,
            "model_id": "grok-video",
            "prompt": "say hi",
            "render_mode": "text_to_video",
            "aspect_ratio": "9:16",
            "resolution": "480p",
            "mode": "normal",
            "duration_sec": 6,
            "image_urls": [],
            "provider": "muapi",
            "provider_request_id": None,
            "status": "queued",
            "video_url": None,
            "error": None,
            "est_cost_usd": "0.3000",
        }
        row.update(over)
        self.rows[row["id"]] = row
        return row

    def by_request(self, request_id: str) -> dict | None:
        for row in self.rows.values():
            if row.get("provider_request_id") == request_id:
                return row
        return None


@pytest.fixture
def env(monkeypatch):
    """Configured + enabled UGC, stubbed repo/provider/SSRF/spend."""
    monkeypatch.setattr(settings, "ugc_enabled", True)
    monkeypatch.setattr(settings, "muapi_api_key", "mu-key")
    monkeypatch.setattr(settings, "muapi_webhook_url", "https://app.example.com")
    monkeypatch.setattr(settings, "muapi_webhook_secret", SECRET)
    monkeypatch.setattr(settings, "ugc_max_reference_images", 7)
    monkeypatch.setattr(settings, "billing_enabled", False)

    store = FakeStore()
    submits: list[dict] = []
    spent: list[dict] = []
    preflight: list[Decimal] = []

    async def fake_create(**kw):
        return store.seed(
            model_id=kw["model_id"], prompt=kw["prompt"],
            render_mode=kw["render_mode"], aspect_ratio=kw["aspect_ratio"],
            resolution=kw.get("resolution", ""), mode=kw.get("mode", ""),
            duration_sec=kw["duration_sec"], image_urls=kw.get("image_urls") or [],
            niche_id=kw.get("niche_id"), est_cost_usd=str(kw.get("est_cost_usd", "0")),
            user_id=kw["user_id"],
        )

    async def fake_get(render_id, *, user_id):
        row = store.rows.get(render_id)
        return row if row and row["user_id"] == user_id else None

    async def fake_list(user_id, *, status=None, limit=50):
        rows = [r for r in store.rows.values() if r["user_id"] == user_id]
        if status:
            rows = [r for r in rows if r["status"] == status]
        return rows[:limit]

    async def fake_attach(render_id, *, user_id, provider_request_id):
        row = store.rows.get(render_id)
        if not row or row["status"] != "queued":
            return None
        row.update(provider_request_id=provider_request_id, status="running")
        return row

    async def fake_fail_by_id(render_id, *, user_id, error):
        row = store.rows.get(render_id)
        if not row or row["status"] not in renders_repo.PENDING_STATUSES:
            return None
        row.update(status="failed", error=error)
        return row

    async def fake_by_request(request_id):
        return store.by_request(request_id)

    async def fake_complete(request_id, *, video_url):
        row = store.by_request(request_id)
        if not row or row["status"] not in renders_repo.PENDING_STATUSES:
            return None
        row.update(status="done", video_url=video_url, error=None)
        return row

    async def fake_fail(request_id, *, error):
        row = store.by_request(request_id)
        if not row or row["status"] not in renders_repo.PENDING_STATUSES:
            return None
        row.update(status="failed", error=error)
        return row

    async def fake_mark_running(request_id):
        row = store.by_request(request_id)
        if not row or row["status"] != "queued":
            return None
        row["status"] = "running"
        return row

    async def fake_claim_retry(render_id, *, user_id):
        row = store.rows.get(render_id)
        if not row or row["user_id"] != user_id or row["status"] != "failed":
            return None
        row.update(status="queued", error=None, video_url=None, provider_request_id=None)
        return row

    async def fake_delete(render_id, *, user_id):
        row = store.rows.get(render_id)
        if not row or row["user_id"] != user_id:
            return False
        del store.rows[render_id]
        return True

    for name, fn in [
        ("create", fake_create), ("get", fake_get), ("list_for_user", fake_list),
        ("attach_request", fake_attach), ("fail_by_id", fake_fail_by_id),
        ("get_by_request_id", fake_by_request), ("complete", fake_complete),
        ("fail", fake_fail), ("mark_running", fake_mark_running),
        ("claim_for_retry", fake_claim_retry), ("delete", fake_delete),
    ]:
        monkeypatch.setattr(renders_repo, name, fn)

    async def fake_submit(*, endpoint, prompt, image_urls, params):
        submits.append(
            {"endpoint": endpoint, "prompt": prompt,
             "image_urls": list(image_urls), "params": dict(params)}
        )
        return f"req-{len(submits)}"

    monkeypatch.setattr(muapi, "submit", fake_submit)
    # Every reference URL passes the public-address check unless a test
    # overrides this; the real resolver does DNS.
    monkeypatch.setattr(render_svc, "check_public_url", lambda url: (True, ""))

    async def fake_record(entry):
        spent.append(entry)

    async def fake_today_spend(*, user_id, niche_id):
        return Decimal(0)

    state = {"cap": None}

    async def fake_build_spend(user_id, niche_id):
        ctx = SpendContext(
            user_id=user_id, niche_id=niche_id, job_id=None,
            record=fake_record, cap_usd=state["cap"],
            today_spend=fake_today_spend,
        )
        original = ctx.ensure_can_spend

        async def _tracked(estimated):
            preflight.append(estimated)
            await original(estimated)

        ctx.ensure_can_spend = _tracked  # type: ignore[method-assign]
        return ctx

    monkeypatch.setattr(render_svc, "build_spend", fake_build_spend)

    return {
        "store": store, "submits": submits, "spent": spent,
        "preflight": preflight, "state": state,
    }


# ------------------------------------------------------------ config gate


def test_models_409_when_disabled(monkeypatch):
    _reset_limiter()
    monkeypatch.setattr(settings, "ugc_enabled", False)
    monkeypatch.setattr(settings, "muapi_api_key", "")
    resp = _client(monkeypatch).get("/api/v1/ugc/models", headers=AUTH)
    assert resp.status_code == 409
    assert "MARKETER_UGC_ENABLED" in resp.json()["detail"]


def test_create_409_when_key_missing(monkeypatch, env):
    _reset_limiter()
    monkeypatch.setattr(settings, "muapi_api_key", "")
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders", json={"model_id": "grok-video", "prompt": "hi"},
        headers=AUTH,
    )
    assert resp.status_code == 409
    assert env["submits"] == []


# ------------------------------------------------------------ catalog


def test_models_returns_capabilities_for_the_ui(monkeypatch, env):
    _reset_limiter()
    body = _client(monkeypatch).get("/api/v1/ugc/models", headers=AUTH).json()
    assert body["max_reference_images"] == 7
    by_id = {m["id"]: m for m in body["models"]}
    # The four ported MUAPI models plus Seedance 2.5's four routes.
    assert {"grok-video", "veo-3-1", "happy-horse", "seedance-2"} <= set(by_id)
    assert len([i for i in by_id if i.startswith("seedance-2.5-")]) == 4

    grok = by_id["grok-video"]
    assert grok["duration"] == {"kind": "range", "min": 6, "max": 30, "default": 6}
    assert grok["modes"] == ["fun", "normal", "spicy"]
    assert grok["cost_basis"]["by_resolution"]["720p"] == "0.10"

    veo = by_id["veo-3-1"]
    assert veo["duration"] == {"kind": "options", "options": [8], "default": 8}
    assert veo["modes"] == []
    assert by_id["happy-horse"]["resolutions"] == []


# ------------------------------------------------------------ validation (pre-spend)


@pytest.mark.parametrize(
    "payload,fragment",
    [
        ({"model_id": "nope", "prompt": "hi"}, "unknown model"),
        ({"model_id": "veo-3-1", "prompt": "hi", "aspect_ratio": "21:9"}, "aspect ratio"),
        ({"model_id": "veo-3-1", "prompt": "hi", "duration": 7}, "duration"),
        ({"model_id": "veo-3-1", "prompt": "hi", "resolution": "8k"}, "resolution"),
        ({"model_id": "happy-horse", "prompt": "hi", "resolution": "720p"},
         "no resolution parameter"),
        ({"model_id": "seedance-2", "prompt": "hi", "mode": "fun"}, "no mode parameter"),
        ({"model_id": "grok-video", "prompt": ""}, "script is required"),
        ({"model_id": "grok-video", "prompt": "@image1 waves"}, "no reference images"),
    ],
)
def test_bad_parameters_are_400_before_any_provider_call(monkeypatch, env, payload, fragment):
    _reset_limiter()
    resp = _client(monkeypatch).post("/api/v1/ugc/renders", json=payload, headers=AUTH)
    assert resp.status_code == 400, resp.text
    assert fragment in resp.json()["detail"]
    assert env["submits"] == []
    assert env["spent"] == []


def test_too_many_reference_images_is_400(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={
            "model_id": "seedance-2", "prompt": "hi",
            "image_urls": [f"https://cdn.example.com/{i}.png" for i in range(8)],
        },
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "over the 7-image limit" in resp.json()["detail"]
    assert env["submits"] == []


def test_private_reference_url_is_refused(monkeypatch, env):
    _reset_limiter()
    monkeypatch.setattr(
        render_svc, "check_public_url",
        lambda url: (False, "host resolves to a non-public address (10.0.0.5)"),
    )
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "seedance-2", "prompt": "hi",
              "image_urls": ["https://internal.example.com/a.png"]},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "non-public address" in resp.json()["detail"]
    assert env["submits"] == []


def test_dangling_image_reference_is_400(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "seedance-2", "prompt": "@image1 holds @image3",
              "image_urls": ["https://cdn.example.com/a.png",
                             "https://cdn.example.com/b.png"]},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "@image3" in resp.json()["detail"]
    assert env["submits"] == []


# ------------------------------------------------------------ submit + metering


def test_create_render_submits_and_meters(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={
            "model_id": "seedance-2",
            "prompt": "@image1 holds up @image2 and says it changed her mornings",
            "duration": 10,
            "image_urls": ["https://cdn.example.com/a.png",
                           "https://cdn.example.com/b.png"],
        },
        headers=AUTH,
    )
    assert resp.status_code == 202, resp.text
    row = resp.json()
    assert row["status"] == "running"
    assert row["provider_request_id"] == "req-1"
    assert row["render_mode"] == "image_to_video"

    submit = env["submits"][0]
    assert submit["endpoint"] == "seedance-2-image-to-video"
    assert submit["params"] == {"aspect_ratio": "9:16", "duration": 10}
    assert submit["image_urls"] == ["https://cdn.example.com/a.png",
                                    "https://cdn.example.com/b.png"]
    assert "@image1" in submit["prompt"]

    # Pre-flight ran with the same figure that was billed, and billing
    # happened exactly once, after the provider accepted.
    assert env["preflight"] == [Decimal("1.0000")]
    assert len(env["spent"]) == 1
    entry = env["spent"][0]
    assert entry.provider == "muapi"
    assert entry.sku == "seedance-2"
    assert entry.cost_usd == Decimal("1.0000")
    assert entry.units == Decimal(10)


def test_text_to_video_when_no_images(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "grok-video", "prompt": "unbox it and react", "mode": "fun"},
        headers=AUTH,
    )
    assert resp.status_code == 202
    assert resp.json()["render_mode"] == "text_to_video"
    submit = env["submits"][0]
    assert "image_url" not in submit["params"]
    assert submit["params"]["mode"] == "fun"
    assert submit["params"]["resolution"] == "480p"


def test_spend_cap_refuses_before_the_provider_is_called(monkeypatch, env):
    _reset_limiter()
    env["state"]["cap"] = Decimal("0.01")
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "veo-3-1", "prompt": "hi", "resolution": "4k"},
        headers=AUTH,
    )
    assert resp.status_code == 402
    assert env["submits"] == []
    assert env["spent"] == []
    assert env["store"].rows == {}


def test_provider_rejection_marks_the_row_failed(monkeypatch, env):
    _reset_limiter()

    async def boom(**kw):
        raise muapi.MuapiError("muapi said no")

    monkeypatch.setattr(muapi, "submit", boom)
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "grok-video", "prompt": "hi"}, headers=AUTH,
    )
    assert resp.status_code == 502
    row = next(iter(env["store"].rows.values()))
    assert row["status"] == "failed"
    assert "muapi said no" in row["error"]
    # Nothing was billed for a job the provider never accepted.
    assert env["spent"] == []


def test_unknown_niche_is_404(monkeypatch, env):
    _reset_limiter()
    from marketer.repos import niches as niches_repo

    async def _none(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _none)
    resp = _client(monkeypatch).post(
        "/api/v1/ugc/renders",
        json={"model_id": "grok-video", "prompt": "hi", "niche_id": str(uuid4())},
        headers=AUTH,
    )
    assert resp.status_code == 404


# ------------------------------------------------------------ read / retry / delete


def test_list_and_detail(monkeypatch, env):
    _reset_limiter()
    done = env["store"].seed(status="done", video_url="https://cdn/v.mp4")
    env["store"].seed(status="failed", error="nope")
    client = _client(monkeypatch)

    all_rows = client.get("/api/v1/ugc/renders", headers=AUTH).json()
    assert len(all_rows) == 2
    only_failed = client.get(
        "/api/v1/ugc/renders?status_filter=failed", headers=AUTH
    ).json()
    assert [r["status"] for r in only_failed] == ["failed"]

    detail = client.get(f"/api/v1/ugc/renders/{done['id']}", headers=AUTH)
    assert detail.status_code == 200
    assert detail.json()["video_url"] == "https://cdn/v.mp4"


def test_detail_reconciles_a_pending_render(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-live")

    async def fake_fetch(request_id):
        assert request_id == "req-live"
        return {"status": "completed", "outputs": ["https://cdn/late.mp4"]}

    monkeypatch.setattr(muapi, "fetch_result", fake_fetch)
    body = _client(monkeypatch).get(
        f"/api/v1/ugc/renders/{row['id']}", headers=AUTH
    ).json()
    assert body["status"] == "done"
    assert body["video_url"] == "https://cdn/late.mp4"


def test_detail_survives_a_flaky_provider(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-live")

    async def boom(request_id):
        raise muapi.MuapiError("gateway down")

    monkeypatch.setattr(muapi, "fetch_result", boom)
    resp = _client(monkeypatch).get(f"/api/v1/ugc/renders/{row['id']}", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"


def test_detail_404_for_another_users_render(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(user_id="someone_else")
    resp = _client(monkeypatch).get(f"/api/v1/ugc/renders/{row['id']}", headers=AUTH)
    assert resp.status_code == 404


def test_retry_only_from_failed(monkeypatch, env):
    _reset_limiter()
    running = env["store"].seed(status="running", provider_request_id="req-old")
    client = _client(monkeypatch)
    conflict = client.post(
        f"/api/v1/ugc/renders/{running['id']}/retry", headers=AUTH
    )
    assert conflict.status_code == 409
    assert env["submits"] == []

    failed = env["store"].seed(status="failed", error="boom")
    ok = client.post(f"/api/v1/ugc/renders/{failed['id']}/retry", headers=AUTH)
    assert ok.status_code == 202
    assert ok.json()["status"] == "running"
    assert len(env["submits"]) == 1
    assert len(env["spent"]) == 1


def test_retry_404_for_unknown_render(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        f"/api/v1/ugc/renders/{uuid4()}/retry", headers=AUTH
    )
    assert resp.status_code == 404


def test_delete(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed()
    client = _client(monkeypatch)
    assert client.delete(f"/api/v1/ugc/renders/{row['id']}", headers=AUTH).status_code == 204
    assert client.delete(f"/api/v1/ugc/renders/{row['id']}", headers=AUTH).status_code == 404


# ------------------------------------------------------------ webhook auth


def _hook(client, *, token: str | None, body: dict, header: str | None = None):
    url = "/api/v1/ugc/webhook"
    if token is not None:
        url += f"?token={token}"
    headers = {"x-muapi-webhook-token": header} if header else {}
    return client.post(url, json=body, headers=headers)


def test_webhook_refuses_unsigned_delivery(monkeypatch, env):
    """The source's webhook is completely unauthenticated: anyone who can
    guess a request id can complete someone else's render and point its
    video URL anywhere. We must not reproduce that."""
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-x")
    resp = _hook(
        _client(monkeypatch), token=None,
        body={"request_id": "req-x", "status": "completed", "outputs": ["https://evil/x.mp4"]},
    )
    assert resp.status_code == 401
    assert env["store"].rows[row["id"]]["status"] == "running"
    assert env["store"].rows[row["id"]]["video_url"] is None


def test_webhook_refuses_wrong_secret(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-x")
    resp = _hook(
        _client(monkeypatch), token="not-the-secret",
        body={"request_id": "req-x", "status": "completed", "outputs": ["https://evil/x.mp4"]},
    )
    assert resp.status_code == 401
    assert env["store"].rows[row["id"]]["status"] == "running"


def test_webhook_refuses_everything_when_no_secret_is_configured(monkeypatch, env):
    _reset_limiter()
    monkeypatch.setattr(settings, "muapi_webhook_secret", "")
    resp = _hook(
        _client(monkeypatch), token="anything",
        body={"request_id": "req-x", "status": "completed"},
    )
    assert resp.status_code == 503


def test_webhook_accepts_the_header_form_of_the_secret(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-h")
    resp = _hook(
        _client(monkeypatch), token=None, header=SECRET,
        body={"id": "req-h", "status": "completed", "outputs": ["https://cdn/v.mp4"]},
    )
    assert resp.status_code == 200
    assert env["store"].rows[row["id"]]["status"] == "done"


def test_webhook_completes_a_pending_render(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-1")
    resp = _hook(
        _client(monkeypatch), token=SECRET,
        body={"request_id": "req-1", "status": "completed",
              "outputs": ["https://cdn/final.mp4"]},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    stored = env["store"].rows[row["id"]]
    assert stored["video_url"] == "https://cdn/final.mp4"


def test_webhook_records_a_failure(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(status="running", provider_request_id="req-2")
    resp = _hook(
        _client(monkeypatch), token=SECRET,
        body={"request_id": "req-2", "status": "failed", "error": "content policy"},
    )
    assert resp.status_code == 200
    stored = env["store"].rows[row["id"]]
    assert stored["status"] == "failed"
    assert stored["error"] == "content policy"


def test_webhook_will_not_touch_a_settled_render(monkeypatch, env):
    _reset_limiter()
    row = env["store"].seed(
        status="done", provider_request_id="req-3", video_url="https://cdn/good.mp4"
    )
    resp = _hook(
        _client(monkeypatch), token=SECRET,
        body={"request_id": "req-3", "status": "completed",
              "outputs": ["https://evil/replaced.mp4"]},
    )
    assert resp.status_code == 200
    assert "already done" in resp.json()["ignored"]
    assert env["store"].rows[row["id"]]["video_url"] == "https://cdn/good.mp4"


def test_webhook_for_an_unknown_request_id_is_a_quiet_200(monkeypatch, env):
    _reset_limiter()
    resp = _hook(
        _client(monkeypatch), token=SECRET,
        body={"request_id": "never-seen", "status": "completed", "outputs": ["u"]},
    )
    assert resp.status_code == 200
    assert resp.json()["ignored"] == "unknown request id"


def test_webhook_without_a_request_id_is_400(monkeypatch, env):
    _reset_limiter()
    resp = _hook(_client(monkeypatch), token=SECRET, body={"status": "completed"})
    assert resp.status_code == 400
