"""Route-level tests for /api/v1/scheduled-posts.

The repo is monkeypatched with an in-memory store, auth is bypassed via
dependency_overrides, and Modal is a stub module. No DB, no network.

Two things beyond the usual CRUD discipline get explicit coverage:

- the ROUTE-ORDERING hazard (`/recurring` and `/import` must not be
  matched as `/{post_id}`), because the failure mode is a confusing 422
  rather than a crash and would survive review, and
- MIGRATION CONFORMANCE: the repo layer was written before its tables
  existed, so every column the repo's SQL names is asserted to exist in
  db/migrations/0031_scheduled_posts.sql. A mismatch there means every
  endpoint in this file 500s at runtime against a real database, which no
  amount of stubbing would reveal.
"""
from __future__ import annotations

import re
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.repos import scheduled_posts as posts_repo
from marketer.repos.scheduled_posts import ConflictError
from marketer.scheduling.schemas import (
    PlatformVariant,
    RecurringSlot,
    ScheduledPost,
)

USER = "user_sched_route"
AUTH = {"Authorization": "Bearer mkt_x"}
SOON = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

ROOT = Path(__file__).resolve().parents[1]


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.routes import scheduled_posts as routes

    async def _fake():
        return AuthCtx(user_id=USER, email="s@t.com")

    app = create_app()
    # main.py is owned by the lead and may not have wired the router yet;
    # mount it here so this suite exercises the real router either way.
    mounted = any(
        str(getattr(r, "path", "")).startswith("/api/v1/scheduled-posts")
        for r in app.routes
    )
    if not mounted:
        app.include_router(
            routes.router, prefix="/api/v1/scheduled-posts", tags=["scheduled-posts"]
        )
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


# --------------------------------------------------------------- fake repo


class FakeStore:
    def __init__(self) -> None:
        self.posts: dict[UUID, ScheduledPost] = {}
        self.slots: dict[UUID, RecurringSlot] = {}
        self.created_sources: list[str] = []
        self.forbid_get = False

    def seed(self, *, platforms=("tiktok",), status="scheduled",
             user_id=USER, at=SOON) -> ScheduledPost:
        post = ScheduledPost(
            id=uuid4(), user_id=user_id, content="hello", media_urls=[],
            scheduled_at=at, timezone="UTC", status=status,
            variants=[PlatformVariant(id=uuid4(), platform=p) for p in platforms],
        )
        self.posts[post.id] = post
        return post

    def seed_slot(self, *, user_id=USER) -> RecurringSlot:
        slot = RecurringSlot(
            id=uuid4(), user_id=user_id, label="mornings", weekday=0, hour=9,
            minute=0, timezone="America/New_York", platforms=["tiktok"], active=True,
        )
        self.slots[slot.id] = slot
        return slot


