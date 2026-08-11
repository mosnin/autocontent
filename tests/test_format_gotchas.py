"""The per-model gotchas KB: matching, prompt checking, and repair.

This knowledge base is consulted before every paid generation call, so
the tests care about two things: that the entries stay well-formed, and
that matching is neither too eager (a false positive rewrites a creative
prompt for nothing) nor too lax (a miss costs a wasted render).
"""
from __future__ import annotations

import pytest

from marketer.formats import gotchas

STAGES = {"image", "video", "avatar", "tts", "captions", "planning"}
SEVERITIES = {"blocker", "degrades", "cosmetic"}


# ------------------------------------------------------------------- shape


def test_keys_are_unique():
    keys = [g.key for g in gotchas.GOTCHAS]
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("g", gotchas.GOTCHAS, ids=[g.key for g in gotchas.GOTCHAS])
def test_every_entry_is_actionable(g):
    """An entry without a failure, a cause, and a fix is trivia. The
    whole point of the KB is that a reader can generalize it to a model
    that isn't listed."""
    assert g.models
    assert g.stage in STAGES
    assert g.severity in SEVERITIES
    assert g.failure.strip() and g.cause.strip() and g.rule.strip()
    assert g.key.startswith(f"{g.stage}.") or g.stage == "planning"


def test_get_returns_the_entry_by_key():
    g = gotchas.get("image.no-rendered-text")
    assert g is not None and g.severity == "blocker"
    assert gotchas.get("nope") is None


# ---------------------------------------------------------------- matching


def test_universal_rules_apply_to_every_model():
    for model in ("fal-ai/wan/v2.2", "grok-imagine-video", "totally-unknown"):
        keys = {g.key for g in gotchas.gotchas_for(model, stage="image")}
        assert "image.no-rendered-text" in keys
        assert "image.character-drift" in keys


def test_family_entries_match_every_variant_under_them():
    """fal ids are paths, so a family-level entry has to cover
    'fal-ai/kling-video/v2.1/standard/image-to-video'."""
    keys = {
        g.key
        for g in gotchas.gotchas_for(
            "fal-ai/kling-video/v2.1/standard/image-to-video", stage="video"
        )
    }
    assert "video.single-action" in keys


def test_veo3_variants_inherit_the_native_audio_rule():
    for model in ("fal-ai/veo3", "fal-ai/veo3/fast"):
        keys = {g.key for g in gotchas.gotchas_for(model, stage="video")}
        assert "video.veo3-native-audio" in keys
    # ...and a different provider does not.
    keys = {g.key for g in gotchas.gotchas_for("fal-ai/wan", stage="video")}
    assert "video.veo3-native-audio" not in keys


def test_model_specific_rules_do_not_leak_to_other_models():
    keys = {g.key for g in gotchas.gotchas_for("fal-ai/wan", stage="image")}
    assert "image.anatomy-safety-refusal" not in keys


def test_stage_filter_narrows_the_result():
    all_for = gotchas.gotchas_for("gpt-image-1")
    image_only = gotchas.gotchas_for("gpt-image-1", stage="image")
    assert {g.stage for g in image_only} == {"image"}
    assert len(image_only) < len(all_for)


def test_veo3_duration_is_a_planning_gotcha_not_a_video_one():
    """The scriptwriter needs to know Veo renders 8s clips, and it never
    sees the video client."""
    keys = {g.key for g in gotchas.gotchas_for("fal-ai/veo3", stage="planning")}
    assert "video.veo3-fixed-8s" in keys


# ----------------------------------------------------------- prompt checks


def test_a_prompt_asking_for_rendered_text_is_flagged():
    issues = gotchas.check_prompt(
        "a poster with a headline in bold typography",
        model_id="gpt-image-1",
        stage="image",
    )
    assert issues
    joined = " ".join(issues)
    assert "image.no-rendered-text" in joined
    # The issue has to carry the fix, or a re-prompt has nothing to act on.
    assert "burned in later" in joined


