"""Bulk generation: keyword parsing, the queue, concurrency and spend caps."""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from marketer.articles import bulk
from marketer.config import settings
from marketer.repos.article_batches import Batch, BatchItem
from marketer.repos.spend import SpendCapExceeded

TENANT = "user_test"
NICHE = UUID("00000000-0000-0000-0000-000000000001")


def test_parse_keywords_trims_dedupes_and_keeps_order():
    assert bulk.parse_keywords("cold brew\n\n Cold Brew \niced latte\n") == ["cold brew", "iced latte"]


@pytest.mark.parametrize("raw", ["", "\n \n", ["x" * 201]])
def test_parse_keywords_refuses(raw):
    with pytest.raises(bulk.BulkRefused):
        bulk.parse_keywords(raw)


def test_parse_keywords_caps_batch_size(monkeypatch):
    monkeypatch.setattr(settings, "article_bulk_max_keywords", 3)
    with pytest.raises(bulk.BulkRefused):
        bulk.parse_keywords([f"k{i}" for i in range(4)])


class FakeBatches:
    def __init__(self, keywords: list[str]):
        self.batch = Batch(id=uuid4(), user_id=TENANT, niche_id=NICHE, status="running", total=len(keywords))
        self.items = [
            BatchItem(id=uuid4(), batch_id=self.batch.id, user_id=TENANT, position=i + 1, keyword=k, status="queued")
            for i, k in enumerate(keywords)
        ]
        self.article_status: dict[UUID, str] = {}

    def install(self, monkeypatch):
        from marketer.repos import article_batches as repo
        from marketer.repos import articles as articles_repo
        from marketer.repos import niches as niches_repo

        f = self

        async def get(batch_id, *, user_id):
            b = f.batch.model_copy()
            b.items = list(f.items)
            return b

        async def reconcile_running(batch_id):
            for i in f.items:
                st = f.article_status.get(i.article_id) if i.article_id else None
                if i.status == "running" and st in ("done", "failed"):
                    i.status = st

        async def counts(batch_id):
            out: dict[str, int] = {}
            for i in f.items:
                out[i.status] = out.get(i.status, 0) + 1
            return out

        async def next_queued(batch_id, *, limit):
            return [i for i in f.items if i.status == "queued"][:limit]

        async def claim_item(item_id):
            i = next(x for x in f.items if x.id == item_id)
            if i.status != "queued":
                return False
            i.status = "running"
            return True

        async def attach_article(item_id, article_id):
            next(x for x in f.items if x.id == item_id).article_id = article_id

        async def fail_item(item_id, error):
            i = next(x for x in f.items if x.id == item_id)
            i.status, i.error = "failed", error

        async def hold_queued(batch_id, reason):
            for i in f.items:
                if i.status == "queued":
                    i.held_reason = reason

        async def set_status(batch_id, status):
            f.batch.status = status

        async def cancel(batch_id, *, user_id):
            f.batch.status = "cancelled"
            return True

        async def create_article(*, user_id, niche_id, topic="", batch_id=None, campaign_id=None):
            aid = uuid4()
            f.article_status[aid] = "queued"
            return SimpleNamespace(id=aid)

        async def niche_get(niche_id, *, user_id):
            return SimpleNamespace(daily_spend_cap_usd=Decimal("5"))

        for name, fn in dict(
            get=get, reconcile_running=reconcile_running, counts=counts, next_queued=next_queued,
            claim_item=claim_item, attach_article=attach_article, fail_item=fail_item,
            hold_queued=hold_queued, set_status=set_status, cancel=cancel,
        ).items():
            monkeypatch.setattr(repo, name, fn)
        monkeypatch.setattr(articles_repo, "create", create_article)
        monkeypatch.setattr(niches_repo, "get", niche_get)
        return self


class Caps:
    """Allow ``allow`` more articles, then refuse like a tripped cap."""

    def __init__(self, allow: int):
        self.allow = allow

    async def __call__(self, user_id, niche_id, cap):
        caps = self

        class _Ctx:
            async def ensure_can_spend(self, estimate):
                assert estimate == bulk.ARTICLE_ESTIMATE_USD
                if caps.allow <= 0:
                    raise SpendCapExceeded("niche cap", scope="niche")
                caps.allow -= 1

        return _Ctx()


