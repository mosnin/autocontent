"""Transcript word timings -> timed beats. Pure, deterministic, no I/O.

A *beat* is the atomic unit of this layer: a contiguous span of narration
that gets ONE visual and ONE kinetic-text block. Everything downstream
(b-roll shots, overlay specs, the final cut list) is derived from the
beat list, so getting the segmentation right is what makes the visuals
land on the narration instead of drifting against it.

Segmentation rules (ported from the source project's `asr_beats.py`,
adapted to the word dicts `services/openai_whisper.transcribe_word_level`
already returns):

* close a beat at a sentence end or at a speech pause >= `pause_gap`,
  but only once it has run at least `min_sec` — a two-word beat produces
  a visual that flashes by before the eye registers it;
* force-close at `max_sec` so no single visual outstays its welcome
  (the source's hard ceiling; short-form attention dies well before 10s);
* merge any runt beat left at the end into its predecessor.

Why beats are bounded
---------------------
Every beat costs money: a generated keyframe is an image-model call, a
stock beat is an LLM keyword + a footage fetch. A 3-minute narration
naively segmented is 30+ beats — a spend hazard that scales with input
length, which is user-controlled. `MAX_BEATS` caps the fan-out no matter
how long the narration is: past the cap we merge the cheapest-looking
adjacent pairs (shortest combined duration) until we fit. The result is
still beat-aligned, just coarser.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# Beat length envelope, in seconds.
MAX_BEAT_SEC = 9.5
MIN_BEAT_SEC = 2.0
# A silence at least this long reads as a deliberate pause -> a cut point.
PAUSE_GAP_SEC = 0.35
SENTENCE_END = (".", "!", "?", "…", "。", "！", "？")

# Hard ceiling on beats per project. See "Why beats are bounded" above.
MAX_BEATS = 16
# Floor so a merge pass can never collapse a project to a single visual.
MIN_BEATS = 1

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")
_WS = re.compile(r"\s+")


@dataclass(frozen=True)
class Beat:
    """One narration span that owns one visual + one text block."""

    index: int
    start: float
    end: float
    text: str

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 3)

    def as_dict(self) -> dict:
        return {
            "index": self.index,
            "start": self.start,
            "end": self.end,
            "duration": self.duration,
            "text": self.text,
        }


@dataclass(frozen=True)
class _Word:
    text: str
    start: float
    end: float


def normalize_words(words: list[dict]) -> list[_Word]:
    """Coerce provider word dicts into a clean, monotonic timeline.

    Accepts both the house shape (``{"word", "start", "end"}`` — what
    `openai_whisper.transcribe_word_level` returns) and the source
    project's ``{"text", ...}``. Blank tokens are dropped, negative and
    out-of-order timestamps are repaired rather than raising: a single
    bad timestamp from the ASR provider must not fail a paid render.
    """
    out: list[_Word] = []
    cursor = 0.0
    for raw in words:
        token = str(raw.get("word", raw.get("text", ""))).strip()
        if not token:
            continue
        try:
            start = float(raw.get("start", cursor))
            end = float(raw.get("end", start))
        except (TypeError, ValueError):
            continue
        start = max(start, 0.0, cursor)  # never travel backwards
        end = max(end, start)
        out.append(_Word(text=token, start=start, end=end))
        cursor = end
    return out


def _flush(words: list[_Word], index: int) -> Beat:
    return Beat(
        index=index,
        start=round(words[0].start, 2),
        end=round(words[-1].end, 2),
        text=_WS.sub(" ", " ".join(w.text for w in words)).strip(),
    )


def _reindex(beats: list[Beat]) -> list[Beat]:
    return [
        Beat(index=i, start=b.start, end=b.end, text=b.text)
        for i, b in enumerate(beats)
    ]


def _merge_pair(beats: list[Beat], i: int) -> list[Beat]:
    """Fuse beats[i] and beats[i+1] into one."""
    a, b = beats[i], beats[i + 1]
    fused = Beat(index=a.index, start=a.start, end=b.end, text=f"{a.text} {b.text}".strip())
    return beats[:i] + [fused] + beats[i + 2 :]


def enforce_beat_cap(beats: list[Beat], *, max_beats: int = MAX_BEATS) -> list[Beat]:
    """Merge adjacent beats until at most `max_beats` remain.

    Greedy on the shortest combined duration: fusing the two briefest
    neighbours is the merge a viewer is least likely to notice, and it
    keeps the long, content-heavy beats intact.
    """
    if max_beats < MIN_BEATS:
        max_beats = MIN_BEATS
    working = list(beats)
    while len(working) > max_beats:
        best_i = min(
            range(len(working) - 1),
            key=lambda i: (working[i].duration + working[i + 1].duration, i),
        )
        working = _merge_pair(working, best_i)
    return _reindex(working)


def segment_words(
    words: list[dict],
    *,
    max_sec: float = MAX_BEAT_SEC,
    min_sec: float = MIN_BEAT_SEC,
    pause_gap: float = PAUSE_GAP_SEC,
    max_beats: int = MAX_BEATS,
) -> list[Beat]:
    """Word timings -> beats. Deterministic; same input, same output."""
    normalized = normalize_words(words)
    if not normalized:
        return []

    beats: list[Beat] = []
    current: list[_Word] = []
    last = len(normalized) - 1
    for i, w in enumerate(normalized):
        current.append(w)
        span = w.end - current[0].start
        is_last = i == last
        gap_next = normalized[i + 1].start - w.end if not is_last else None
        sentence_end = w.text.rstrip().endswith(SENTENCE_END)
        if is_last or span >= max_sec:
            beats.append(_flush(current, len(beats)))
            current = []
        elif span >= min_sec and (
            sentence_end or (gap_next is not None and gap_next >= pause_gap)
        ):
            beats.append(_flush(current, len(beats)))
            current = []
    if current:  # defensive: unreachable while the last word always flushes
        beats.append(_flush(current, len(beats)))

    # A trailing runt ("...and that's it.") is absorbed by its predecessor
    # rather than getting its own visual for half a second.
    merged: list[Beat] = []
    for b in beats:
        if merged and b.duration < min_sec:
            prev = merged[-1]
            merged[-1] = Beat(
                index=prev.index,
                start=prev.start,
                end=b.end,
                text=f"{prev.text} {b.text}".strip(),
            )
        else:
            merged.append(b)

    return enforce_beat_cap(_reindex(merged), max_beats=max_beats)


def beats_from_narration(
    narration: str,
    total_duration_sec: float,
    *,
    max_beats: int = MAX_BEATS,
    min_sec: float = MIN_BEAT_SEC,
) -> list[Beat]:
    """Fallback beat model when there are no word timings at all.

    Used when ASR is unavailable/degraded: split on sentences and allot
    each one a slice of the known audio duration proportional to its
    character count. Far less accurate than `segment_words`, but it still
    produces a valid, monotonic, bounded beat list so a render can finish
    instead of failing after the voiceover was already paid for.
    """
    text = _WS.sub(" ", narration or "").strip()
    if not text or total_duration_sec <= 0:
        return []
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    if not sentences:
        return []
    total_chars = sum(len(s) for s in sentences)

    beats: list[Beat] = []
    cursor = 0.0
    for i, sentence in enumerate(sentences):
        share = len(sentence) / total_chars
        end = total_duration_sec if i == len(sentences) - 1 else cursor + (
            total_duration_sec * share
        )
        beats.append(
            Beat(index=i, start=round(cursor, 2), end=round(max(end, cursor), 2), text=sentence)
        )
        cursor = end

    # Same runt-absorption rule as segment_words, so both paths hand
    # downstream stages beats with the same minimum-length guarantee.
    merged: list[Beat] = []
    for b in beats:
        if merged and b.duration < min_sec:
            prev = merged[-1]
            merged[-1] = Beat(
                index=prev.index, start=prev.start, end=b.end,
                text=f"{prev.text} {b.text}".strip(),
            )
        else:
            merged.append(b)
    return enforce_beat_cap(_reindex(merged), max_beats=max_beats)


def total_duration(beats: list[Beat]) -> float:
    """Wall-clock length of the beat timeline (0.0 when empty)."""
    return round(beats[-1].end, 3) if beats else 0.0
