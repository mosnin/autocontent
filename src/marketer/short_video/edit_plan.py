"""The clip plan: which slice of which source plays when.

Adapted from MoneyPrinterTurbo's ``app/services/video.py`` (``combine_videos``
and ``_prioritize_unique_source_clips``; MIT, Copyright (c) 2024 Harry). The
rules kept from there:

- the output clip length is capped at ``clip_duration``; with a speed factor the
  SOURCE slice is ``clip_duration * speed`` long, so the source timeline stays
  continuous at any speed;
- every source is cut into consecutive slices, and the short tail is kept;
- random order plays each source's longest slice once (shuffled) before any
  source repeats; sequential order plays the first slice of each source in
  script order, then the later slices round by round;
- slices are taken until the narration plus a small safety margin is covered,
  then the plan loops what it has when footage runs short.

Pure: no I/O, a seeded ``random.Random`` for reproducible variants. The ffmpeg
side is ``render.py``.
"""
from __future__ import annotations

import itertools
import random
from dataclasses import dataclass

SAFETY_MARGIN_SEC = 0.35
IMAGE_HOLD_SEC = 4.0


@dataclass(frozen=True)
class Source:
    path: str
    duration: float  # seconds; images use IMAGE_HOLD_SEC-ish holds
    kind: str = "video"  # video | image
    segment: int = 0


@dataclass(frozen=True)
class Slice:
    path: str
    kind: str
    start: float  # in the source
    source_len: float  # seconds read from the source
    out_len: float  # seconds on screen after the speed change
    segment: int = 0
    transition: str = "none"


def _slices_of(src: Source, clip_duration: float, speed: float) -> list[Slice]:
    if src.kind == "image":
        return [Slice(src.path, "image", 0.0, clip_duration, clip_duration, src.segment)]
    step = clip_duration * speed
    out: list[Slice] = []
    t = 0.0
    while t < src.duration - 1e-6:
        end = min(t + step, src.duration)
        if end - t >= 0.5 or not out:  # drop sub-half-second crumbs unless it's all there is
            out.append(Slice(src.path, "video", round(t, 3), round(end - t, 3), round(min(clip_duration, (end - t) / speed), 3), src.segment))
        t = end
    return out


def plan(
    sources: list[Source], *, audio_duration: float, clip_duration: float = 4.0, speed: float = 1.0,
    order: str = "random", transition: str = "none", seed: int = 0,
) -> list[Slice]:
    if audio_duration <= 0:
        raise ValueError("audio duration must be positive")
    usable = [s for s in sources if s.kind == "image" or s.duration > 0]
    if not usable:
        raise ValueError("no usable footage")
    rng = random.Random(seed)
    required = audio_duration + SAFETY_MARGIN_SEC

    per_source = {i: _slices_of(s, clip_duration, speed) for i, s in enumerate(usable)}
    if order == "sequential":
        ordered_idx = sorted(per_source, key=lambda i: (usable[i].segment, i))
        candidates = [per_source[i][0] for i in ordered_idx]
        rounds = itertools.zip_longest(*(per_source[i][1:] for i in ordered_idx))
        candidates += [s for row in rounds for s in row if s is not None]
    else:
        primary, overflow = [], []
        for slices in per_source.values():
            longest = max(slices, key=lambda s: s.out_len)
            primary.append(longest)
            overflow.extend(s for s in slices if s is not longest)
        rng.shuffle(primary)
        rng.shuffle(overflow)
        candidates = primary + overflow

    chosen: list[Slice] = []
    covered = 0.0
    for s in candidates:
        if covered >= required:
            break
        chosen.append(s)
        covered += s.out_len
    base = list(chosen)
    for s in itertools.cycle(base):
        if covered >= required:
            break
        chosen.append(s)
        covered += s.out_len

    return [_with_transition(s, transition, rng) for s in chosen]


_SHUFFLE = ("fade", "fade_in", "fade_out", "none")


def _with_transition(s: Slice, transition: str, rng: random.Random) -> Slice:
    t = rng.choice(_SHUFFLE) if transition == "shuffle" else transition
    return Slice(s.path, s.kind, s.start, s.source_len, s.out_len, s.segment, t)


def total_length(slices: list[Slice]) -> float:
    return round(sum(s.out_len for s in slices), 3)