@pytest.fixture
def claims():
    seen: set[str] = set()

    async def claim(key: str) -> bool:
        if key in seen:
            return False
        seen.add(key)
        return True

    return claim


async def test_tick_respects_concurrency(monkeypatch, claims):
    monkeypatch.setattr(settings, "article_bulk_concurrency", 2)
    f = FakeBatches(["a", "b", "c", "d"]).install(monkeypatch)
    monkeypatch.setattr(bulk, "_spend_context", Caps(10))
    spawned: list[tuple] = []
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=claims)
    assert r == {"started": 2, "held": 0}
    assert [s[3] for s in spawned] == ["a", "b"]
    # Nothing more starts until one finishes.
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=claims)
    assert r["started"] == 0
    f.article_status[f.items[0].article_id] = "done"
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=claims)
    assert r["started"] == 1 and spawned[-1][3] == "c"
    assert f.items[0].status == "done"


async def test_spend_cap_holds_the_rest_without_failing(monkeypatch, claims):
    monkeypatch.setattr(settings, "article_bulk_concurrency", 5)
    f = FakeBatches(["a", "b", "c"]).install(monkeypatch)
    caps = Caps(1)
    monkeypatch.setattr(bulk, "_spend_context", caps)
    spawned: list[tuple] = []
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=claims)
    assert r == {"started": 1, "held": 1}
    assert f.batch.status == "paused_cap"
    assert [i.status for i in f.items] == ["running", "queued", "queued"]
    assert [i.held_reason for i in f.items[1:]] == ["spend_cap", "spend_cap"]
    # The next day the caps allow it again: the batch resumes.
    caps.allow = 5
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=claims)
    assert r["started"] == 2 and f.batch.status == "running"
    assert all(i.held_reason is None for i in f.items if i.status == "queued")


async def test_idempotency_claim_prevents_a_double_start(monkeypatch):
    monkeypatch.setattr(settings, "article_bulk_concurrency", 1)
    f = FakeBatches(["a"]).install(monkeypatch)
    monkeypatch.setattr(bulk, "_spend_context", Caps(10))

    async def already_claimed(key):
        return False

    spawned: list[tuple] = []
    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: spawned.append(a), claim=already_claimed)
    assert r["started"] == 0 and spawned == []


async def test_spawn_failure_fails_only_that_item(monkeypatch, claims):
    monkeypatch.setattr(settings, "article_bulk_concurrency", 2)
    f = FakeBatches(["a", "b"]).install(monkeypatch)
    monkeypatch.setattr(bulk, "_spend_context", Caps(10))

    def spawn(user_id, niche_id, article_id, kw):
        if kw == "a":
            raise RuntimeError("modal down")

    r = await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=spawn, claim=claims)
    assert r["started"] == 1
    assert [i.status for i in f.items] == ["failed", "running"]


async def test_batch_finishes_when_every_item_is_done(monkeypatch, claims):
    f = FakeBatches(["a"]).install(monkeypatch)
    monkeypatch.setattr(bulk, "_spend_context", Caps(10))
    await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: None, claim=claims)
    f.article_status[f.items[0].article_id] = "failed"
    await bulk.tick_batch(f.batch.id, user_id=TENANT, spawn=lambda *a: None, claim=claims)
    assert f.items[0].status == "failed" and f.batch.status == "done"


async def test_create_refuses_a_cap_below_one_article(monkeypatch):
    from marketer.repos import niches as niches_repo

    async def niche_get(niche_id, *, user_id):
        return SimpleNamespace(daily_spend_cap_usd=Decimal("0.10"))

    monkeypatch.setattr(niches_repo, "get", niche_get)
    with pytest.raises(bulk.BulkRefused) as e:
        await bulk.create(user_id=TENANT, niche_id=NICHE, keywords=["a"], created_by="p")
    assert e.value.status_code == 402
