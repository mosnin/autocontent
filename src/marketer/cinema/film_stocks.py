"""Capture-format catalog: film stocks and digital sensors.

Same contract as `lenses`: pure data, and every entry renders to prose.
"Super 35" and "70mm" are format specs; a model shown the spec may well
letterbox the frame and stencil "70MM" across it. What actually changes
the picture is the *texture* the format produces — grain size, latitude,
how highlights roll off — so that is what the phrase describes.

`medium` splits film from digital because the two want opposite
negatives: film renders want grain kept, digital renders want it gone
(see `grades.MEDIUM_NEGATIVES`).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Medium = Literal["film", "digital"]


class CaptureFormat(BaseModel):
    key: str
    label: str
    medium: Medium
    # Prose the model reads, e.g. "a grand-format 70mm film camera".
    phrase: str
    # The look the format imprints: this is the part that survives into
    # the render, so it is always emitted alongside `phrase`.
    texture: str


# The six capture formats the source studio ships (its CAMERA_MAP),
# recovered verbatim and annotated with the texture each one implies.
CAPTURE_FORMATS: list[CaptureFormat] = [
    CaptureFormat(
        key="grand_format_70mm_film",
        label="Grand Format 70mm Film",
        medium="film",
        phrase="a grand-format 70mm film camera",
        texture="immense tonal latitude, near-invisible grain, epic depth and scale",
    ),
    CaptureFormat(
        key="classic_16mm_film",
        label="Classic 16mm Film",
        medium="film",
        phrase="a classic 16mm film camera",
        texture="coarse visible grain, gentle gate weave, documentary intimacy",
    ),
    CaptureFormat(
        key="premium_large_format_digital",
        label="Premium Large Format Digital",
        medium="digital",
        phrase="a premium large-format digital cinema camera",
        texture="large-sensor separation, creamy falloff, flagship color science",
    ),
    CaptureFormat(
        key="full_frame_cine_digital",
        label="Full-Frame Cine Digital",
        medium="digital",
        phrase="a full-frame digital cinema camera",
        texture="clean shadows, natural skin tones, wide dynamic range",
    ),
    CaptureFormat(
        key="studio_digital_s35",
        label="Studio Digital S35",
        medium="digital",
        phrase="a Super 35 studio digital camera",
        texture="classic cinema field of view, crisp mid-contrast, broadcast-clean",
    ),
    CaptureFormat(
        key="modular_8k_digital",
        label="Modular 8K Digital",
        medium="digital",
        phrase="a modular 8K digital cinema camera",
        texture="extreme resolution, razor micro-detail, unforgiving clarity",
    ),
]

_BY_KEY = {item.key: item for item in CAPTURE_FORMATS}

DEFAULT_FORMAT_KEY = "full_frame_cine_digital"


def get_format(key: str) -> CaptureFormat | None:
    return _BY_KEY.get(key)


def formats_for_medium(medium: Medium) -> list[CaptureFormat]:
    return [item for item in CAPTURE_FORMATS if item.medium == medium]
