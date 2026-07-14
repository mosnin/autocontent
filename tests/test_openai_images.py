from __future__ import annotations

import base64
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from marketer.services import openai_images


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\xc0\xc0\x00\x00\x00\x05\x00\x01]\xcc\xdb\xd1\x00\x00\x00\x00IEND\xaeB`\x82"
)
B64 = base64.b64encode(PNG_BYTES).decode()


def _fake_image_response() -> SimpleNamespace:
    return SimpleNamespace(data=[SimpleNamespace(b64_json=B64)])


@pytest.fixture
def fake_client(monkeypatch):
    client = MagicMock()
    client.images.generate = AsyncMock(return_value=_fake_image_response())
    client.images.edit = AsyncMock(return_value=_fake_image_response())
    monkeypatch.setattr(openai_images, "_client", client)
    return client


async def test_generate_keyframe_no_reference(tmp_path: Path, fake_client, fake_spend):
    ctx, rec = fake_spend
    out = tmp_path / "kf.png"

    result = await openai_images.generate_keyframe(
        "a clay duck", out, quality="medium", spend=ctx
    )

    assert result == out
    assert out.read_bytes() == PNG_BYTES
    fake_client.images.generate.assert_awaited_once()
    fake_client.images.edit.assert_not_called()

    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.sku == "gpt-image-1"
    assert entry.cost_usd == Decimal("0.042")
    assert entry.units == Decimal(1)


async def test_generate_keyframe_with_reference(tmp_path: Path, fake_client, fake_spend):
    ctx, rec = fake_spend
    ref = tmp_path / "ref.png"
    ref.write_bytes(PNG_BYTES)
    out = tmp_path / "kf.png"

    await openai_images.generate_keyframe(
        "a clay duck on a boat",
        out,
        quality="medium",
        reference_image_path=ref,
        spend=ctx,
    )

    fake_client.images.edit.assert_awaited_once()
    fake_client.images.generate.assert_not_called()
    assert rec.entries[0].cost_usd == Decimal("0.042")


async def test_no_spend_recorded_without_context(tmp_path: Path, fake_client):
    out = tmp_path / "kf.png"
    await openai_images.generate_keyframe("clay test", out, quality="low")
    # no spend ctx -> nothing logged; call still succeeded
    assert out.exists()
