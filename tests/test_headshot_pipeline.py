"""Headshot batch orchestration: claim, fan out, meter, settle.

Everything external is stubbed — the repo is an in-memory store, the
image call writes a sentinel PNG, the spend context is a real
SpendContext over a fake ledger. No DB, no network, no provider.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from marketer.config import settings
from marketer.headshots import pipeline
from marketer.repos import headshots as repo
from marketer.repos.spend import SpendCapExceeded
from marketer.services import openai_images
from marketer.services.spend_context import SpendContext

USER = "user_head"
OTHER = "user_other"

# Captured before the fixture stubs it, so the two archive tests can drive
# the real implementation.
_real_archive = pipeline._archive


class Store:
    """Just enough of `repos.headshots` to drive the pipeline."""

    def __init__(self) -> None:
        self.batches: dict[UUID, dict] = {}
        self.variants: dict[UUID, dict] = {}
        self.sources: dict[UUID, dict] = {}
        self.archived: list[dict] = []

    def add_source(self, path: Path) -> UUID:
        sid = uuid4()
        self.sources[sid] = {
            "id": sid, "user_id": USER, "path": str(path),
            "content_type": "image/jpeg", "size_bytes": 10, "filename": "me.jpg",
        }
        return sid

    def add_batch(self, *, sources: list[UUID], count: int = 3, **over) -> dict:
        bid = uuid4()
        batch = {
            "id": bid, "user_id": USER, "niche_id": None,
            "style_key": "corporate_classic", "subject_notes": "",
            "variant_count": count, "source_image_ids": [str(s) for s in sources],
            "status": "queued", "error": None,
        }
        batch.update(over)
        self.batches[bid] = batch
        for i in range(count):
            vid = uuid4()
            self.variants[vid] = {
                "id": vid, "batch_id": bid, "user_id": USER, "variant_index": i,
                "status": "queued", "image_path": None, "error": None,
            }
        return batch

    def batch_variants(self, batch_id: UUID) -> list[dict]:
        rows = [v for v in self.variants.values() if v["batch_id"] == batch_id]
        return sorted(rows, key=lambda v: v["variant_index"])

    def statuses(self, batch_id: UUID) -> list[str]:
        return [v["status"] for v in self.batch_variants(batch_id)]


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path))
    monkeypatch.setattr(settings, "billing_enabled", False)
    monkeypatch.setattr(settings, "scene_fanout_limit", 2)

    store = Store()
    calls: list[dict] = []
    ledger: list = []
    live = {"now": 0, "peak": 0}
    behaviour: dict = {
        "fail_on": set(),        # variant call indexes that raise a provider error
        "cap": None,             # the niche daily cap on the batch's SpendContext
        "external": Decimal(0),  # spend by OTHER jobs, as today_spend would see it
        "charged_cap_on": set(),  # calls that trip the cap AFTER being billed
        "after_log": None,       # hook(n_charges) fired once a charge lands
    }

    # ---- repo ------------------------------------------------------------
    async def get_batch(batch_id, *, user_id):
        row = store.batches.get(batch_id)
        return dict(row) if row and row["user_id"] == user_id else None

    async def claim_for_run(batch_id, *, user_id):
        row = store.batches.get(batch_id)
        if not row or row["user_id"] != user_id or row["status"] != "queued":
            return None
        row["status"] = "running"
        return dict(row)

    async def set_batch_status(batch_id, *, user_id, status, error=None):
        row = store.batches[batch_id]
        row.update(status=status, error=error)
        return dict(row)

    async def list_variants(batch_id, *, user_id):
        return [dict(v) for v in store.batch_variants(batch_id)]

    async def set_variant_status(variant_id, *, status, image_path=None, error=None):
        row = store.variants[variant_id]
        row.update(status=status, error=error)
        if image_path is not None:
            row["image_path"] = image_path
        return dict(row)

    async def get_sources(source_ids, *, user_id):
        by_id = {s: store.sources[s] for s in source_ids if s in store.sources}
        return [dict(by_id[s]) for s in source_ids if s in by_id]

    async def list_source_paths(user_id):
        return [s["path"] for s in store.sources.values() if s["user_id"] == user_id]

    async def list_image_paths(user_id):
        return [
            v["image_path"] for v in store.variants.values()
            if v["user_id"] == user_id and v["image_path"]
        ]

    for name, fn in [
        ("get_batch", get_batch), ("claim_for_run", claim_for_run),
        ("set_batch_status", set_batch_status), ("list_variants", list_variants),
        ("set_variant_status", set_variant_status), ("get_sources", get_sources),
        ("list_source_paths", list_source_paths), ("list_image_paths", list_image_paths),
    ]:
        monkeypatch.setattr(repo, name, fn)

    # ---- provider --------------------------------------------------------
    async def fake_keyframe(prompt, out_path, *, quality, size,
                            reference_image_path=None, spend=None):
        return await _render(
            prompt, out_path,
            references=[reference_image_path] if reference_image_path else [],
            spend=spend, quality=quality, size=size,
        )

    async def fake_remix(prompt, out_path, *, reference_paths, quality="medium",
                         size="1024x1024", spend=None):
        return await _render(
            prompt, out_path, references=list(reference_paths),
            spend=spend, quality=quality, size=size,
        )

    async def _render(prompt, out_path, *, references, spend, quality, size):
        live["now"] += 1
        live["peak"] = max(live["peak"], live["now"])
        try:
            index = len(calls)
            calls.append({
                "prompt": prompt, "out": Path(out_path), "quality": quality,
                "size": size, "references": [Path(r) for r in references],
            })
            cost = pipeline.variant_cost()
            # Same order as the real client: gate, call, record, then write.
            if spend is not None:
                await spend.ensure_can_spend(cost)
            await asyncio.sleep(0)
            if index in behaviour["fail_on"]:
                raise RuntimeError("provider exploded")
            if spend is not None:
                await spend.log(
                    provider="openai", sku="gpt-image-1", units=Decimal(1), cost_usd=cost
                )
            if behaviour["after_log"] is not None:
                behaviour["after_log"](len(ledger))
            if index in behaviour["charged_cap_on"]:
                # The charge landed and the ledger re-read then saw the cap
                # crossed — `SpendContext.log`'s post-write check.
                raise SpendCapExceeded("cap hit during job", after_spend=True)
            Path(out_path).parent.mkdir(parents=True, exist_ok=True)
            Path(out_path).write_bytes(b"\x89PNG\r\n\x1a\npixels")
            return Path(out_path)
        finally:
            live["now"] -= 1

    monkeypatch.setattr(openai_images, "generate_keyframe", fake_keyframe)
    monkeypatch.setattr(openai_images, "generate_remix", fake_remix)

    # ---- money -----------------------------------------------------------
    async def fake_record(entry):
        ledger.append(entry)

    async def fake_today_spend(*, user_id, niche_id):
        return sum((e.cost_usd for e in ledger), Decimal(0)) + behaviour["external"]

    async def fake_spend_for_batch(batch):
        return SpendContext(
            user_id=batch["user_id"], niche_id=batch.get("niche_id"), job_id=None,
            record=fake_record, cap_usd=behaviour["cap"], today_spend=fake_today_spend,
        )

    monkeypatch.setattr(pipeline, "_spend_for_batch", fake_spend_for_batch)

    # ---- library ---------------------------------------------------------
    async def fake_archive(batch, variants):
        store.archived.append({"batch": batch["id"], "count": len(variants)})
        return len(variants)

    monkeypatch.setattr(pipeline, "_archive", fake_archive)

    def make_batch(*, photos: int = 1, count: int = 3, **over) -> dict:
        ids = []
        for i in range(photos):
            photo = tmp_path / f"src_{uuid4()}.jpg"
            photo.write_bytes(b"\xff\xd8\xffjpeg")
            ids.append(store.add_source(photo))
        return store.add_batch(sources=ids, count=count, **over)

    return {
        "store": store, "calls": calls, "ledger": ledger, "live": live,
        "behaviour": behaviour, "make_batch": make_batch, "tmp": tmp_path,
    }


# ------------------------------------------------------------ happy path


async def test_batch_renders_every_variant_and_settles_done(env):
    batch = env["make_batch"](count=3)
    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result == {"status": "done", "done": 3, "failed": 0, "cancelled": 0}
    assert env["store"].batches[batch["id"]]["status"] == "done"
    assert env["store"].statuses(batch["id"]) == ["done"] * 3
    assert len(env["ledger"]) == 3

    for variant in env["store"].batch_variants(batch["id"]):
        path = Path(variant["image_path"])
        assert path.exists()
        # Under the user's own partition, never a shared namespace.
        assert USER in path.parts and str(batch["id"]) in path.parts
    assert env["store"].archived == [{"batch": batch["id"], "count": 3}]


async def test_each_variant_gets_its_own_pose_and_the_portrait_tier(env):
    batch = env["make_batch"](count=3, subject_notes="keep the glasses")
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    prompts = [c["prompt"] for c in env["calls"]]
    assert len(set(prompts)) == 3
    assert all("keep the glasses" in p for p in prompts)
    assert all(c["size"] == pipeline.PORTRAIT_SIZE for c in env["calls"])
    assert all(c["quality"] == pipeline.PORTRAIT_QUALITY for c in env["calls"])


async def test_all_reference_photos_are_sent_in_pick_order(env):
    batch = env["make_batch"](photos=3, count=1)
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    sent = [str(p) for p in env["calls"][0]["references"]]
    expected = [env["store"].sources[UUID(s)]["path"] for s in batch["source_image_ids"]]
    assert sent == expected


async def test_fan_out_is_bounded_by_the_configured_limit(env):
    batch = env["make_batch"](count=6)
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])
    assert env["live"]["peak"] <= settings.scene_fanout_limit
    assert len(env["calls"]) == 6


# ------------------------------------------------------------ spend cap


async def test_tripped_cap_stops_the_batch_partway(env, monkeypatch):
    """The batch is affordable when it starts, then a concurrent job in the
    same niche eats the rest of the cap. The two paid-for portraits must
    survive as `done`; the remaining two must be `cancelled` — we
    deliberately did not spend that money — and nothing beyond the cap may
    be billed."""
    per = pipeline.variant_cost()
    env["behaviour"]["cap"] = per * 4  # exactly affords this batch up front
    monkeypatch.setattr(settings, "scene_fanout_limit", 1)  # deterministic cut point

    def sibling_job_spends(charges: int) -> None:
        if charges == 2:
            env["behaviour"]["external"] = per * 2

    env["behaviour"]["after_log"] = sibling_job_spends
    batch = env["make_batch"](count=4)

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "partial"
    assert result["done"] == 2
    assert result["cancelled"] == 2
    assert env["store"].statuses(batch["id"]) == ["done", "done", "cancelled", "cancelled"]
    # Exactly two charges — the cap held.
    assert len(env["ledger"]) == 2
    assert sum((e.cost_usd for e in env["ledger"]), Decimal(0)) == per * 2
    # The partial batch keeps its images and says why it stopped.
    row = env["store"].batches[batch["id"]]
    assert row["status"] == "partial"
    assert "2/4" in row["error"]
    assert env["store"].archived == [{"batch": batch["id"], "count": 2}]


async def test_batch_is_refused_up_front_when_it_cannot_be_afforded(env):
    env["behaviour"]["cap"] = pipeline.variant_cost()  # one portrait's worth
    batch = env["make_batch"](count=4)

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "failed"
    # Nothing rendered, nothing billed, and every variant is cancelled
    # rather than failed: no charge ever happened.
    assert env["calls"] == []
    assert env["ledger"] == []
    assert env["store"].statuses(batch["id"]) == ["cancelled"] * 4
    assert "cap" in env["store"].batches[batch["id"]]["error"]


async def test_a_charged_variant_that_trips_the_cap_is_failed_not_cancelled(env, monkeypatch):
    """`cancelled` means we never paid. When the breach is detected AFTER
    the charge landed, the variant has to read as failed instead — retry
    re-renders cancelled variants for free, and billing the user twice for
    one portrait is the failure mode that matters here."""
    monkeypatch.setattr(settings, "scene_fanout_limit", 1)
    env["behaviour"]["charged_cap_on"] = {0}
    batch = env["make_batch"](count=2)

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "partial"
    assert env["store"].statuses(batch["id"]) == ["failed", "done"]
    # Both calls were billed; the first one just never produced a file.
    assert len(env["ledger"]) == 2


# ------------------------------------------------------------ failures


async def test_one_broken_variant_does_not_lose_the_others(env, monkeypatch):
    env["behaviour"]["fail_on"] = {1}
    monkeypatch.setattr(settings, "scene_fanout_limit", 1)
    batch = env["make_batch"](count=3)

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result == {"status": "partial", "done": 2, "failed": 1, "cancelled": 0}
    assert env["store"].statuses(batch["id"]) == ["done", "failed", "done"]
    assert "provider exploded" in env["store"].batches[batch["id"]]["error"]
    # Only the two that landed were billed.
    assert len(env["ledger"]) == 2


async def test_a_batch_where_nothing_lands_is_failed(env):
    env["behaviour"]["fail_on"] = {0, 1}
    batch = env["make_batch"](count=2)

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "failed"
    assert env["store"].statuses(batch["id"]) == ["failed", "failed"]


async def test_missing_source_files_refuse_the_batch_before_spending(env):
    batch = env["make_batch"](count=2)
    for source in env["store"].sources.values():
        Path(source["path"]).unlink()

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "failed"
    assert "re-upload" in result["error"]
    assert env["calls"] == []
    assert env["ledger"] == []


async def test_unknown_style_fails_the_batch_without_spending(env):
    batch = env["make_batch"](count=2, style_key="ceo_in_a_lab_coat")
    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])
    assert result["status"] == "failed"
    assert "unknown headshot style" in result["error"]
    assert env["calls"] == []


# ------------------------------------------------------------ claiming


async def test_a_second_spawn_does_not_double_render(env):
    batch = env["make_batch"](count=2)
    first, second = await asyncio.gather(
        pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"]),
        pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"]),
    )
    outcomes = {first["status"], second["status"]}
    assert "done" in outcomes
    skipped = first if "skipped" in first else second
    assert skipped["skipped"] == "not queued"
    assert len(env["calls"]) == 2  # not four


async def test_another_users_batch_is_not_runnable(env):
    batch = env["make_batch"](count=1)
    with pytest.raises(RuntimeError):
        await pipeline.run_headshot_batch(user_id=OTHER, batch_id=batch["id"])
    assert env["calls"] == []


async def test_retry_only_re_renders_the_variants_with_nothing_to_show(env):
    """Mirrors what `claim_for_retry` leaves behind: done variants keep
    their image, the rest are back in queued."""
    batch = env["make_batch"](count=3)
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])
    variants = env["store"].batch_variants(batch["id"])
    variants[2].update(status="queued", image_path=None)
    env["store"].batches[batch["id"]]["status"] = "queued"
    env["calls"].clear()

    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "done"
    assert len(env["calls"]) == 1  # only the reset variant was re-rendered


# ------------------------------------------------------------ uploads / erasure


@pytest.mark.parametrize(
    "data,declared,fragment",
    [
        (b"", "image/png", "empty"),
        (b"x" * (pipeline.MAX_SOURCE_BYTES + 1), "image/jpeg", "larger than"),
        (b"%PDF-1.4 not an image", "application/pdf", "unsupported file type"),
        (b"%PDF-1.4 not an image", "image/png", "not a JPEG, PNG, or WebP"),
        (b"RIFF....AVI LIST", "image/webp", "not a JPEG, PNG, or WebP"),
    ],
)
def test_bad_uploads_are_rejected_and_never_written(env, data, declared, fragment):
    with pytest.raises(pipeline.SourceRejected) as exc:
        pipeline.store_source(USER, data, declared_type=declared)
    assert fragment in str(exc.value)
    assert not list(pipeline.sources_root(USER).glob("*"))


def test_a_real_photo_lands_in_the_users_own_partition(env):
    path, content_type = pipeline.store_source(
        USER, b"\xff\xd8\xff" + b"body", declared_type="image/jpeg"
    )
    assert content_type == "image/jpeg"
    assert path.exists() and path.suffix == ".jpg"
    assert path.parent == pipeline.sources_root(USER)
    # The client's filename never reaches the path.
    assert path.stem not in ("me", "me.jpg")


async def test_finished_portraits_are_indexed_in_the_media_library(env, monkeypatch):
    """The real `_archive` (the fixture stubs it everywhere else): finished
    portraits become library assets the video/article/UGC lanes can reuse
    instead of stock photography."""
    from marketer.repos import media as media_repo
    from marketer.services import object_storage

    recorded: list[dict] = []

    async def fake_record_asset(**kw):
        recorded.append(kw)
        return None

    monkeypatch.setattr(media_repo, "record_asset", fake_record_asset)
    monkeypatch.setattr(object_storage, "enabled", lambda: False)
    monkeypatch.setattr(pipeline, "_archive", _real_archive)

    batch = env["make_batch"](count=2)
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert len(recorded) == 2
    for entry in recorded:
        assert entry["user_id"] == USER
        assert entry["content_type"] == "image/png"
        assert entry["storage"] == "volume"
        assert "corporate_classic" in entry["title"]
        assert entry["size_bytes"] > 0


async def test_archive_failure_never_fails_a_delivered_batch(env, monkeypatch):
    from marketer.repos import media as media_repo

    async def boom(**kw):
        raise RuntimeError("wasabi is down")

    monkeypatch.setattr(media_repo, "record_asset", boom)
    monkeypatch.setattr(pipeline, "_archive", _real_archive)

    batch = env["make_batch"](count=2)
    result = await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])

    assert result["status"] == "done"


async def test_purge_removes_every_photo_and_portrait(env):
    batch = env["make_batch"](count=2)
    await pipeline.run_headshot_batch(user_id=USER, batch_id=batch["id"])
    files = [Path(v["image_path"]) for v in env["store"].batch_variants(batch["id"])]
    files += [Path(s["path"]) for s in env["store"].sources.values()]
    assert all(f.exists() for f in files)

    removed = await pipeline.purge_user_files(USER)

    assert removed == len(files)
    assert not any(f.exists() for f in files)
