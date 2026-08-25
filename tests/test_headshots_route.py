"""Route-level tests for /api/v1/headshots.

Repos, Modal, and the volume are stubbed; auth is bypassed via
dependency_overrides. No DB, no network, no image calls. The two
properties this suite exists for are upload validation (these are
photographs of real people) and ownership scoping (another user's batch,
variant, or file must be indistinguishable from one that doesn't exist).
"""
from __future__ import annotations

import sys
import types
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings
from marketer.headshots import pipeline
from marketer.repos import headshots as repo

USER = "user_shots"
AUTH = {"Authorization": "Bearer mkt_x"}
PNG = b"\x89PNG\r\n\x1a\n" + b"pixels"
JPEG = b"\xff\xd8\xff" + b"body"


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import headshots as headshot_routes

    async def _fake():
        return AuthCtx(user_id=USER, email="u@t.com")

    app = create_app()
    # Mounted here when main.py hasn't wired it yet, so this suite
    # exercises the real router either way.
    mounted = any(
        str(getattr(r, "path", "")).startswith("/api/v1/headshots") for r in app.routes
    )
    if not mounted:
        app.include_router(
            headshot_routes.router, prefix="/api/v1/headshots", tags=["headshots"]
        )
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


class Store:
    def __init__(self) -> None:
        self.sources: dict[UUID, dict] = {}
        self.batches: dict[UUID, dict] = {}
        self.variants: dict[UUID, dict] = {}
        self.deleted: list[UUID] = []

    def seed_source(self, *, user_id: str = USER, path: str = "/tmp/x.jpg") -> dict:
        row = {
            "id": uuid4(), "user_id": user_id, "path": path,
            "content_type": "image/jpeg", "size_bytes": 4, "filename": "me.jpg",
        }
        self.sources[row["id"]] = row
        return row

    def seed_batch(self, *, user_id: str = USER, count: int = 2, **over) -> dict:
        row = {
            "id": uuid4(), "user_id": user_id, "niche_id": None,
            "style_key": "corporate_classic", "subject_notes": "",
            "variant_count": count, "source_image_ids": [], "status": "queued",
            "error": None,
        }
        row.update(over)
        self.batches[row["id"]] = row
        for i in range(count):
            vid = uuid4()
            self.variants[vid] = {
                "id": vid, "batch_id": row["id"], "user_id": user_id,
                "variant_index": i, "status": "queued", "image_path": None,
                "error": None,
            }
        return row

    def variants_of(self, batch_id: UUID) -> list[dict]:
        rows = [v for v in self.variants.values() if v["batch_id"] == batch_id]
        return sorted(rows, key=lambda v: v["variant_index"])


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))

    store = Store()
    spawned: list[tuple] = []

    class _FakeFn:
        def spawn(self, *a):
            spawned.append(a)

    monkeypatch.setitem(
        sys.modules, "modal",
        types.SimpleNamespace(
            Function=types.SimpleNamespace(from_name=lambda app, name: _FakeFn())
        ),
    )

    async def create_source(*, user_id, path, content_type, size_bytes, filename=""):
        row = {
            "id": uuid4(), "user_id": user_id, "path": path,
            "content_type": content_type, "size_bytes": size_bytes,
            "filename": filename,
        }
        store.sources[row["id"]] = row
        return row

    async def get_source(source_id, *, user_id):
        row = store.sources.get(source_id)
        return dict(row) if row and row["user_id"] == user_id else None

    async def get_sources(source_ids, *, user_id):
        found = [
            store.sources[s] for s in source_ids
            if s in store.sources and store.sources[s]["user_id"] == user_id
        ]
        return [dict(r) for r in found]

    async def delete_source(source_id, *, user_id):
        row = store.sources.get(source_id)
        if not row or row["user_id"] != user_id:
            return None
        del store.sources[source_id]
        return row["path"]

    async def create_batch(*, user_id, style_key, source_image_ids, variant_count,
                           subject_notes="", niche_id=None):
        return store.seed_batch(
            user_id=user_id, style_key=style_key, variant_count=variant_count,
            count=variant_count, subject_notes=subject_notes, niche_id=niche_id,
            source_image_ids=[str(s) for s in source_image_ids],
        )

    async def get_batch(batch_id, *, user_id):
        row = store.batches.get(batch_id)
        return dict(row) if row and row["user_id"] == user_id else None

    async def list_batches(user_id, *, status=None, limit=50):
        rows = [b for b in store.batches.values() if b["user_id"] == user_id]
        if status:
            rows = [b for b in rows if b["status"] == status]
        return [dict(b) for b in rows[:limit]]

    async def list_variants(batch_id, *, user_id):
        return [
            dict(v) for v in store.variants_of(batch_id) if v["user_id"] == user_id
        ]

    async def get_variant(variant_id, *, batch_id, user_id):
        row = store.variants.get(variant_id)
        if not row or row["batch_id"] != batch_id or row["user_id"] != user_id:
            return None
        return dict(row)

    async def claim_for_retry(batch_id, *, user_id):
        row = store.batches.get(batch_id)
        if not row or row["user_id"] != user_id or row["status"] not in ("failed", "partial"):
            return None
        row.update(status="queued", error=None)
        return dict(row)

    async def delete_batch(batch_id, *, user_id):
        row = store.batches.get(batch_id)
        if not row or row["user_id"] != user_id:
            return []
        paths = [
            v["image_path"] for v in store.variants_of(batch_id) if v["image_path"]
        ]
        del store.batches[batch_id]
        store.deleted.append(batch_id)
        return paths

    for name, fn in [
        ("create_source", create_source), ("get_source", get_source),
        ("get_sources", get_sources), ("delete_source", delete_source),
        ("create_batch", create_batch), ("get_batch", get_batch),
        ("list_batches", list_batches), ("list_variants", list_variants),
        ("get_variant", get_variant), ("claim_for_retry", claim_for_retry),
        ("delete_batch", delete_batch),
    ]:
        monkeypatch.setattr(repo, name, fn)

    return {"store": store, "spawned": spawned, "tmp": tmp_path}