@pytest.fixture
def store(monkeypatch) -> FakeStore:
    s = FakeStore()

    async def fake_create(body, *, user_id, source="manual", recurring_slot_id=None):
        s.created_sources.append(source)
        post = ScheduledPost(
            id=uuid4(), user_id=user_id, content=body.content,
            media_urls=body.media_urls, scheduled_at=body.scheduled_at,
            timezone=body.timezone, source=source,
            recurring_slot_id=recurring_slot_id,
            variants=[PlatformVariant(id=uuid4(), platform=p) for p in body.platforms],
        )
        s.posts[post.id] = post
        return post

    async def fake_get(post_id, *, user_id):
        assert not s.forbid_get, "a literal path segment was matched as /{post_id}"
        post = s.posts.get(post_id)
        return post if post and post.user_id == user_id else None

    async def fake_list(user_id, *, status=None, start=None, end=None, limit=50):
        rows = [p for p in s.posts.values() if p.user_id == user_id]
        if status == "due":
            rows = [p for p in rows if p.status == "scheduled"]
        elif status:
            rows = [p for p in rows if p.status == status]
        if start:
            rows = [p for p in rows if p.scheduled_at >= start]
        if end:
            rows = [p for p in rows if p.scheduled_at < end]
        return sorted(rows, key=lambda p: p.scheduled_at)[:limit]

    async def fake_update(post_id, *, user_id, patch):
        post = s.posts.get(post_id)
        if post is None or post.user_id != user_id:
            return None
        if post.status not in ("scheduled", "failed", "partial"):
            raise ConflictError(post.status)
        data = patch.model_dump(exclude_unset=True)
        for field in ("content", "media_urls", "scheduled_at", "timezone"):
            if data.get(field) is not None:
                setattr(post, field, data[field])
        if data.get("platforms") is not None:
            post.variants = [
                PlatformVariant(id=uuid4(), platform=p) for p in data["platforms"]
            ]
        return post

    async def fake_delete(post_id, *, user_id):
        post = s.posts.get(post_id)
        if post is None or post.user_id != user_id:
            return "not_found"
        if post.status not in posts_repo.DELETABLE_STATUSES:
            return post.status
        del s.posts[post_id]
        return None

    async def fake_claim_publish_now(post_id, *, user_id):
        post = s.posts.get(post_id)
        if post is None or post.user_id != user_id or post.status != "scheduled":
            return None
        post.status = "dispatching"
        return post

    async def fake_create_slot(body, *, user_id):
        slot = RecurringSlot(
            id=uuid4(), user_id=user_id, **body.model_dump()
        )
        s.slots[slot.id] = slot
        return slot

    async def fake_list_slots(user_id, *, active_only=False):
        rows = [x for x in s.slots.values() if x.user_id == user_id]
        if active_only:
            rows = [x for x in rows if x.active]
        return rows

    async def fake_delete_slot(slot_id, *, user_id):
        slot = s.slots.get(slot_id)
        if slot is None or slot.user_id != user_id:
            return False
        del s.slots[slot_id]
        return True

    for name, fn in [
        ("create", fake_create), ("get", fake_get), ("list_for_user", fake_list),
        ("update", fake_update), ("delete", fake_delete),
        ("claim_for_publish_now", fake_claim_publish_now),
        ("create_slot", fake_create_slot), ("list_slots", fake_list_slots),
        ("delete_slot", fake_delete_slot),
    ]:
        monkeypatch.setattr(posts_repo, name, fn)
    return s


@pytest.fixture
def spawns(monkeypatch) -> list[tuple]:
    """Stub `modal` so publish-now never reaches the real platform."""
    calls: list[tuple] = []

    class _FakeFunction:
        @staticmethod
        def from_name(app_name, fn_name):
            return types.SimpleNamespace(
                spawn=lambda *a: calls.append((app_name, fn_name, a))
            )

    fake_modal = types.ModuleType("modal")
    fake_modal.Function = _FakeFunction  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    return calls


# ------------------------------------------------------------------ create


def test_create_returns_201_with_the_variant_fan_out(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts",
        json={
            "content": "launch day",
            "media_urls": ["https://cdn.example.com/a.png"],
            "platforms": ["tiktok", "instagram"],
            "scheduled_at": "2026-06-01T12:00:00Z",
            "timezone": "America/New_York",
            "variants": {"instagram": {"content": "ig cut"}},
        },
        headers=AUTH,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert [v["platform"] for v in body["variants"]] == ["tiktok", "instagram"]
    assert body["timezone"] == "America/New_York"
    assert body["status"] == "scheduled"
    assert store.created_sources == ["manual"]


def test_create_normalises_platform_aliases(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts",
        json={"content": "hi", "platforms": ["x", "twitter", "reels"],
              "scheduled_at": "2026-06-01T12:00:00Z"},
        headers=AUTH,
    )
    assert resp.status_code == 201
    # `x` and `twitter` are one destination — two rows would post twice.
    assert [v["platform"] for v in resp.json()["variants"]] == ["twitter", "instagram"]


@pytest.mark.parametrize(
    "payload",
    [
        {"content": "hi", "platforms": ["myspace"], "scheduled_at": "2026-06-01T12:00:00Z"},
        {"content": "hi", "platforms": [], "scheduled_at": "2026-06-01T12:00:00Z"},
        {"content": "", "platforms": ["tiktok"], "scheduled_at": "2026-06-01T12:00:00Z"},
        {"content": "hi", "platforms": ["tiktok"], "scheduled_at": "2026-06-01T12:00:00Z",
         "timezone": "Mars/Olympus"},
        {"content": "hi", "platforms": ["tiktok"], "scheduled_at": "2026-06-01T12:00:00Z",
         "variants": {"linkedin": {"content": "orphan"}}},
        {"content": "hi", "platforms": ["tiktok"], "scheduled_at": "2026-06-01T12:00:00Z",
         "media_urls": ["ftp://cdn/a.png"]},
    ],
)
def test_bad_create_bodies_are_422_and_write_nothing(monkeypatch, store, payload):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts", json=payload, headers=AUTH
    )
    assert resp.status_code == 422, resp.text
    assert store.posts == {}


