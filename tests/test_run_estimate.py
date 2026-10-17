"""Unit tests for the up-front prepaid-credit estimator.

The Steve Jobs audit made ``refuse_if_credit_*`` the HTTP-edge gate for
every spend-creating button. Jobs enqueue already pins the happy-path
arithmetic against ``POST /niches/estimate``. These cover the branches
that silently under-price a run (music off, library, zero scenes, fal
rate, billing-off skip) — a wrong figure either blocks a payable user
or lets a $0 balance enqueue a pipeline that dies mid-spend.
"""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from marketer.services import run_estimate
from marketer.services.openai_pricing import (
    GPT_4O_MINI_TTS_USD_PER_MINUTE,
    LLM_CALL_ESTIMATE_USD,
    WHISPER_1_USD_PER_MINUTE,
    image_cost,
)
from marketer.services.xai_pricing import IMAGINE_VIDEO_USD_PER_SECOND


def _niche(**overrides):
    base = dict(
        scene_count=6,
        image_quality="medium",
        scene_max_duration_sec=5,
        target_duration_sec=60,
        video_provider="grok",
        fal_model="",
        music_provider="library",
        creative_brief=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_music_disabled_in_brief_is_zero():
    on = _niche(
        music_provider="generated",
        creative_brief=SimpleNamespace(audio=SimpleNamespace(music_enabled=True)),
    )
    off = _niche(
        music_provider="generated",
        creative_brief=SimpleNamespace(audio=SimpleNamespace(music_enabled=False)),
    )
    assert run_estimate.estimate_run_cost_usd(off) < run_estimate.estimate_run_cost_usd(on)
    assert run_estimate._music_estimate_usd(off, 60) == Decimal("0")


def test_library_music_is_zero(monkeypatch):
    """A library track is already paid for — the estimate must not add
    ElevenLabs minutes on top, even when a key is configured."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "sk-test", raising=False)
    niche = _niche(music_provider="library")
    assert run_estimate._music_estimate_usd(niche, 60) == Decimal("0")


def test_auto_music_is_zero_without_elevenlabs_key(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)
    niche = _niche(music_provider="auto")
    assert run_estimate._music_estimate_usd(niche, 60) == Decimal("0")


def test_generated_music_uses_the_published_rate(monkeypatch):
    from marketer.config import settings
    from marketer.services.music_gen import USD_PER_MINUTE

    monkeypatch.setattr(settings, "elevenlabs_api_key", "sk-test", raising=False)
    niche = _niche(music_provider="generated")
    assert run_estimate._music_estimate_usd(niche, 60) == USD_PER_MINUTE


def test_zero_scenes_still_prices_character_sheet_and_agents(monkeypatch):
    """scene_count=0 must not go negative or drop the always-on costs.
    A $0 figure here would let an empty/misconfigured niche pass the
    credit gate and then spend on the character sheet + LLM stages."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)
    niche = _niche(scene_count=0, scene_max_duration_sec=0, target_duration_sec=0)
    got = run_estimate.estimate_run_cost_usd(niche)
    expected = (
        image_cost("medium", 1, size="1024x1536") + LLM_CALL_ESTIMATE_USD * 6
    ).quantize(Decimal("0.0001"))
    assert got == expected
    assert got > 0


def test_fal_model_rate_replaces_grok(monkeypatch):
    """A more expensive fal model must raise the estimate. Falling back
    to the grok $0.05/s rate under-reserves prepaid credit."""
    from marketer.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)
    grok = _niche(video_provider="grok", fal_model="")
    fal = _niche(
        video_provider="fal",
        fal_model="fal-ai/luma-dream-machine/ray-2",
    )
    grok_est = run_estimate.estimate_run_cost_usd(grok)
    fal_est = run_estimate.estimate_run_cost_usd(fal)
    # 6 scenes * 5s * ($0.18 - $0.05) = $3.90
    assert fal_est - grok_est == Decimal("3.9000")
    assert run_estimate._video_rate_per_sec(grok) == IMAGINE_VIDEO_USD_PER_SECOND


def test_unknown_fal_model_falls_back_to_grok_rate():
    niche = _niche(video_provider="fal", fal_model="fal-ai/does-not-exist")
    assert run_estimate._video_rate_per_sec(niche) == IMAGINE_VIDEO_USD_PER_SECOND


def test_estimated_charge_applies_margin(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_margin", 1.5)
    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)
    niche = _niche()
    raw = run_estimate.estimate_run_cost_usd(niche)
    assert run_estimate.estimated_charge_usd(niche) == (raw * Decimal("1.5")).quantize(
        Decimal("0.01")
    )


def test_usd_formats_negative_without_minus_after_dollar():
    assert run_estimate._usd(Decimal("-1.5")) == "-$1.50"
    assert run_estimate._usd(Decimal("0")) == "$0.00"
    assert run_estimate._usd(Decimal("2.5")) == "$2.50"


@pytest.mark.asyncio
async def test_refuse_skips_ledger_when_billing_is_off(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "billing_enabled", False)
    called = []

    async def _balance(user_id):
        called.append(user_id)
        return Decimal("0")

    monkeypatch.setattr("marketer.repos.billing.balance", _balance)
    await run_estimate.refuse_if_credit_below("user_x", Decimal("1"), what="This run")
    await run_estimate.refuse_if_credit_short("user_x", _niche())
    assert called == []


@pytest.mark.asyncio
async def test_refuse_raises_402_with_human_message_when_short(monkeypatch):
    from marketer.config import settings
    import marketer.repos.billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.5)

    async def _balance(user_id):
        assert user_id == "user_x"
        return Decimal("0")

    monkeypatch.setattr(billing_repo, "balance", _balance)

    with pytest.raises(HTTPException) as ei:
        await run_estimate.refuse_if_credit_below(
            "user_x", Decimal("0.40"), what="This article"
        )
    assert ei.value.status_code == 402
    detail = ei.value.detail
    assert "This article" in detail
    assert "Add credit" in detail
    assert "$0.60" in detail  # 0.40 * 1.5
    assert "$0.00" in detail


@pytest.mark.asyncio
async def test_refuse_allows_when_balance_covers_charge(monkeypatch):
    from marketer.config import settings
    import marketer.repos.billing as billing_repo

    monkeypatch.setattr(settings, "billing_enabled", True)
    monkeypatch.setattr(settings, "billing_margin", 1.5)

    async def _balance(user_id):
        return Decimal("10")

    monkeypatch.setattr(billing_repo, "balance", _balance)
    await run_estimate.refuse_if_credit_below("user_x", Decimal("0.40"), what="This run")


def test_tts_and_whisper_scale_with_target_duration(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "", raising=False)
    short = _niche(target_duration_sec=30)
    long = _niche(target_duration_sec=60)
    delta = run_estimate.estimate_run_cost_usd(long) - run_estimate.estimate_run_cost_usd(
        short
    )
    expected = (GPT_4O_MINI_TTS_USD_PER_MINUTE + WHISPER_1_USD_PER_MINUTE) * Decimal(
        "0.5"
    )
    assert delta == expected.quantize(Decimal("0.0001"))
