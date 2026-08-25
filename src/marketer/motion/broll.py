"""Beat -> b-roll shot planning. Pure and deterministic; no I/O.

Two sourcing strategies sit behind one `BrollShot` interface:

* ``generated`` — one gpt-image-1 keyframe per beat, animated by a Ken
  Burns move (`ken_burns_filter`). Full art direction, costs an image
  call per beat.
* ``stock`` — one search keyword per beat, resolved to real footage by
  `motion/stock`. Costs a share of one batched LLM call plus a fetch,
  and looks like documentary footage rather than illustration.

Both are reached through the same three-call interface, so the pipeline
never branches on strategy outside `visual_filter`:

    plan_broll(...)      -> shots, each tagged with its sourcing
    attach_keywords(...) -> stock shots get their search term
    visual_filter(shot)  -> the ffmpeg chain that turns whatever the
                            shot resolved to into a clip of its duration

The three project-level strategies differ only in how many beats stock
is allowed to claim (`DEFAULT_COVERAGE`): ``generated`` claims none,
``mixed`` punctuates an illustrated bed with footage, ``stock`` is
footage-led with generated frames filling the gaps.

Why b-roll is intermittent, not continuous
------------------------------------------
The source notebook cut b-roll over a random half of the segments, and
that instinct is right even though the mechanism was a prototype
shortcut: wall-to-wall b-roll destroys the rhythm — the viewer loses the
speaker's thread, and every cut stops meaning anything because every
moment is a cut. Intermittent b-roll punctuates. It is also the cheaper
plan, which is why even the footage-led strategy stops short of 1.0.
What we changed is the selection: `select_broll_beats` ranks beats by
how much concrete, depictable imagery they contain and takes the top
`coverage_ratio`, enforcing a minimum gap so two covered beats are never
adjacent. That is deterministic (same narration -> same cut plan, so a
failed render is reproducible) and explainable (an operator can see
*why* a beat was chosen), which `random.sample` is neither.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

from .overlays import Canvas
from .styles import MotionStyle, keyframe_prompt, stock_query

Strategy = Literal["generated", "stock", "mixed"]
Sourcing = Literal["generated", "stock"]

SOURCE_GENERATED = "generated"
SOURCE_STOCK = "stock"
SOURCE_MIXED = "mixed"
SOURCES: tuple[str, ...] = (SOURCE_GENERATED, SOURCE_STOCK, SOURCE_MIXED)

# Flat-safe camera moves (see the source project's beat-layer reference):
# uniform transforms only, so collage edges and type never warp.
CAMERA_MOVES: tuple[str, ...] = ("push_in", "static", "pull_out", "pan_right", "pan_left")

# Fraction of beats that receive b-roll under 'stock'/'mixed'.
DEFAULT_COVERAGE_RATIO = 0.5
# Per-strategy share of beats stock is allowed to claim. `generated`
# claims none; `mixed` punctuates; `stock` leads but still leaves the
# illustrated bed showing (see "Why b-roll is intermittent").
DEFAULT_COVERAGE: dict[str, float] = {
    SOURCE_GENERATED: 0.0,
    SOURCE_MIXED: 0.4,
    SOURCE_STOCK: 0.65,
}
# Minimum number of uncovered beats between two covered ones.
MIN_COVERED_GAP = 1

# Ken Burns envelope. Kept gentle: a hard zoom on an illustrated collage
# reads as a compression artifact, not as motion.
ZOOM_MAX = 1.12
DEFAULT_FPS = 30

# Words that carry no depictable image. Used to score beats — a beat that
# is nothing but these has nothing for a stock search to find.
_ABSTRACT = frozenset(
    """
    a an and are as at be been but by can could do does for from get got had has have
    he her him his how i if in into is it its just like make me more most my no not of
    on one or our out say she should so some than that the their them then there these
    they this those to too up us very was we were what when which who will with would
    you your about actually basically really thing things stuff kind sort maybe
    """.split()
)
_WORD = re.compile(r"[A-Za-z][A-Za-z'’-]+")


@dataclass
class BrollShot:
    """One beat's visual: how it is sourced, and what it needs."""

    beat_index: int
    start: float
    end: float
    sourcing: str = "generated"
    camera_move: str = "push_in"
    # generated
    prompt: str = ""
    keyframe_path: str | None = None
    # stock
    keyword: str = ""
    # The keyword after the style bias is applied — what was actually
    # searched, which is what an operator needs to see to debug a miss.
    stock_query: str = ""
    stock_url: str | None = None
    # shared
    clip_path: str | None = None
    status: str = "planned"
    error: str | None = None
    tags: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return round(max(self.end - self.start, 0.1), 3)

    def as_dict(self) -> dict:
        return {
            "beat_index": self.beat_index,
            "start": self.start,
            "end": self.end,
            "duration": self.duration,
            # Which strategy supplied this beat's picture...
            "sourcing": self.sourcing,
            "camera_move": self.camera_move,
            # ...and the exact keyword/prompt it used to do it. Both are
            # always present so the detail view can explain a fallback:
            # a shot tagged `stock_fallback:*` shows the keyword that
            # missed next to the prompt that rescued it.
            "prompt": self.prompt,
            "keyword": self.keyword,
            "stock_query": self.stock_query,
            "stock_url": self.stock_url,
            "status": self.status,
            "error": self.error,
            "tags": list(self.tags),
        }