def test_media_only_post_needs_no_copy(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts",
        json={"content": "", "media_urls": ["https://cdn.example.com/a.png"],
              "platforms": ["instagram"], "scheduled_at": "2026-06-01T12:00:00Z"},
        headers=AUTH,
    )
    assert resp.status_code == 201


# -------------------------------------------------------------------- list


def test_list_filters_by_status_and_window(monkeypatch, store):
    _reset_limiter()
    store.seed(at=SOON)
    store.seed(at=SOON + timedelta(days=10), status="posted")
    store.seed(user_id="someone_else")
    client = _client(monkeypatch)

    assert len(client.get("/api/v1/scheduled-posts", headers=AUTH).json()) == 2
    posted = client.get("/api/v1/scheduled-posts?status=posted", headers=AUTH).json()
    assert [p["status"] for p in posted] == ["posted"]

    windowed = client.get(
        "/api/v1/scheduled-posts?from=2026-06-05T00:00:00Z&to=2026-07-01T00:00:00Z",
        headers=AUTH,
    ).json()
    assert len(windowed) == 1


def test_list_rejects_an_inverted_window(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).get(
        "/api/v1/scheduled-posts?from=2026-07-01T00:00:00Z&to=2026-06-01T00:00:00Z",
        headers=AUTH,
    )
    assert resp.status_code == 422


def test_list_limit_is_bounded(monkeypatch, store):
    _reset_limiter()
    client = _client(monkeypatch)
    assert client.get("/api/v1/scheduled-posts?limit=0", headers=AUTH).status_code == 422
    assert client.get("/api/v1/scheduled-posts?limit=999", headers=AUTH).status_code == 422


# ------------------------------------------------------------------ detail


def test_detail_carries_per_platform_variant_statuses(monkeypatch, store):
    _reset_limiter()
    post = store.seed(platforms=("tiktok", "instagram"))
    post.variants[0].status = "posted"
    post.variants[0].provider_post_id = "ayr-1"
    post.variants[1].status = "failed"
    post.variants[1].error = "rate limited"

    body = _client(monkeypatch).get(
        f"/api/v1/scheduled-posts/{post.id}", headers=AUTH
    ).json()
    by_platform = {v["platform"]: v for v in body["variants"]}
    assert by_platform["tiktok"]["provider_post_id"] == "ayr-1"
    assert by_platform["instagram"]["error"] == "rate limited"


def test_another_tenants_post_is_404_not_403(monkeypatch, store):
    """A guessed UUID from another tenant must be indistinguishable from a
    UUID that does not exist."""
    _reset_limiter()
    post = store.seed(user_id="someone_else")
    resp = _client(monkeypatch).get(f"/api/v1/scheduled-posts/{post.id}", headers=AUTH)
    assert resp.status_code == 404


def test_unknown_id_is_404(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).get(f"/api/v1/scheduled-posts/{uuid4()}", headers=AUTH)
    assert resp.status_code == 404


def test_non_uuid_id_is_422(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).get("/api/v1/scheduled-posts/not-a-uuid", headers=AUTH)
    assert resp.status_code == 422


# ------------------------------------------------------------------ patch


