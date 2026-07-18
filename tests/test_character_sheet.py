from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from marketer.config import settings
from marketer.models import Niche, PostingWindow
from marketer.services import character_sheet, openai_images


def _niche(niche_id: UUID) -> Niche:
    return Niche(
        id=niche_id,
        user_id="user_test",
        title="Clay Ducks Explain Macro",
        description="A duck explains an economics concept in 60s.",
        target_audience="finance-curious zoomers",
        hashtags=["macro", "econ"],
        visual_style="soft 3D claymation, pastel palette, shallow DOF",
        voice="onyx",
        target_duration_sec=60,
        scene_count=6,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="America/Los_Angeles")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
    )


@pytest.fixture
def isolated_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))
    return tmp_path


async def test_get_or_create_generates_when_missing(
    monkeypatch, isolated_assets, fake_spend
):
    ctx, _ = fake_spend
    niche = _niche(UUID("00000000-0000-0000-0000-0000000000aa"))

    called_with: dict = {}

    async def fake_generate_reference(prompt, out_path, **kwargs):
        called_with["prompt"] = prompt
        called_with["out_path"] = out_path
        called_with["kwargs"] = kwargs
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"fake-png")
        return out_path

    monkeypatch.setattr(openai_images, "generate_reference", fake_generate_reference)

    path = await character_sheet.get_or_create(niche, spend=ctx)
    assert path == character_sheet.sheet_path(niche.id)
    assert path.read_bytes() == b"fake-png"
    assert niche.visual_style in called_with["prompt"]


async def test_get_or_create_reuses_existing(monkeypatch, isolated_assets, fake_spend):
    ctx, _ = fake_spend
    niche = _niche(UUID("00000000-0000-0000-0000-0000000000bb"))
    pre = character_sheet.sheet_path(niche.id)
    pre.parent.mkdir(parents=True, exist_ok=True)
    pre.write_bytes(b"already-here")

    mock = AsyncMock()
    monkeypatch.setattr(openai_images, "generate_reference", mock)

    path = await character_sheet.get_or_create(niche, spend=ctx)
    assert path.read_bytes() == b"already-here"
    mock.assert_not_called()


# --------------------------------------------------------------------------- custom cast + staleness

async def test_custom_character_description_in_prompt(monkeypatch, tmp_path):
    niche_id = UUID("00000000-0000-0000-0000-00000000c0de")
    niche = _niche(niche_id).model_copy(
        update={"character_description": "a grumpy clay llama named Sol"}
    )
    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))

    async def fake_generate(prompt, path, *, quality, spend=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"PNG")
        fake_generate.prompt = prompt
        return path

    monkeypatch.setattr(openai_images, "generate_reference", fake_generate)

    await character_sheet.get_or_create(niche)
    assert "a grumpy clay llama named Sol" in fake_generate.prompt


async def test_sheet_regenerates_when_style_or_cast_changes(monkeypatch, tmp_path):
    niche_id = UUID("00000000-0000-0000-0000-00000000c1de")
    niche = _niche(niche_id)
    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))

    calls = {"n": 0}

    async def fake_generate(prompt, path, *, quality, spend=None):
        calls["n"] += 1
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"PNG")
        return path

    monkeypatch.setattr(openai_images, "generate_reference", fake_generate)

    # 1st call renders; 2nd (unchanged) is a cache hit
    await character_sheet.get_or_create(niche)
    await character_sheet.get_or_create(niche)
    assert calls["n"] == 1

    # editing the cast invalidates the fingerprint -> regenerate once
    edited = niche.model_copy(update={"character_description": "new mascot"})
    await character_sheet.get_or_create(edited)
    await character_sheet.get_or_create(edited)
    assert calls["n"] == 2

    # editing visual_style also invalidates
    restyled = edited.model_copy(update={"visual_style": "isometric papercraft"})
    await character_sheet.get_or_create(restyled)
    assert calls["n"] == 3


async def test_legacy_sheet_without_fingerprint_adopted_not_regenerated(
    monkeypatch, tmp_path
):
    niche_id = UUID("00000000-0000-0000-0000-00000000c2de")
    niche = _niche(niche_id)
    monkeypatch.setattr(settings, "assets_dir", str(tmp_path))

    # a pre-fingerprint sheet already on the volume
    legacy = character_sheet.sheet_path(niche_id)
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(b"OLD PNG")

    gen = AsyncMock()
    monkeypatch.setattr(openai_images, "generate_reference", gen)

    path = await character_sheet.get_or_create(niche)
    assert path == legacy
    gen.assert_not_awaited()  # adopted, not re-bought

    # but a style edit after adoption regenerates
    async def fake_generate(prompt, p, *, quality, spend=None):
        p.write_bytes(b"NEW PNG")
        return p

    monkeypatch.setattr(openai_images, "generate_reference", fake_generate)
    restyled = niche.model_copy(update={"visual_style": "vaporwave collage"})
    await character_sheet.get_or_create(restyled)
    assert legacy.read_bytes() == b"NEW PNG"
