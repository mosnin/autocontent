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
