"""Motion-graphics / kinetic-typography layer.

Turns a narration (freshly synthesized, or an existing job's voiceover +
Whisper transcript) into a beat model, then drives two synchronized
layers off it:

* **b-roll** — one visual per beat, either *generated* (gpt-image-1
  keyframe + a Ken Burns move) or *stock* (keyword-driven Pexels
  footage), composited so it changes exactly on the narration's beats.
* **kinetic text** — burned-in drawtext overlays whose in/out timing is
  the beat model, clamped to the platform safe area.

Module map
----------
``beats``    pure: word timings -> bounded, timed beats.
``overlays`` pure: beats + style -> overlay specs -> ffmpeg drawtext filters.
``styles``   the motion-graphic style catalog + the cheap-proxy bake-off.
``broll``    pure: beats -> b-roll shot plan (generated or stock) + zoompan.
``stock``    I/O: batched keyword LLM call + Pexels lookup/download.
``pipeline`` orchestration; the only module here that talks to providers.

``beats`` and ``overlays`` contain **no I/O at all** — they only build
data and filter strings. That is deliberate: the parts most likely to
break (segmentation edge cases, drawtext escaping) are then testable
without ffmpeg, a network, or a database.
"""
from __future__ import annotations

from .beats import Beat, beats_from_narration, segment_words
from .broll import BrollShot, plan_broll, select_broll_beats, visual_filter
from .overlays import Canvas, OverlaySpec, build_overlays, escape_drawtext, filter_chain
from .styles import DEFAULT_STYLE_KEY, MotionStyle, catalog, get_style

# `pipeline` is deliberately NOT re-exported: it pulls in the Agents SDK,
# httpx and the DB pool, and every other module here is meant to be
# importable (and testable) without any of that.

__all__ = [
    "Beat",
    "BrollShot",
    "Canvas",
    "DEFAULT_STYLE_KEY",
    "MotionStyle",
    "OverlaySpec",
    "beats_from_narration",
    "build_overlays",
    "catalog",
    "escape_drawtext",
    "filter_chain",
    "get_style",
    "plan_broll",
    "segment_words",
    "select_broll_beats",
    "visual_filter",
]
