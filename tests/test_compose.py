"""Tests for composition rendering (repos, ffmpeg, storage mocked)."""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from marketer.config import settings
from marketer.models import Composition, MediaAsset
from marketer.repos import media as media_repo
from marketer.services import compose, ffmpeg

USER = "user_cmp"


def _clip_asset(tmp_path: Path, name: str) -> MediaAsset:
    p = tmp_path / name
    p.write_bytes(b"MP4")
    return MediaAsset(
        id=uuid4(), user_id=USER, kind="clip", storage="volume",
        object_key=str(p),
    )


@pytest.fixture
def env(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "artifacts_dir", str(tmp_path / "artifacts"))

    clips = [_clip_asset(tmp_path, f"c{i}.mp4") for i in range(2)]
    comp = Composition(
        id=uuid4(), user_id=USER, title="my remix",
        clip_asset_ids=[c.id for c in clips], audio_mode="keep",
    )
    state = {"comp": comp, "clips": clips, "status_calls": [], "claimed": True}

    async def fake_get_composition(cid, *, user_id):
        return state["comp"]

    async def fake_claim(cid, *, user_id):
        return state["claimed"]

    async def fake_bulk(ids, *, user_id):
        return [c for c in state["clips"] if c.id in ids]

    async def fake_record(**kwargs):
        return MediaAsset(
            id=uuid4(), user_id=USER, kind=kwargs["kind"],
            storage=kwargs["storage"], object_key=kwargs["object_key"],
        )

    async def fake_status(cid, *, user_id, status, output_asset_id=None, error=None):
        state["status_calls"].append((status, output_asset_id, error))
        return state["comp"].model_copy(update={"status": status, "error": error})

    monkeypatch.setattr(media_repo, "get_composition", fake_get_composition)
    monkeypatch.setattr(media_repo, "claim_composition_for_render", fake_claim)
    monkeypatch.setattr(media_repo, "get_assets_bulk", fake_bulk)
    monkeypatch.setattr(media_repo, "record_asset", fake_record)
    monkeypatch.setattr(media_repo, "set_composition_status", fake_status)

    concat_calls: list[dict] = []

    def fake_concat(paths, out, aspect="9:16", *, keep_audio=False):
        concat_calls.append({"paths": [str(p) for p in paths], "keep_audio": keep_audio})
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"OUT")
        return out

    monkeypatch.setattr(ffmpeg, "concat_clips", fake_concat)
    monkeypatch.setattr(ffmpeg, "probe_duration", lambda p: 8.0)
    monkeypatch.setattr(ffmpeg, "probe_has_audio", lambda p: True)
    state["concat_calls"] = concat_calls
    return state


async def test_happy_path_marks_done(env):
    comp = env["comp"]
    result = await compose.render_composition(
        user_id=USER, composition_id=comp.id
    )
    assert result.status == "done"
    statuses = [s for s, _, _ in env["status_calls"]]
    assert statuses == ["done"]
    # output asset was linked
    assert env["status_calls"][0][1] is not None
    # clips concatenated in the requested order, audio kept
    call = env["concat_calls"][0]
    assert call["keep_audio"] is True
    assert call["paths"] == [c.object_key for c in env["clips"]]


async def test_silent_concat_when_a_clip_has_no_audio(env, monkeypatch):
    monkeypatch.setattr(ffmpeg, "probe_has_audio", lambda p: False)
    await compose.render_composition(user_id=USER, composition_id=env["comp"].id)
    assert env["concat_calls"][0]["keep_audio"] is False


async def test_missing_clip_marks_failed(env):
    env["comp"] = env["comp"].model_copy(
        update={"clip_asset_ids": [*env["comp"].clip_asset_ids, uuid4()]}
    )
    result = await compose.render_composition(
        user_id=USER, composition_id=env["comp"].id
    )
    assert result.status == "failed"
    assert "not found" in (result.error or "")


async def test_double_spawn_is_noop(env):
    env["claimed"] = False
    result = await compose.render_composition(
        user_id=USER, composition_id=env["comp"].id
    )
    # no status transitions, no renders
    assert env["status_calls"] == []
    assert env["concat_calls"] == []
    assert result.id == env["comp"].id


async def test_volume_clip_gone_marks_failed(env):
    Path(env["clips"][0].object_key).unlink()
    result = await compose.render_composition(
        user_id=USER, composition_id=env["comp"].id
    )
    assert result.status == "failed"
    assert "no longer on the volume" in (result.error or "")