def test_word_boundaries_prevent_false_positives():
    """'context' contains 'text'. Rewriting a creative prompt over a
    substring match is worse than the failure it was guarding against."""
    issues = gotchas.check_prompt(
        "a jar in context on a workbench, textured clay",
        model_id="gpt-image-1",
        stage="image",
    )
    assert not any("image.no-rendered-text" in i for i in issues)


def test_punctuation_terms_still_match():
    """Em dashes have no word boundaries; they must match literally or
    the narration silently gets dead pauses."""
    issues = gotchas.check_prompt(
        "the valve holds — until it doesn't", model_id="gpt-4o-mini-tts", stage="tts"
    )
    assert any("tts.em-dash-pauses" in i for i in issues)


def test_stage_directions_in_narration_are_flagged():
    issues = gotchas.check_prompt(
        "[excited] the valve fails", model_id="gpt-4o-mini-tts", stage="tts"
    )
    assert any("stage-directions-are-read-aloud" in i for i in issues)


def test_motion_prompts_that_add_content_are_flagged():
    issues = gotchas.check_prompt(
        "the camera pushes in, then cuts to a wide shot",
        model_id="fal-ai/kling-video",
        stage="video",
    )
    assert any("video.motion-only" in i for i in issues)


def test_one_issue_per_gotcha_even_with_several_hits():
    issues = gotchas.check_prompt(
        "text and words and captions and labels",
        model_id="gpt-image-1",
        stage="image",
    )
    assert len([i for i in issues if "image.no-rendered-text" in i]) == 1


def test_a_clean_prompt_produces_no_issues():
    assert (
        gotchas.check_prompt(
            "a clay valve on a workbench, warm rim light",
            model_id="fal-ai/wan",
            stage="image",
        )
        == []
    )


# ------------------------------------------------------- prompt adjustment


def test_the_medical_guard_is_appended_for_gpt_image_1():
    adjusted, notes = gotchas.apply_prompt_rules(
        "cross-section of a stomach", model_id="gpt-image-1", stage="image"
    )
    assert "non-graphic" in adjusted
    assert any("appended guard" in n for n in notes)


def test_appending_the_guard_is_idempotent():
    """Re-running the repair (a retry, a second pass) must not stack the
    same clause over and over."""
    once, _ = gotchas.apply_prompt_rules(
        "cross-section of a stomach", model_id="gpt-image-1", stage="image"
    )
    twice, notes = gotchas.apply_prompt_rules(once, model_id="gpt-image-1", stage="image")
    assert twice == once
    assert not any("appended guard" in n for n in notes)


def test_offending_terms_are_reported_never_deleted():
    """Removing a word can change what the shot IS; that call belongs to
    the caller."""
    adjusted, notes = gotchas.apply_prompt_rules(
        "a bleeding wound, cross-section", model_id="gpt-image-1", stage="image"
    )
    assert "bleeding" in adjusted
    assert any("anatomy-safety-refusal" in n for n in notes)


def test_no_adjustment_when_nothing_applies():
    prompt = "a clay valve on a workbench"
    adjusted, notes = gotchas.apply_prompt_rules(
        prompt, model_id="whisper-1", stage="captions"
    )
    assert adjusted == prompt
    assert notes == []


# --------------------------------------------------------- prompt blocks


def test_rules_block_is_prompt_ready_and_names_the_model():
    block = gotchas.rules_block("fal-ai/veo3", stage="video")
    assert block.startswith("MODEL CONSTRAINTS (fal-ai/veo3)")
    assert block.count("\n- ") == len(gotchas.prompt_rules("fal-ai/veo3", stage="video"))


def test_rules_block_is_empty_when_nothing_applies():
    assert gotchas.rules_block("some-unknown-model", stage="captions") == ""


def test_summaries_expose_the_kb_without_the_matching_guts():
    rows = gotchas.summaries(stage="tts")
    assert rows and {r.stage for r in rows} == {"tts"}
    assert all(r.failure and r.rule and r.models for r in rows)
    assert len(gotchas.summaries()) == len(gotchas.GOTCHAS)
