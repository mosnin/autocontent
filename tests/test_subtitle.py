from __future__ import annotations

from pathlib import Path

import pytest

from marketer.services import subtitle


def test_ass_time_formats_correctly():
    assert subtitle._to_ass_time(0.0) == "0:00:00.00"
    assert subtitle._to_ass_time(1.5) == "0:00:01.50"
    assert subtitle._to_ass_time(61.25) == "0:01:01.25"
    assert subtitle._to_ass_time(3725.9) == "1:02:05.90"


def test_words_to_ass_emits_header_and_per_word_dialogues(tmp_path: Path):
    words = [
        {"word": "hello", "start": 0.0, "end": 0.5},
        {"word": "world", "start": 0.5, "end": 1.2},
    ]
    out = tmp_path / "subs.ass"

    subtitle.words_to_ass(words, out)
    body = out.read_text(encoding="utf-8")

    assert "[Script Info]" in body
    assert "PlayResX: 1080" in body
    assert "PlayResY: 1920" in body
    assert "Style: Default,Arial Black,96" in body

    dialogues = [line for line in body.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogues) == 2
    assert dialogues[0].endswith(",hello")
    assert "0:00:00.00" in dialogues[0]
    assert "0:00:00.50" in dialogues[0]
    assert dialogues[1].endswith(",world")
    assert "0:00:00.50" in dialogues[1]
    assert "0:00:01.20" in dialogues[1]


def test_words_to_ass_escapes_curly_braces(tmp_path: Path):
    out = tmp_path / "subs.ass"
    subtitle.words_to_ass(
        [{"word": "te{st}", "start": 0.0, "end": 0.3}], out
    )
    body = out.read_text(encoding="utf-8")
    # raw braces would be interpreted as ASS override tags
    assert "{" not in body.split("[Events]")[1]
    assert "te(st)" in body


def test_words_to_ass_skips_blank_words(tmp_path: Path):
    out = tmp_path / "subs.ass"
    subtitle.words_to_ass(
        [
            {"word": "  ", "start": 0.0, "end": 0.1},
            {"word": "hi", "start": 0.1, "end": 0.4},
        ],
        out,
    )
    dialogues = [
        line for line in out.read_text().splitlines() if line.startswith("Dialogue:")
    ]
    assert len(dialogues) == 1
    assert dialogues[0].endswith(",hi")


def test_caption_style_customizes_header_and_case(tmp_path: Path):
    from marketer.models import CaptionStyle

    style = CaptionStyle(
        font="Impact", font_size=120, text_hex="ffe14d", outline_hex="1a1a2e",
        uppercase=True, position="center",
    )
    out = tmp_path / "subs.ass"
    subtitle.words_to_ass(
        [{"word": "hello", "start": 0.0, "end": 0.5}], out, caption_style=style
    )
    body = out.read_text(encoding="utf-8")

    assert "Style: Default,Impact,120" in body
    # RRGGBB -> ASS BGR: ffe14d -> &H004DE1FF, 1a1a2e -> &H002E1A1A
    assert "&H004DE1FF" in body
    assert "&H002E1A1A" in body
    # center position -> alignment 5, MarginV 0
    assert ",5,60,60,0,1" in body
    assert ",HELLO" in body  # uppercase applied


def test_caption_style_validation_rejects_garbage():
    from pydantic import ValidationError

    from marketer.models import CaptionStyle

    with pytest.raises(ValidationError):
        CaptionStyle(text_hex="not-a-color")
    with pytest.raises(ValidationError):
        CaptionStyle(font_size=999)
    with pytest.raises(ValidationError):
        CaptionStyle(position="diagonal")
