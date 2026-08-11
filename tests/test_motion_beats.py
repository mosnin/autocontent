"""Beat segmentation: pure, deterministic, bounded.

No ffmpeg, no network, no DB — that is the point of keeping `motion.beats`
free of I/O. What matters here is that the beat model stays monotonic and
bounded no matter what the ASR provider hands us, because every beat
downstream costs money.
"""
from __future__ import annotations

from marketer.motion.beats import (
    MAX_BEAT_SEC,
    MIN_BEAT_SEC,
    Beat,
    beats_from_narration,
    enforce_beat_cap,
    normalize_words,
    segment_words,
    total_duration,
)


def words(*spec) -> list[dict]:
    """(word, start, end) triples -> the house word-dict shape."""
    return [{"word": w, "start": s, "end": e} for w, s, e in spec]


def test_no_words_yields_no_beats():
    assert segment_words([]) == []
    assert total_duration([]) == 0.0


def test_sentence_end_closes_a_beat_once_it_is_long_enough():
    out = segment_words(
        words(
            ("Coffee", 0.0, 0.6),
            ("beans", 0.6, 1.2),
            ("roast", 1.2, 1.8),
            ("dark.", 1.8, 2.4),
            ("Then", 2.4, 3.0),
            ("we", 3.0, 3.4),
            ("grind", 3.4, 4.0),
            ("them.", 4.0, 4.8),
        )
    )
    assert [b.text for b in out] == [
        "Coffee beans roast dark.",
        "Then we grind them.",
    ]
    assert [b.index for b in out] == [0, 1]
    assert out[0].end == 2.4 and out[1].start == 2.4


def test_a_sentence_end_below_the_minimum_does_not_cut():
    """A two-word beat is a visual that flashes past unread."""
    out = segment_words(
        words(("Hi.", 0.0, 0.4), ("We", 0.4, 0.8), ("make", 0.8, 1.4), ("coffee.", 1.4, 2.6))
    )
    assert len(out) == 1
    assert out[0].text == "Hi. We make coffee."


def test_a_long_pause_cuts_a_beat():
    out = segment_words(
        words(
            ("one", 0.0, 0.8),
            ("two", 0.8, 2.2),
            ("three", 3.0, 3.6),  # 0.8s gap before "three"
            ("four", 3.6, 4.4),
            ("five", 4.4, 5.2),
            ("six", 5.2, 6.0),
        )
    )
    assert len(out) == 2
    assert out[0].text == "one two"


def test_the_max_length_force_closes_a_beat():
    spec = [(f"w{i}", i * 1.0, i * 1.0 + 1.0) for i in range(20)]
    out = segment_words(words(*spec))
    # The cut is made on the word that crosses the ceiling, so a beat can
    # overshoot by at most one word (1.0s here) — never by more.
    assert out
    assert all(b.duration <= MAX_BEAT_SEC + 1.0 for b in out)


def test_a_trailing_runt_is_absorbed_by_its_predecessor():
    out = segment_words(
        words(
            ("We", 0.0, 0.5),
            ("ship", 0.5, 1.2),
            ("every", 1.2, 2.0),
            ("Friday.", 2.0, 2.8),
            ("Really.", 2.9, 3.2),  # 0.3s — far under the minimum
        )
    )
    assert len(out) == 1
    assert out[0].text.endswith("Really.")


def test_beats_are_monotonic_and_never_overlap():
    out = segment_words(
        words(*[(f"w{i}", i * 0.7, i * 0.7 + 0.7) for i in range(40)])
    )
    for a, b in zip(out, out[1:]):
        assert a.end <= b.start
        assert a.index + 1 == b.index


def test_bad_provider_timestamps_are_repaired_not_raised():
    """One bad timestamp must not fail a render whose VO is already paid."""
    normalized = normalize_words(
        [
            {"word": "a", "start": 1.0, "end": 2.0},
            {"word": "b", "start": -5.0, "end": 0.5},  # travels backwards
            {"word": "", "start": 3.0, "end": 4.0},  # blank token
            {"word": "c", "start": "oops", "end": 5.0},  # unparseable
            {"text": "d", "start": 6.0, "end": 5.0},  # end before start
        ]
    )
    assert [w.text for w in normalized] == ["a", "b", "d"]
    assert all(w.end >= w.start for w in normalized)
    for prev, nxt in zip(normalized, normalized[1:]):
        assert nxt.start >= prev.end


def test_the_beat_cap_bounds_spend_on_a_long_narration():
    out = segment_words(
        words(*[(f"word{i}.", i * 2.5, i * 2.5 + 2.5) for i in range(60)]),
        max_beats=6,
    )
    assert len(out) == 6
    assert [b.index for b in out] == list(range(6))
    # Nothing is dropped: the merge is lossless in time.
    assert out[0].start == 0.0
    assert out[-1].end == 150.0


def test_enforce_beat_cap_merges_the_shortest_neighbours_first():
    raw = [
        Beat(index=0, start=0.0, end=8.0, text="long one"),
        Beat(index=1, start=8.0, end=9.0, text="short"),
        Beat(index=2, start=9.0, end=10.0, text="short too"),
        Beat(index=3, start=10.0, end=18.0, text="long two"),
    ]
    out = enforce_beat_cap(raw, max_beats=3)
    assert [b.text for b in out] == ["long one", "short short too", "long two"]


def test_enforce_beat_cap_is_deterministic():
    raw = [Beat(index=i, start=i * 2.0, end=i * 2.0 + 2.0, text=f"b{i}") for i in range(9)]
    assert enforce_beat_cap(raw, max_beats=4) == enforce_beat_cap(raw, max_beats=4)


def test_narration_fallback_splits_on_sentences_and_fills_the_duration():
    out = beats_from_narration(
        "First we grind. Then we brew it slowly. Finally we pour.", 12.0
    )
    assert len(out) == 3
    assert out[0].start == 0.0
    assert out[-1].end == 12.0
    for a, b in zip(out, out[1:]):
        assert a.end == b.start


def test_narration_fallback_refuses_impossible_input():
    assert beats_from_narration("", 10.0) == []
    assert beats_from_narration("Something.", 0.0) == []


def test_a_leading_runt_merges_forward():
    """Regression: a short opening sentence used to keep its own
    quarter-second visual because runts could only merge backwards."""
    out = beats_from_narration("Hi. " + "A long sentence about coffee beans. " * 3, 20.0)
    assert all(b.duration >= MIN_BEAT_SEC for b in out)
    assert out[0].text.startswith("Hi.")


def test_total_duration_is_the_last_beat_end():
    out = beats_from_narration("One. Two. Three.", 9.0)
    assert total_duration(out) == 9.0
