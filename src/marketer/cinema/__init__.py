"""Cinematography catalogs and the structured prompt composer.

Pure data + pure functions: no I/O, no DB, no network anywhere in this
package. That is what makes it safe for the pipeline to import at module
scope and trivial to test without fixtures.

Two halves:

* the **catalogs** (`lenses`, `film_stocks`, `grades`) and the named
  `presets` built from them — a first-class camera vocabulary that
  composes into image and video prompts;
* the **composer** — subject/action/setting/lighting/camera/style
  segments assembled into a deterministic final prompt with negatives.

Per-user *saved* selections are the stateful half and live in
`marketer.repos.cinema_presets`.
"""
from __future__ import annotations

from .composer import (
    BASE_NEGATIVES,
    SEGMENT_ORDER,
    ComposedPrompt,
    PromptSegments,
    compose,
    visual_style_suffix,
)
from .film_stocks import CAPTURE_FORMATS, CaptureFormat
from .grades import COLOR_GRADES, DIFFUSION_FILTERS, LIGHTING_SETUPS
from .lenses import APERTURES, FOCAL_LENGTHS, LENSES
from .presets import (
    PRESET_KEYS,
    PRESETS,
    CinemaOverrides,
    CinemaPreset,
    CinemaSelection,
    ResolvedCinema,
    UnknownCinemaKey,
    get_preset,
    preview,
    resolve,
)

__all__ = [
    "APERTURES",
    "BASE_NEGATIVES",
    "CAPTURE_FORMATS",
    "COLOR_GRADES",
    "DIFFUSION_FILTERS",
    "FOCAL_LENGTHS",
    "LENSES",
    "LIGHTING_SETUPS",
    "PRESETS",
    "PRESET_KEYS",
    "SEGMENT_ORDER",
    "CaptureFormat",
    "CinemaOverrides",
    "CinemaPreset",
    "CinemaSelection",
    "ComposedPrompt",
    "PromptSegments",
    "ResolvedCinema",
    "UnknownCinemaKey",
    "compose",
    "get_preset",
    "preview",
    "resolve",
    "visual_style_suffix",
]