# ------------------------------------------------------------ catalog


def test_styles_lists_the_catalog_with_prompt_previews(monkeypatch, env):
    _reset_limiter()
    body = _client(monkeypatch).get("/api/v1/headshots/styles", headers=AUTH).json()
    keys = [s["key"] for s in body["styles"]]
    assert "corporate_classic" in keys
    assert all(s["prompt_preview"] for s in body["styles"])


def test_styles_stays_readable_without_a_key(monkeypatch, env):
    """The catalog is pure data; the picker must render while an operator
    is still setting the image key."""
    _reset_limiter()
    monkeypatch.setattr(settings, "openai_api_key", "")
    resp = _client(monkeypatch).get("/api/v1/headshots/styles", headers=AUTH)
    assert resp.status_code == 200


def test_write_endpoints_fail_closed_without_a_key(monkeypatch, env):
    _reset_limiter()
    monkeypatch.setattr(settings, "openai_api_key", "")
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/headshots",
        json={"style_key": "corporate_classic", "source_image_ids": [str(uuid4())]},
        headers=AUTH,
    )
    assert resp.status_code == 409
    assert "not configured" in resp.json()["detail"]

    upload = client.post(
        "/api/v1/headshots/sources",
        files={"file": ("me.jpg", JPEG, "image/jpeg")}, headers=AUTH,
    )
    assert upload.status_code == 409
    assert env["store"].sources == {}


# ------------------------------------------------------------ uploads


def test_upload_stores_the_photo_and_returns_a_fetchable_url(monkeypatch, env):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/headshots/sources",
        files={"file": ("me.jpg", JPEG, "image/jpeg")}, headers=AUTH,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == {"id", "url"}

    row = env["store"].sources[UUID(body["id"])]
    assert row["user_id"] == USER
    # Stored under the caller's own volume partition, with a generated name.
    assert row["path"].startswith(str(pipeline.sources_root(USER)))
    assert "me.jpg" not in row["path"]
    assert row["filename"] == "me.jpg"

    served = client.get(body["url"], headers=AUTH)
    assert served.status_code == 200
    assert served.content == JPEG


@pytest.mark.parametrize(
    "filename,payload,content_type,fragment",
    [
        ("resume.pdf", b"%PDF-1.4 hello", "application/pdf", "unsupported file type"),
        ("evil.png", b"MZ\x90\x00 windows binary", "image/png", "not a JPEG"),
        ("empty.png", b"", "image/png", "empty"),
    ],
)
def test_wrong_type_uploads_are_rejected(
    monkeypatch, env, filename, payload, content_type, fragment
):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots/sources",
        files={"file": (filename, payload, content_type)}, headers=AUTH,
    )
    assert resp.status_code == 400, resp.text
    assert fragment in resp.json()["detail"]
    assert env["store"].sources == {}
    assert not list(pipeline.sources_root(USER).glob("*"))


def test_oversized_upload_is_rejected(monkeypatch, env):
    _reset_limiter()
    oversized = b"\xff\xd8\xff" + b"0" * pipeline.MAX_SOURCE_BYTES
    resp = _client(monkeypatch).post(
        "/api/v1/headshots/sources",
        files={"file": ("huge.jpg", oversized, "image/jpeg")}, headers=AUTH,
    )
    assert resp.status_code == 400
    assert "larger than" in resp.json()["detail"]
    assert env["store"].sources == {}
    assert not list(pipeline.sources_root(USER).glob("*"))