# ---------------------------------------------------------------------------
# Coverage selection
# ---------------------------------------------------------------------------


def concrete_terms(text: str) -> list[str]:
    """The depictable words in a beat, in order, lowercased.

    Shared vocabulary: `visual_score` ranks with it, and `motion/stock`
    builds its offline fallback keyword from it, so the beat a strategy
    picks and the term it searches for come from the same notion of
    "something a camera can point at".
    """
    words = [w.lower() for w in _WORD.findall(text or "")]
    return [w for w in words if w not in _ABSTRACT and len(w) > 3]


def visual_score(text: str) -> float:
    """How depictable a beat is (higher = better b-roll candidate).

    A concrete-noun proxy: count the tokens that are neither function
    words nor vague filler, normalised by length so a long rambling beat
    doesn't beat a short vivid one, with a small bonus for having enough
    room on screen to notice the cut.
    """
    words = [w.lower() for w in _WORD.findall(text or "")]
    if not words:
        return 0.0
    concrete = concrete_terms(text)
    density = len(concrete) / len(words)
    # Distinct concrete tokens matter more than repeats of one.
    variety = min(len(set(concrete)), 6) / 6.0
    return round(density * 0.6 + variety * 0.4, 6)


def select_broll_beats(
    beats,
    *,
    coverage_ratio: float = DEFAULT_COVERAGE_RATIO,
    min_gap: int = MIN_COVERED_GAP,
) -> list[int]:
    """Beat indices that get b-roll — top-ranked, never adjacent.

    Deterministic: ranked by `visual_score` with the beat index breaking
    ties, then filtered so covered beats are at least `min_gap` apart.
    Returns a sorted list of indices.
    """
    ratio = min(max(coverage_ratio, 0.0), 1.0)
    if not beats or ratio == 0.0:
        return []
    target = max(1, round(len(beats) * ratio))

    ranked = sorted(beats, key=lambda b: (-visual_score(b.text), b.index))
    chosen: list[int] = []
    for beat in ranked:
        if len(chosen) >= target:
            break
        if all(abs(beat.index - c) > min_gap for c in chosen):
            chosen.append(beat.index)
    # A high min_gap can starve the target; that is intended — spacing
    # wins over hitting the exact ratio.
    return sorted(chosen)


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def _camera_move(index: int) -> str:
    """Rotate through the flat-safe moves so consecutive shots differ."""
    return CAMERA_MOVES[index % len(CAMERA_MOVES)]


def default_coverage_ratio(source: str) -> float:
    """Share of beats stock may claim under `source`."""
    return DEFAULT_COVERAGE.get(source, DEFAULT_COVERAGE_RATIO)


def plan_broll(
    beats,
    style: MotionStyle,
    *,
    source: str = SOURCE_GENERATED,
    aspect: str = "9:16",
    coverage_ratio: float | None = None,
) -> list[BrollShot]:
    """Beats -> one shot per beat, tagged with its sourcing strategy.

    `generated` draws every beat. `stock` and `mixed` hand the beats
    `select_broll_beats` picks to the stock strategy and draw the rest —
    every beat gets a shot either way, because a beat with no shot is a
    hole in the picture track. That is also the fallback when a stock
    lookup misses at render time: the shot keeps its generated prompt,
    so it can always be drawn instead (see `demote_to_generated`).
    """
    if source not in SOURCES:
        raise ValueError(f"unknown b-roll source {source!r}")

    ratio = default_coverage_ratio(source) if coverage_ratio is None else coverage_ratio
    covered = (
        set()
        if source == SOURCE_GENERATED
        else set(select_broll_beats(beats, coverage_ratio=ratio))
    )

    shots: list[BrollShot] = []
    for beat in beats:
        stock_beat = beat.index in covered
        shots.append(
            BrollShot(
                beat_index=beat.index,
                start=beat.start,
                end=beat.end,
                sourcing=SOURCE_STOCK if stock_beat else SOURCE_GENERATED,
                camera_move=_camera_move(beat.index),
                # Generated shots always carry a prompt, including the ones
                # that back a failed stock lookup.
                prompt=keyframe_prompt(style, beat.text, aspect=aspect),
                tags=["covered"] if stock_beat else [],
            )
        )
    return shots