def test_patch_reschedules(monkeypatch, store):
    _reset_limiter()
    post = store.seed()
    resp = _client(monkeypatch).patch(
        f"/api/v1/scheduled-posts/{post.id}",
        json={"scheduled_at": "2026-06-09T15:30:00Z"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["scheduled_at"] == "2026-06-09T15:30:00Z"


def test_patch_can_change_the_platform_set(monkeypatch, store):
    _reset_limiter()
    post = store.seed(platforms=("tiktok",))
    body = _client(monkeypatch).patch(
        f"/api/v1/scheduled-posts/{post.id}",
        json={"platforms": ["linkedin", "threads"], "content": "new copy"},
        headers=AUTH,
    ).json()
    assert [v["platform"] for v in body["variants"]] == ["linkedin", "threads"]
    assert body["content"] == "new copy"


def test_patch_of_a_dispatching_post_is_409(monkeypatch, store):
    """The row exists and the client may know that — it just cannot be
    edited while it may be mid-flight to a real account."""
    _reset_limiter()
    post = store.seed(status="dispatching")
    resp = _client(monkeypatch).patch(
        f"/api/v1/scheduled-posts/{post.id}",
        json={"content": "too late"}, headers=AUTH,
    )
    assert resp.status_code == 409
    assert "dispatching" in resp.json()["detail"]


def test_empty_patch_is_422(monkeypatch, store):
    _reset_limiter()
    post = store.seed()
    resp = _client(monkeypatch).patch(
        f"/api/v1/scheduled-posts/{post.id}", json={}, headers=AUTH
    )
    assert resp.status_code == 422


def test_patch_of_an_unknown_post_is_404(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).patch(
        f"/api/v1/scheduled-posts/{uuid4()}", json={"content": "x"}, headers=AUTH
    )
    assert resp.status_code == 404


# ----------------------------------------------------------------- delete


def test_delete_an_undispatched_post_is_204(monkeypatch, store):
    _reset_limiter()
    post = store.seed()
    client = _client(monkeypatch)
    assert client.delete(f"/api/v1/scheduled-posts/{post.id}", headers=AUTH).status_code == 204
    assert client.delete(f"/api/v1/scheduled-posts/{post.id}", headers=AUTH).status_code == 404


@pytest.mark.parametrize("status_value", ["dispatching", "posted", "partial"])
def test_delete_is_refused_once_dispatched(monkeypatch, store, status_value):
    """A posted/partial post has live posts we cannot recall; deleting it
    would destroy the only record of what went out."""
    _reset_limiter()
    post = store.seed(status=status_value)
    resp = _client(monkeypatch).delete(
        f"/api/v1/scheduled-posts/{post.id}", headers=AUTH
    )
    assert resp.status_code == 409
    assert post.id in store.posts


# ------------------------------------------------------------ publish-now


def test_publish_now_claims_then_spawns(monkeypatch, store, spawns):
    _reset_limiter()
    post = store.seed()
    resp = _client(monkeypatch).post(
        f"/api/v1/scheduled-posts/{post.id}/publish-now", headers=AUTH
    )
    assert resp.status_code == 202
    assert store.posts[post.id].status == "dispatching"
    assert spawns == [("marketer-sh", "publish_scheduled_post", (USER, str(post.id)))]


def test_publish_now_double_click_publishes_once(monkeypatch, store, spawns):
    """The claim is synchronous and atomic, so the second click loses the
    race and never reaches a spawn."""
    _reset_limiter()
    post = store.seed()
    client = _client(monkeypatch)
    first = client.post(f"/api/v1/scheduled-posts/{post.id}/publish-now", headers=AUTH)
    second = client.post(f"/api/v1/scheduled-posts/{post.id}/publish-now", headers=AUTH)

    assert first.status_code == 202
    assert second.status_code == 409
    assert len(spawns) == 1, "double-click spawned two publishes"


def test_publish_now_on_an_unknown_post_is_404(monkeypatch, store, spawns):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        f"/api/v1/scheduled-posts/{uuid4()}/publish-now", headers=AUTH
    )
    assert resp.status_code == 404
    assert spawns == []


# ---------------------------------------------------------------- import


def _csv(rows: str) -> bytes:
    return ("content,platforms,scheduled_at,timezone\n" + rows).encode()


def test_import_creates_every_row(monkeypatch, store):
    _reset_limiter()
    data = _csv(
        "one,tiktok,2026-06-01T09:00:00Z,UTC\n"
        "two,instagram|linkedin,2026-06-02 09:00,America/New_York\n"
    )
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/import",
        files={"file": ("posts.csv", data, "text/csv")},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"created": 2, "errors": []}
    assert store.created_sources == ["import", "import"]
    # The bare local time was read in the row's own zone (EDT in June).
    second = next(p for p in store.posts.values() if p.content == "two")
    assert second.scheduled_at == datetime(2026, 6, 2, 13, 0, tzinfo=timezone.utc)


