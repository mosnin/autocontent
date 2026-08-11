"""Seedance 2.5 catalog: routes, capability validation, pinned pricing.

Pure functions — no DB, no provider, no network. The first three tests are
the author's own catalog expectations from `seedance-2.5-mcp`'s
tests/test_catalog.py, carried over as a spec.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from marketer.config import settings
from marketer.services import seedance
from marketer.services.seedance import (
    SeedancePricingError,
    SeedanceValidationError,
    build_request,
)

ALL_IDS = {
    "seedance-2.5-text-to-video",
    "seedance-2.5-image-to-video",
    "seedance-2.5-first-last-frame",
    "seedance-2.5-omni-reference",
}

T2V = "seedance-2.5-text-to-video"
I2V = "seedance-2.5-image-to-video"
FIRST_LAST = "seedance-2.5-first-last-frame"
OMNI = "seedance-2.5-omni-reference"


@pytest.fixture
def cfg(monkeypatch):
    """Override `seedance_*` settings that do not exist on Settings yet.

    The `seedance_*` fields land in config.py in the lead's integration
    commit; `Settings` is a pydantic model, so monkeypatching an attribute
    it does not declare raises. Patching the module's own settings seam
    exercises exactly the code path the real fields will feed once added.
    """
    overrides: dict[str, object] = {}
    real = seedance._setting
    monkeypatch.setattr(
        seedance, "_setting", lambda name, default: overrides.get(name, real(name, default))
    )
    return overrides


# ----------------------------------------------------- the author's own spec


def test_catalog_is_the_four_standard_routes():
    assert {m.id for m in seedance.list_models()} == ALL_IDS


def test_low_resolution_selects_the_allowlisted_480p_endpoint():
    req = build_request(T2V, prompt="A paper boat on a stream", resolution="480p", seed=42)
    assert req.endpoint == "seedance-2.5-text-to-video-480p"
    # The tier is the endpoint, never a body field — sending it in the body
    # would be silently ignored by the gateway.
    assert "resolution" not in req.body()
    assert req.body()["seed"] == 42


def test_first_last_frame_requires_exactly_two_images():
    with pytest.raises(SeedanceValidationError):
        build_request(FIRST_LAST, prompt="Transition", image_urls=["https://e.com/a.jpg"])
    with pytest.raises(SeedanceValidationError):
        build_request(
            FIRST_LAST,
            prompt="Transition",
            image_urls=["https://e.com/a.jpg", "https://e.com/b.jpg", "https://e.com/c.jpg"],
        )
    req = build_request(
        FIRST_LAST, prompt="Transition", image_urls=["https://e.com/a.jpg", "https://e.com/b.jpg"]
    )
    assert req.body()["images_list"] == ["https://e.com/a.jpg", "https://e.com/b.jpg"]


# ------------------------------------------------------------- declarations


def test_every_model_declares_coherent_defaults_and_endpoints():
    for model in seedance.list_models():
        assert model.endpoint and not model.endpoint.startswith("/")
        assert model.endpoint_480p.endswith("-480p")
        assert model.default_aspect_ratio in model.aspect_ratios
        assert model.default_resolution in model.resolutions
        assert model.allows_duration(model.default_duration)
        assert model.min_images <= model.max_images


def test_every_model_defaults_to_vertical():
    # This product renders TikTok/Reels/Shorts; the source's 16:9 default
    # is deliberately overridden while the allowed set is ported intact.
    for model in seedance.list_models():
        assert model.default_aspect_ratio == "9:16"
    assert seedance.ASPECT_RATIOS == ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21")


def test_only_the_reference_routes_advertise_character_reference():
    by_id = {m.id: m for m in seedance.list_models()}
    assert by_id[OMNI].supports_character_reference
    assert by_id[I2V].supports_character_reference
    assert not by_id[T2V].supports_character_reference
    assert (by_id[OMNI].max_images, by_id[OMNI].max_videos, by_id[OMNI].max_audios) == (20, 6, 6)


def test_endpoint_for_maps_tiers_to_allowlisted_paths():
    model = seedance.require_model(OMNI)
    assert model.endpoint_for("720p") == "seedance-2.5-omni-reference"
    assert model.endpoint_for("480p") == "seedance-2.5-omni-reference-480p"


# -------------------------------------------------------------- validation


def test_unknown_model_is_rejected():
    with pytest.raises(SeedanceValidationError, match="unknown seedance model"):
        build_request("seedance-9000", prompt="hi")


def test_empty_prompt_is_rejected():
    with pytest.raises(SeedanceValidationError, match="prompt is required"):
        build_request(T2V, prompt="   ")


def test_unsupported_aspect_ratio_is_rejected():
    with pytest.raises(SeedanceValidationError, match="aspect ratio"):
        build_request(T2V, prompt="hi", aspect_ratio="5:4")


@pytest.mark.parametrize("duration", [3, 31, 0])
def test_out_of_range_duration_is_rejected(duration):
    with pytest.raises(SeedanceValidationError, match="duration"):
        build_request(T2V, prompt="hi", duration=duration)


def test_boundary_durations_are_accepted():
    assert build_request(T2V, prompt="hi", duration=4).duration == 4
    assert build_request(T2V, prompt="hi", duration=30).duration == 30


def test_unsupported_resolution_is_rejected():
    with pytest.raises(SeedanceValidationError, match="resolution"):
        build_request(T2V, prompt="hi", resolution="1080p")


def test_unknown_camera_move_is_rejected():
    with pytest.raises(SeedanceValidationError, match="camera move"):
        build_request(T2V, prompt="hi", camera_move="barrel_roll")


def test_camera_move_is_folded_into_the_prompt():
    # Seedance has no camera field on the wire; the validated token becomes
    # consistent prose so the same token renders the same move every time.
    req = build_request(T2V, prompt="A red boat drifting.", camera_move="dolly_in")
    assert req.prompt == "A red boat drifting. camera dollies in towards the subject."
    assert "camera_move" not in req.body()


def test_image_to_video_requires_exactly_one_image():
    with pytest.raises(SeedanceValidationError, match="image_urls"):
        build_request(I2V, prompt="animate")
    req = build_request(I2V, prompt="animate", image_urls=["https://e.com/a.jpg"])
    assert req.body()["image_url"] == "https://e.com/a.jpg"
    assert req.body()["images_list"] == ["https://e.com/a.jpg"]


def test_text_to_video_rejects_reference_media():
    with pytest.raises(SeedanceValidationError):
        build_request(T2V, prompt="hi", image_urls=["https://e.com/a.jpg"])


def test_omni_caps_reference_media_arity():
    with pytest.raises(SeedanceValidationError, match="image_urls"):
        build_request(OMNI, prompt="hi", image_urls=[f"https://e.com/{i}.jpg" for i in range(21)])
    with pytest.raises(SeedanceValidationError, match="video_urls"):
        build_request(OMNI, prompt="hi", video_urls=[f"https://e.com/{i}.mp4" for i in range(7)])
    with pytest.raises(SeedanceValidationError, match="audio_urls"):
        build_request(OMNI, prompt="hi", audio_urls=[f"https://e.com/{i}.wav" for i in range(7)])

    req = build_request(
        OMNI,
        prompt="hi",
        image_urls=["https://e.com/a.jpg"],
        video_urls=["https://e.com/a.mp4"],
        audio_urls=["https://e.com/a.wav"],
    )
    assert req.body()["videos_list"] == ["https://e.com/a.mp4"]
    assert req.body()["audios_list"] == ["https://e.com/a.wav"]


def test_defaults_are_filled_in_when_nothing_is_supplied():
    req = build_request(T2V, prompt="hi")
    assert (req.aspect_ratio, req.duration, req.resolution) == ("9:16", 5, "720p")
    assert req.body() == {"prompt": "hi", "aspect_ratio": "9:16", "duration": 5}


# ----------------------------------------------------------------- pricing


def test_every_model_has_a_pinned_price_for_every_declared_tier():
    for model in seedance.list_models():
        for res in model.resolutions:
            assert seedance.usd_per_second(model, res) > 0


def test_480p_is_the_cheap_preview_tier():
    for model in seedance.list_models():
        assert seedance.usd_per_second(model, "480p") < seedance.usd_per_second(model, "720p")


def test_render_cost_multiplies_the_pinned_rate_by_duration():
    model = seedance.require_model(T2V)
    assert seedance.render_cost(model, duration=6, resolution="720p") == Decimal("0.6000")
    assert seedance.render_cost(model, duration=6, resolution="480p") == Decimal("0.3000")


def test_unpriced_tier_fails_closed(monkeypatch):
    # An unpriced render would be an unmetered charge on the operator's
    # gateway account, so it must refuse rather than default to zero.
    monkeypatch.setitem(seedance.USD_PER_SECOND, T2V, {"720p": Decimal("0.10")})
    with pytest.raises(SeedancePricingError):
        seedance.usd_per_second(seedance.require_model(T2V), "480p")


def test_price_override_applies_per_tier_and_per_model(cfg):
    cfg["seedance_price_overrides"] = (
        '{"seedance-2.5-text-to-video": "0.20", "seedance-2.5-text-to-video@480p": "0.01"}'
    )
    model = seedance.require_model(T2V)
    # The tier-specific key wins over the bare model key.
    assert seedance.usd_per_second(model, "480p") == Decimal("0.01")
    assert seedance.usd_per_second(model, "720p") == Decimal("0.20")


def test_malformed_price_override_is_ignored_not_fatal(cfg, caplog):
    cfg["seedance_price_overrides"] = "{not json"
    with caplog.at_level("WARNING"):
        assert seedance.usd_per_second(seedance.require_model(T2V), "720p") == Decimal("0.10")
    assert any("not valid JSON" in r.message for r in caplog.records)


def test_non_positive_price_override_is_dropped(cfg):
    cfg["seedance_price_overrides"] = '{"seedance-2.5-text-to-video": "0"}'
    assert seedance.usd_per_second(seedance.require_model(T2V), "720p") == Decimal("0.10")


def test_cost_basis_reports_every_tier(cfg):
    cfg["seedance_price_overrides"] = ""
    basis = seedance.cost_basis(seedance.require_model(OMNI))
    assert basis == {
        "unit": "usd_per_second",
        "by_resolution": {"720p": "0.15", "480p": "0.075"},
    }


# ----------------------------------------------------------------- describe


def test_describe_exposes_the_whole_capability_surface(cfg):
    cfg["seedance_api_key"] = "sd-test"
    entry = seedance.describe(seedance.require_model(OMNI))
    assert entry["id"] == OMNI
    assert entry["provider"] == "seedance"
    assert entry["duration"] == {"kind": "range", "min": 4, "max": 30, "default": 5}
    assert entry["reference_media"]["character_reference"] is True
    assert "dolly_in" in entry["camera_controls"]
    assert entry["available"] is True


def test_catalog_reports_unavailable_without_a_key(cfg, monkeypatch):
    cfg["seedance_api_key"] = ""
    monkeypatch.setattr(settings, "muapi_api_key", "")
    assert all(entry["available"] is False for entry in seedance.catalog())