def test_another_users_upload_is_not_readable(monkeypatch, env):
    _reset_limiter()
    photo = env["tmp"] / "theirs.jpg"
    photo.write_bytes(JPEG)
    foreign = env["store"].seed_source(user_id="someone_else", path=str(photo))
    resp = _client(monkeypatch).get(
        f"/api/v1/headshots/sources/{foreign['id']}/image", headers=AUTH
    )
    assert resp.status_code == 404


def test_deleting_a_source_removes_the_file(monkeypatch, env):
    _reset_limiter()
    photo = env["tmp"] / "mine.jpg"
    photo.write_bytes(JPEG)
    row = env["store"].seed_source(path=str(photo))
    client = _client(monkeypatch)
    assert client.delete(f"/api/v1/headshots/sources/{row['id']}", headers=AUTH).status_code == 204
    assert not photo.exists()
    assert client.delete(f"/api/v1/headshots/sources/{row['id']}", headers=AUTH).status_code == 404


# ------------------------------------------------------------ create


def test_create_batch_spawns_the_render(monkeypatch, env):
    _reset_limiter()
    source = env["store"].seed_source()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={
            "style_key": "editorial_founder",
            "source_image_ids": [str(source["id"])],
            "variant_count": 6,
            "subject_notes": "  keep the glasses  ",
        },
        headers=AUTH,
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["variant_count"] == 6
    assert body["subject_notes"] == "keep the glasses"
    assert env["spawned"] == [(USER, body["id"])]


def test_unknown_style_is_rejected_before_a_row_exists(monkeypatch, env):
    _reset_limiter()
    source = env["store"].seed_source()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={"style_key": "ceo_in_a_lab_coat", "source_image_ids": [str(source["id"])]},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "unknown headshot style" in resp.json()["detail"]
    assert env["store"].batches == {}
    assert env["spawned"] == []


def test_a_batch_needs_at_least_one_photo(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={"style_key": "corporate_classic", "source_image_ids": []}, headers=AUTH,
    )
    assert resp.status_code == 400
    assert "upload at least one photo" in resp.json()["detail"]
    assert env["spawned"] == []


def test_another_users_photo_cannot_seed_a_batch(monkeypatch, env):
    _reset_limiter()
    foreign = env["store"].seed_source(user_id="someone_else")
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={"style_key": "corporate_classic", "source_image_ids": [str(foreign["id"])]},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert env["store"].batches == {}
    assert env["spawned"] == []


@pytest.mark.parametrize("count", (0, 13))
def test_variant_count_is_bounded_like_the_column(monkeypatch, env, count):
    _reset_limiter()
    source = env["store"].seed_source()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={
            "style_key": "corporate_classic",
            "source_image_ids": [str(source["id"])],
            "variant_count": count,
        },
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert env["spawned"] == []


def test_too_many_reference_photos_is_rejected(monkeypatch, env):
    _reset_limiter()
    ids = [str(env["store"].seed_source()["id"]) for _ in range(pipeline.MAX_SOURCE_IMAGES + 1)]
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={"style_key": "corporate_classic", "source_image_ids": ids}, headers=AUTH,
    )
    assert resp.status_code == 400
    assert "at most" in resp.json()["detail"]