def test_import_is_all_or_nothing(monkeypatch, store):
    """One bad row creates nothing, so fixing the file and re-uploading
    cannot duplicate the rows that would otherwise have landed."""
    _reset_limiter()
    data = _csv(
        "good,tiktok,2026-06-01T09:00:00Z,UTC\n"
        "bad,myspace,2026-06-02T09:00:00Z,UTC\n"
    )
    body = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/import",
        files={"file": ("posts.csv", data, "text/csv")},
        headers=AUTH,
    ).json()
    assert body["created"] == 0
    assert body["errors"][0]["row"] == 3  # spreadsheet row, header is row 1
    assert "unsupported platform" in body["errors"][0]["message"]
    assert store.posts == {}


def test_import_accepts_a_raw_csv_body(monkeypatch, store):
    """curl / the agent SDK post text/csv without a multipart envelope."""
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/import",
        content=_csv("one,tiktok,2026-06-01T09:00:00Z,UTC\n"),
        headers={**AUTH, "Content-Type": "text/csv"},
    )
    assert resp.json() == {"created": 1, "errors": []}


def test_import_reports_a_missing_header(monkeypatch, store):
    _reset_limiter()
    body = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/import",
        files={"file": ("posts.csv", b"content\nhi\n", "text/csv")},
        headers=AUTH,
    ).json()
    assert body["created"] == 0
    assert "missing required column(s)" in body["errors"][0]["message"]


def test_import_without_a_file_part_is_400(monkeypatch, store):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/import",
        files={"notes": (None, "hello")},
        headers=AUTH,
    )
    assert resp.status_code == 400


# -------------------------------------------------------------- recurring


def test_create_and_list_recurring_slots(monkeypatch, store):
    _reset_limiter()
    client = _client(monkeypatch)
    created = client.post(
        "/api/v1/scheduled-posts/recurring",
        json={"label": "mornings", "weekday": 0, "hour": 9, "minute": 0,
              "timezone": "America/New_York", "platforms": ["tiktok", "reels"]},
        headers=AUTH,
    )
    assert created.status_code == 201, created.text
    assert created.json()["platforms"] == ["tiktok", "instagram"]

    listed = client.get("/api/v1/scheduled-posts/recurring", headers=AUTH).json()
    assert [s["label"] for s in listed] == ["mornings"]


@pytest.mark.parametrize(
    "payload",
    [
        {"weekday": 7, "hour": 9},
        {"weekday": 0, "hour": 24},
        {"weekday": 0, "hour": 9, "minute": 60},
        {"weekday": 0, "hour": 9, "timezone": "Mars/Olympus"},
        {"weekday": 0, "hour": 9, "platforms": ["myspace"]},
    ],
)
def test_bad_recurring_slots_are_422(monkeypatch, store, payload):
    _reset_limiter()
    resp = _client(monkeypatch).post(
        "/api/v1/scheduled-posts/recurring", json=payload, headers=AUTH
    )
    assert resp.status_code == 422
    assert store.slots == {}


def test_delete_recurring_slot(monkeypatch, store):
    _reset_limiter()
    slot = store.seed_slot()
    client = _client(monkeypatch)
    url = f"/api/v1/scheduled-posts/recurring/{slot.id}"
    assert client.delete(url, headers=AUTH).status_code == 204
    assert client.delete(url, headers=AUTH).status_code == 404


def test_another_tenants_slot_cannot_be_deleted(monkeypatch, store):
    _reset_limiter()
    slot = store.seed_slot(user_id="someone_else")
    resp = _client(monkeypatch).delete(
        f"/api/v1/scheduled-posts/recurring/{slot.id}", headers=AUTH
    )
    assert resp.status_code == 404
    assert slot.id in store.slots


# ------------------------------------------------- the route-ordering hazard


