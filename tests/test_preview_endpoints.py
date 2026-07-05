"""Voice preview + character sheet endpoints — the blind-choice fixes."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from autocontent.models import Niche, PostingWindow
from backend.auth import AuthCtx, require_user
from backend.main import create_app
from backend.rate_limit import limiter


@pytest.fixture()
def client():
    limiter.reset()
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    return TestClient(app)


def test_unknown_voice_404(client):
    resp = client.get(
        "/api/v1/voices/darthvader/preview",
        headers={"Authorization": "Bearer act_x"},
    )
    assert resp.status_code == 404


def test_voice_preview_synthesizes_once_then_caches(client, monkeypatch, tmp_path):
    from backend.routes import voices as voices_route

    calls: list[str] = []

    async def fake_synthesize(text, out_path, *, voice="onyx", **kw):
        calls.append(voice)
        Path(out_path).write_bytes(b"RIFFfakewav")
        return out_path

    monkeypatch.setattr(voices_route.openai_tts, "synthesize", fake_synthesize)
    monkeypatch.setattr(
        voices_route, "preview_path", lambda v: tmp_path / f"{v}.wav"
    )

    r1 = client.get(
        "/api/v1/voices/nova/preview", headers={"Authorization": "Bearer act_x"}
    )
    r2 = client.get(
        "/api/v1/voices/nova/preview", headers={"Authorization": "Bearer act_x"}
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert calls == ["nova"]  # second hit served from cache


def test_character_sheet_404_before_first_run(client, monkeypatch):
    from autocontent.repos import niches as niches_repo

    niche = Niche(
        id=uuid4(),
        user_id="user_a",
        title="t",
        description="d",
        target_audience="a",
        visual_style="v",
        voice="onyx",
        target_duration_sec=60,
        scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"),
        created_at=datetime.now(timezone.utc),
    )

    async def fake_get(niche_id, *, user_id):
        return niche

    monkeypatch.setattr(niches_repo, "get", fake_get)

    resp = client.get(
        f"/api/v1/niches/{niche.id}/character-sheet",
        headers={"Authorization": "Bearer act_x"},
    )
    assert resp.status_code == 404
    assert "not generated yet" in resp.json()["detail"]