def test_unknown_niche_is_404(monkeypatch, env):
    _reset_limiter()
    from marketer.repos import niches as niches_repo

    async def _none(niche_id, *, user_id):
        return None

    monkeypatch.setattr(niches_repo, "get", _none)
    source = env["store"].seed_source()
    resp = _client(monkeypatch).post(
        "/api/v1/headshots",
        json={
            "style_key": "corporate_classic",
            "source_image_ids": [str(source["id"])],
            "niche_id": str(uuid4()),
        },
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert env["spawned"] == []


# ------------------------------------------------------------ read


def test_list_and_filter_batches(monkeypatch, env):
    _reset_limiter()
    env["store"].seed_batch(status="done")
    env["store"].seed_batch(status="failed")
    env["store"].seed_batch(user_id="someone_else", status="done")
    client = _client(monkeypatch)

    rows = client.get("/api/v1/headshots", headers=AUTH).json()
    assert len(rows) == 2  # never another user's

    only_failed = client.get("/api/v1/headshots?status=failed", headers=AUTH).json()
    assert [r["status"] for r in only_failed] == ["failed"]


def test_detail_reports_per_variant_status(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(count=3, status="partial")
    variants = env["store"].variants_of(batch["id"])
    variants[0].update(status="done", image_path="/artifacts/a.png")
    variants[1].update(status="failed", error="provider exploded")

    body = _client(monkeypatch).get(f"/api/v1/headshots/{batch['id']}", headers=AUTH).json()
    assert body["batch"]["status"] == "partial"
    assert [v["status"] for v in body["variants"]] == ["done", "failed", "queued"]
    assert body["variants"][0]["has_image"] is True
    assert body["variants"][1]["error"] == "provider exploded"
    # The on-disk path is never leaked to the client.
    assert "image_path" not in body["variants"][0]


def test_detail_404_for_another_users_batch(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(user_id="someone_else")
    resp = _client(monkeypatch).get(f"/api/v1/headshots/{batch['id']}", headers=AUTH)
    assert resp.status_code == 404


def test_variant_image_streams_the_png(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(count=1)
    variant = env["store"].variants_of(batch["id"])[0]
    path = env["tmp"] / "portrait.png"
    path.write_bytes(PNG)
    variant.update(status="done", image_path=str(path))

    resp = _client(monkeypatch).get(
        f"/api/v1/headshots/{batch['id']}/variants/{variant['id']}/image", headers=AUTH
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == PNG


def test_variant_image_404s_when_unrendered_or_foreign(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(count=1)
    variant = env["store"].variants_of(batch["id"])[0]
    client = _client(monkeypatch)

    unrendered = client.get(
        f"/api/v1/headshots/{batch['id']}/variants/{variant['id']}/image", headers=AUTH
    )
    assert unrendered.status_code == 404

    foreign_batch = env["store"].seed_batch(user_id="someone_else", count=1)
    foreign_variant = env["store"].variants_of(foreign_batch["id"])[0]
    path = env["tmp"] / "theirs.png"
    path.write_bytes(PNG)
    foreign_variant.update(status="done", image_path=str(path))
    assert client.get(
        f"/api/v1/headshots/{foreign_batch['id']}/variants/{foreign_variant['id']}/image",
        headers=AUTH,
    ).status_code == 404

    # A real variant id under someone else's batch id is still a miss.
    assert client.get(
        f"/api/v1/headshots/{batch['id']}/variants/{foreign_variant['id']}/image",
        headers=AUTH,
    ).status_code == 404


# ------------------------------------------------------------ retry / delete


def test_retry_claims_and_spawns_once(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(status="partial")
    client = _client(monkeypatch)

    ok = client.post(f"/api/v1/headshots/{batch['id']}/retry", headers=AUTH)
    assert ok.status_code == 202
    assert ok.json()["status"] == "queued"
    assert env["spawned"] == [(USER, str(batch["id"]))]

    # The row is queued now, so a double-click can't spawn a second run.
    again = client.post(f"/api/v1/headshots/{batch['id']}/retry", headers=AUTH)
    assert again.status_code == 409
    assert "not failed or partial" in again.json()["detail"]
    assert len(env["spawned"]) == 1


def test_retry_404_for_unknown_batch(monkeypatch, env):
    _reset_limiter()
    resp = _client(monkeypatch).post(f"/api/v1/headshots/{uuid4()}/retry", headers=AUTH)
    assert resp.status_code == 404
    assert env["spawned"] == []


def test_delete_removes_the_row_and_the_files(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(count=2, status="done")
    paths = []
    for i, variant in enumerate(env["store"].variants_of(batch["id"])):
        path = env["tmp"] / f"v{i}.png"
        path.write_bytes(PNG)
        variant.update(status="done", image_path=str(path))
        paths.append(path)

    client = _client(monkeypatch)
    assert client.delete(f"/api/v1/headshots/{batch['id']}", headers=AUTH).status_code == 204
    assert not any(p.exists() for p in paths)
    assert client.delete(f"/api/v1/headshots/{batch['id']}", headers=AUTH).status_code == 404


def test_delete_of_a_batch_with_no_images_is_still_a_204(monkeypatch, env):
    """`delete_batch` returns an empty path list both for a foreign batch
    and for an owned batch that never rendered — the route must not read
    the second as a 404."""
    _reset_limiter()
    batch = env["store"].seed_batch(count=2, status="failed")
    resp = _client(monkeypatch).delete(f"/api/v1/headshots/{batch['id']}", headers=AUTH)
    assert resp.status_code == 204
    assert batch["id"] in env["store"].deleted


def test_delete_404_for_another_users_batch(monkeypatch, env):
    _reset_limiter()
    batch = env["store"].seed_batch(user_id="someone_else")
    resp = _client(monkeypatch).delete(f"/api/v1/headshots/{batch['id']}", headers=AUTH)
    assert resp.status_code == 404
    assert env["store"].deleted == []