def test_literal_segments_are_not_matched_as_post_ids(monkeypatch, store, spawns):
    """`/recurring` and `/import` are single path segments, exactly like
    `/{post_id}`. If they were declared after it, FastAPI would match them
    as an id and answer 422 ("not a valid UUID") — a plausible-looking
    error that would survive review. `forbid_get` makes that mis-route a
    hard failure instead of a subtle one.
    """
    _reset_limiter()
    store.forbid_get = True
    client = _client(monkeypatch)

    assert client.get("/api/v1/scheduled-posts/recurring", headers=AUTH).status_code == 200
    assert client.post(
        "/api/v1/scheduled-posts/recurring",
        json={"weekday": 0, "hour": 9}, headers=AUTH,
    ).status_code == 201
    assert client.post(
        "/api/v1/scheduled-posts/import",
        content=_csv("one,tiktok,2026-06-01T09:00:00Z,UTC\n"),
        headers={**AUTH, "Content-Type": "text/csv"},
    ).status_code == 200


def test_router_declares_literals_before_the_wildcard():
    """Belt and braces on the above: assert the declaration order itself,
    so a future reorder fails here with an explicit message rather than
    only through behaviour."""
    from backend.routes import scheduled_posts as routes

    paths = [getattr(r, "path", "") for r in routes.router.routes]
    wildcard = paths.index("/{post_id}")
    assert paths.index("/recurring") < wildcard
    assert paths.index("/import") < wildcard


# ------------------------------------------------- migration conformance
#
# The repo layer (516 lines of SQL) was written before its tables existed.
# Everything above this line runs against an in-memory fake, so a schema
# mismatch would sail through it and 500 on the first real request. These
# tests read db/migrations/0031_scheduled_posts.sql and the repo source and
# cross-check them.

_MIGRATION = (ROOT / "db/migrations/0031_scheduled_posts.sql").read_text()
_ROLLBACK = (ROOT / "db/migrations/0031_scheduled_posts.rollback.sql").read_text()
_REPO_SQL = (ROOT / "src/marketer/repos/scheduled_posts.py").read_text()

_COLUMN_TYPES = "uuid|text|jsonb|timestamptz|boolean|integer|bigint"


def _migration_tables() -> dict[str, set[str]]:
    tables: dict[str, set[str]] = {}
    for match in re.finditer(
        r"create table if not exists (\w+)\s*\((.*?)\n\);", _MIGRATION, re.S
    ):
        columns = set()
        for line in match.group(2).splitlines():
            col = re.match(rf"\s*([a-z_]+)\s+({_COLUMN_TYPES})\b", line)
            if col:
                columns.add(col.group(1))
        tables[match.group(1)] = columns
    return tables


TABLES = _migration_tables()


def test_migration_defines_every_table_the_repo_queries():
    referenced = set(re.findall(r"(?:from|into|update|join)\s+(scheduled\w*|recurring\w*)",
                                _REPO_SQL))
    assert referenced <= set(TABLES), f"missing tables: {referenced - set(TABLES)}"
    assert set(TABLES) == {"scheduled_posts", "scheduled_post_variants", "recurring_slots"}


@pytest.mark.parametrize(
    "model,table,extra",
    [
        (ScheduledPost, "scheduled_posts", {"variants"}),
        (PlatformVariant, "scheduled_post_variants", set()),
        (RecurringSlot, "recurring_slots", set()),
    ],
)
def test_every_model_field_has_a_column(model, table, extra):
    """`select *` straight into `Model.model_validate` is the real runtime
    coupling: a field with no column (or a NULL in a non-optional field)
    is a validation error on every read."""
    fields = set(model.model_fields) - extra
    assert fields <= TABLES[table], f"{table} missing {fields - TABLES[table]}"


def test_every_explicit_insert_column_exists():
    for table, columns in re.findall(
        r"insert into\s+(\w+)\s*\n?\s*\(([^)]*)\)", _REPO_SQL
    ):
        named = {c.strip() for c in columns.split(",") if c.strip()}
        assert named <= TABLES[table], f"{table} missing {named - TABLES[table]}"


