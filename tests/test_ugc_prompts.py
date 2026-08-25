"""`@imageN` reference parsing/validation and UGC prompt assembly."""
from __future__ import annotations

import pytest

from marketer.ugc import prompts
from marketer.ugc.prompts import (
    IMAGE_TO_VIDEO,
    TEXT_TO_VIDEO,
    UgcPromptError,
    assemble_prompt,
    parse_image_refs,
    render_mode_for,
    validate_image_refs,
)


def test_parses_refs_in_order_including_repeats():
    script = "@image1 holds @image2, then @image1 smiles"
    assert parse_image_refs(script) == [1, 2, 1]


def test_double_digit_reference_is_one_index_not_two():
    assert parse_image_refs("@image12 on the table") == [12]


def test_bare_word_image_is_not_a_reference():
    assert parse_image_refs("the images look great, @images too") == []


def test_no_refs_is_fine():
    assert validate_image_refs("just a plain script", 0) == []


def test_dangling_reference_is_rejected_before_paying_for_the_render():
    with pytest.raises(UgcPromptError) as exc:
        validate_image_refs("@image1 holding @image3", 2)
    assert "@image3" in str(exc.value)


def test_zero_index_is_rejected_references_are_one_based():
    with pytest.raises(UgcPromptError, match="@image0"):
        validate_image_refs("@image0 waves", 2)


def test_reference_without_any_uploads_is_rejected():
    with pytest.raises(UgcPromptError, match="no reference images"):
        validate_image_refs("@image1 waves", 0)


def test_dual_mode_switch_matches_the_source():
    assert render_mode_for(0) == TEXT_TO_VIDEO
    assert render_mode_for(1) == IMAGE_TO_VIDEO
    assert render_mode_for(7) == IMAGE_TO_VIDEO


def test_text_to_video_requires_a_script():
    with pytest.raises(UgcPromptError, match="script is required"):
        assemble_prompt("   ", image_count=0)


def test_image_to_video_allows_an_empty_script():
    out = assemble_prompt("", image_count=1)
    assert out == prompts.UGC_DIRECTIVE


def test_assembly_collapses_whitespace_and_appends_the_ugc_directive():
    out = assemble_prompt("say   this\n\n\n\nnow", image_count=0)
    assert "say this" in out
    assert "\n\n\n" not in out
    assert out.endswith(prompts.UGC_DIRECTIVE)


def test_assembly_preserves_the_reference_tokens_verbatim():
    # The tokens are the provider's own multi-reference syntax; rewriting
    # them would break the mapping to images_list.
    out = assemble_prompt("@image1 holds up @image2", image_count=2)
    assert "@image1" in out and "@image2" in out


def test_assembly_can_skip_the_directive():
    out = assemble_prompt("plain script", image_count=0, add_directive=False)
    assert out == "plain script"


def test_assembly_validates_refs_against_the_attached_count():
    with pytest.raises(UgcPromptError):
        assemble_prompt("@image8 waves", image_count=7)
    assert assemble_prompt("@image7 waves", image_count=7)


def test_overlong_script_is_rejected():
    with pytest.raises(UgcPromptError, match="over the"):
        assemble_prompt("x" * (prompts.MAX_PROMPT_CHARS + 1), image_count=0)