def stock_shots(shots: list[BrollShot]) -> list[BrollShot]:
    """The shots the stock strategy is responsible for supplying."""
    return [s for s in shots if s.sourcing == SOURCE_STOCK]


def attach_keywords(
    shots: list[BrollShot],
    keywords: dict[int, str],
    style: MotionStyle,
) -> list[BrollShot]:
    """Give each stock shot its style-biased search query.

    A shot whose beat produced no keyword is demoted to `generated`
    rather than left with an empty query: an empty stock search returns
    an arbitrary clip, which is worse than an on-brief illustration.
    Mutates and returns `shots` (the plan is a single mutable object all
    the way through the run, so progress survives a partial failure).
    """
    for shot in stock_shots(shots):
        keyword = (keywords.get(shot.beat_index) or "").strip()
        if not keyword:
            demote_to_generated(shot, reason="no keyword")
            continue
        shot.keyword = keyword
        shot.stock_query = stock_query(style, keyword)
    return shots


def demote_to_generated(shot: BrollShot, *, reason: str = "") -> BrollShot:
    """Fall a stock shot back to its generated frame.

    Called when there is no Pexels key, no keyword, no search result, or
    the download failed. The prompt was planned up front for exactly
    this, so the demotion costs one image call and never a hole in the
    picture track.
    """
    shot.sourcing = SOURCE_GENERATED
    shot.stock_url = None
    if reason:
        shot.tags = [*shot.tags, f"stock_fallback:{reason}"]
    return shot


class ShotSupplier(Protocol):
    """What a sourcing strategy has to do: put a file on disk for a shot.

    The generated and stock strategies are interchangeable behind this —
    `motion/pipeline` picks one per shot from `shot.sourcing`, and
    everything after it (`visual_filter`, concat, overlays, mux) is
    strategy-blind.
    """

    name: str

    async def supply(self, shot: BrollShot, dest: Path) -> Path | None:
        """Produce the shot's source asset at `dest`, or None on a miss."""
        ...


def visual_filter(shot: BrollShot, canvas: Canvas, *, fps: int = DEFAULT_FPS) -> str:
    """The ffmpeg chain for whatever this shot resolved to.

    The single place the two strategies diverge downstream: a still needs
    a Ken Burns move to stop being a slide, footage needs cover-cropping
    and looping to the beat's length.
    """
    if shot.sourcing == SOURCE_STOCK:
        return stock_fit_filter(shot, canvas, fps=fps)
    return ken_burns_filter(shot, canvas, fps=fps)


# ---------------------------------------------------------------------------
# Filter strings (pure; executed by services/ffmpeg)
# ---------------------------------------------------------------------------


def ken_burns_filter(shot: BrollShot, canvas: Canvas, *, fps: int = DEFAULT_FPS) -> str:
    """Filter chain turning ONE still into a moving clip of `shot.duration`.

    zoompan works on the *input* resolution, so the still is upscaled 2x
    first: zooming a 1080-wide frame directly makes the pan step larger
    than a pixel and the result visibly judders.
    """
    w, h = canvas.width, canvas.height
    frames = max(int(round(shot.duration * fps)), 1)
    step = round((ZOOM_MAX - 1.0) / frames, 8)

    if shot.camera_move == "static":
        zoom = "1"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif shot.camera_move == "pull_out":
        zoom = f"max({ZOOM_MAX}-on*{step},1)"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif shot.camera_move == "pan_right":
        zoom = str(ZOOM_MAX)
        x, y = f"(iw-iw/zoom)*on/{frames}", "ih/2-(ih/zoom/2)"
    elif shot.camera_move == "pan_left":
        zoom = str(ZOOM_MAX)
        x, y = f"(iw-iw/zoom)*(1-on/{frames})", "ih/2-(ih/zoom/2)"
    else:  # push_in
        zoom = f"min(1+on*{step},{ZOOM_MAX})"
        x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"

    return (
        f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,"
        f"crop={w * 2}:{h * 2},"
        f"zoompan=z='{zoom}':d={frames}:x='{x}':y='{y}':s={w}x{h}:fps={fps},"
        f"setsar=1,format=yuv420p"
    )


def stock_fit_filter(shot: BrollShot, canvas: Canvas, *, fps: int = DEFAULT_FPS) -> str:
    """Filter chain fitting downloaded stock footage to the canvas.

    Cover-crop rather than pad: stock arrives in every aspect, and letter-
    boxing inside a vertical feed looks like a broken upload. `loop` +
    `trim` cover the common case of footage shorter than the beat (the
    notebook looped with moviepy; this is the same idea in one filter).
    """
    w, h = canvas.width, canvas.height
    dur = shot.duration
    return (
        f"loop=loop=-1:size=32767:start=0,"
        f"trim=duration={dur:.3f},setpts=PTS-STARTPTS,"
        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},setsar=1,fps={fps},format=yuv420p"
    )