def test_every_assigned_column_exists_somewhere():
    """`set x = ...` / `x = coalesce(...)` across the repo's UPDATEs."""
    all_columns = set().union(*TABLES.values())
    assigned = set(re.findall(r"^\s*(?:set\s+)?([a-z_]+)\s*=\s*(?:coalesce|case|now|null|'|\$)",
                              _REPO_SQL, re.M))
    unknown = {c for c in assigned if c not in all_columns}
    # `status`, `error`, `updated_at` etc. must all resolve to real columns.
    assert not unknown, f"assigned but not defined: {unknown}"


def test_status_check_constraints_cover_every_value_the_repo_writes():
    post_statuses = set(re.findall(r"status = '(\w+)'", _REPO_SQL))
    post_statuses |= set(re.findall(r"then '(\w+)'", _REPO_SQL))
    for value in post_statuses:
        assert f"'{value}'" in _MIGRATION, (
            f"repo writes/reads status {value!r} but no check constraint allows it"
        )


def test_source_values_are_allowed_by_the_check_constraint():
    # The route uses 'manual' and 'import'; the recurring materialiser uses
    # 'recurring'. All three must be in the constraint or create() 500s.
    for value in ("manual", "import", "recurring"):
        assert f"'{value}'" in _MIGRATION


def test_unique_constraint_backs_the_on_conflict_clause():
    """`on conflict (scheduled_post_id, platform) do nothing` in
    repo.update needs a matching unique index or Postgres errors out."""
    assert "on conflict (scheduled_post_id, platform)" in _REPO_SQL
    assert "unique (scheduled_post_id, platform)" in _MIGRATION


def test_stale_reap_is_supported_by_the_schema():
    """`reap_stale` filters both tables on `status = 'dispatching' and
    updated_at < now() - ...`, so both need updated_at and an index that
    keeps the sweep off the full table."""
    for table in ("scheduled_posts", "scheduled_post_variants"):
        assert "updated_at" in TABLES[table]
    assert "scheduled_posts_stale_idx" in _MIGRATION
    assert "scheduled_post_variants_stale_idx" in _MIGRATION
    assert "make_interval(mins" in _REPO_SQL


def test_due_claim_has_a_partial_index():
    """claim_due scans `status = 'scheduled' and scheduled_at <= now()`
    every tick; without the partial index that walks the whole posted
    tail."""
    assert "scheduled_posts_due_idx" in _MIGRATION
    assert "where status = 'scheduled'" in _MIGRATION


def test_every_table_cascades_from_users_for_gdpr_erasure():
    """`privacy.erase_user` just deletes the users row — everything else
    has to fall out by cascade. And every table carries `user_id`, which is
    also how the data-portability export discovers per-user tables."""
    for table in TABLES:
        assert "user_id" in TABLES[table], f"{table} is invisible to the GDPR export"
    assert _MIGRATION.count("references users(id) on delete cascade") == 3
    # The variant fan-out never names user_id in its INSERTs (the rows are
    # produced by a CTE from the parent), so the BEFORE INSERT trigger is
    # the only thing keeping that column non-null. Assert both halves.
    inserts = re.findall(
        r"insert into\s+scheduled_post_variants\s*\n?\s*\(([^)]*)\)", _REPO_SQL
    )
    assert inserts, "expected the variant fan-out INSERTs to still exist"
    assert all("user_id" not in cols for cols in inserts)
    assert "scheduled_post_variants_user_id" in _MIGRATION
    assert "before insert on scheduled_post_variants" in _MIGRATION


def test_variants_cascade_from_their_parent_post():
    assert "references scheduled_posts(id) on delete cascade" in _MIGRATION
    # Deleting a template must NOT delete the posts it already produced.
    assert "references recurring_slots(id) on delete set null" in _MIGRATION


def test_rollback_drops_children_before_parents():
    order = [
        _ROLLBACK.index("drop table if exists scheduled_post_variants"),
        _ROLLBACK.index("drop table if exists scheduled_posts"),
        _ROLLBACK.index("drop table if exists recurring_slots"),
    ]
    assert order == sorted(order)
    # set_updated_at() is shared with every other table — dropping it here
    # would break jobs, articles, ads and micro_dramas.
    assert "drop function if exists set_updated_at" not in _ROLLBACK
