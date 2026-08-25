"""Cinematography presets + the structured prompt composer.

- GET    /api/v1/cinema/presets        — named preset catalog + prompt preview
- GET    /api/v1/cinema/catalog        — raw component catalogs (build a custom combo)
- POST   /api/v1/cinema/compose        — segments -> final prompt (pure, no spend)
- GET    /api/v1/cinema/saved          — the caller's saved selections
- POST   /api/v1/cinema/saved          — save/overwrite a named selection
- DELETE /api/v1/cinema/saved/{id}     — delete one

The catalog and compose endpoints are pure functions over in-process
data: no LLM call, no provider call, no DB, nothing metered. They still
go through the normal auth dependency so the whole API has one story
about who may call it, and so a UI needs exactly one fetch wrapper.

`UnknownCinemaKey` (a bad lens/grade/preset key) is a 422, not a 500 —
it is a client-supplied value that failed validation, and the message
names the offending key so the UI can highlight the right control.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.cinema import composer, film_stocks, grades, lenses, presets
from marketer.repos import cinema_presets as saved_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


# ------------------------------------------------------------------ schemas


class PresetOut(BaseModel):
    key: str
    label: str
    description: str
    selection: presets.CinemaSelection
    # What the keys resolve to, so the picker can show "70mm film /
    # anamorphic / teal-and-orange" without a second round trip.
    capture_format: film_stocks.CaptureFormat
    lens: lenses.Lens
    focal: lenses.FocalLength
    aperture: lenses.Aperture
    lighting: grades.LightingSetup
    diffusion: grades.DiffusionFilter
    grade: grades.ColorGrade
    # The exact prompt language this preset contributes.
    prompt_preview: str
    motion_preview: str


class CatalogOut(BaseModel):
    capture_formats: list[film_stocks.CaptureFormat]
    lenses: list[lenses.Lens]
    focal_lengths: list[lenses.FocalLength]
    apertures: list[lenses.Aperture]
    lighting: list[grades.LightingSetup]
    diffusion: list[grades.DiffusionFilter]
    grades: list[grades.ColorGrade]
    # Everything the UI needs to build a composer form without hardcoding.
    segment_order: list[str]
    base_negatives: list[str]
    defaults: presets.CinemaSelection


class ComposeRequest(BaseModel):
    subject: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    action: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    setting: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    lighting: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    camera: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    style: str = Field(default="", max_length=composer.MAX_SEGMENT_CHARS)
    negatives: list[str] = Field(default_factory=list, max_length=composer.MAX_NEGATIVES)
    preset_key: str | None = None
    # Per-field overrides on top of the preset — this is how the UI's
    # "custom combination" builder reaches the same resolver.
    overrides: presets.CinemaOverrides | None = None
    include_base_negatives: bool = True

    def segments(self) -> composer.PromptSegments:
        return composer.PromptSegments(
            subject=self.subject,
            action=self.action,
            setting=self.setting,
            lighting=self.lighting,
            camera=self.camera,
            style=self.style,
            negatives=self.negatives,
        )


class SaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=saved_repo.MAX_NAME_CHARS)
    preset_key: str | None = None
    overrides: presets.CinemaOverrides | None = None


# ------------------------------------------------------------------ helpers


def _resolved_out(preset: presets.CinemaPreset) -> PresetOut:
    r = presets.resolve(preset.key)
    return PresetOut(
        key=preset.key,
        label=preset.label,
        description=preset.description,
        selection=preset.selection,
        capture_format=r.capture_format,
        lens=r.lens,
        focal=r.focal,
        aperture=r.aperture,
        lighting=r.lighting,
        diffusion=r.diffusion,
        grade=r.grade,
        prompt_preview=r.image_language(),
        motion_preview=r.motion_language(),
    )


def _resolve_or_422(
    preset_key: str | None, overrides: presets.CinemaOverrides | None
) -> presets.ResolvedCinema:
    try:
        return presets.resolve(preset_key, overrides)
    except presets.UnknownCinemaKey as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e


# ------------------------------------------------------------------ routes


@router.get("/presets", response_model=list[PresetOut])
async def list_presets(ctx: AuthCtx = CurrentUser) -> list[PresetOut]:
    return [_resolved_out(p) for p in presets.PRESETS]


@router.get("/catalog", response_model=CatalogOut)
async def get_catalog(ctx: AuthCtx = CurrentUser) -> CatalogOut:
    return CatalogOut(
        capture_formats=film_stocks.CAPTURE_FORMATS,
        lenses=lenses.LENSES,
        focal_lengths=lenses.FOCAL_LENGTHS,
        apertures=lenses.APERTURES,
        lighting=grades.LIGHTING_SETUPS,
        diffusion=grades.DIFFUSION_FILTERS,
        grades=grades.COLOR_GRADES,
        segment_order=list(composer.SEGMENT_ORDER),
        base_negatives=list(composer.BASE_NEGATIVES),
        defaults=presets.DEFAULT_SELECTION,
    )


@router.post("/compose", response_model=composer.ComposedPrompt)
async def compose_prompt(
    body: ComposeRequest, ctx: AuthCtx = CurrentUser
) -> composer.ComposedPrompt:
    # Validate the cinema keys up front so a typo is a 422 naming the
    # key rather than a generic failure from inside the composer.
    if body.preset_key is not None or body.overrides is not None:
        _resolve_or_422(body.preset_key, body.overrides)
    return composer.compose(
        body.segments(),
        preset_key=body.preset_key,
        overrides=body.overrides,
        include_base_negatives=body.include_base_negatives,
    )


@router.get("/saved", response_model=list[saved_repo.SavedCinemaPreset])
async def list_saved(ctx: AuthCtx = CurrentUser) -> list[saved_repo.SavedCinemaPreset]:
    return await saved_repo.list_for_user(ctx.user_id)


@router.post(
    "/saved",
    response_model=saved_repo.SavedCinemaPreset,
    status_code=status.HTTP_201_CREATED,
)
async def save_selection(
    body: SaveRequest, ctx: AuthCtx = CurrentUser
) -> saved_repo.SavedCinemaPreset:
    # Resolve before persisting: a saved row must always be renderable,
    # so an unknown key is rejected here rather than blowing up later at
    # the point of generation.
    resolved = _resolve_or_422(body.preset_key, body.overrides)
    return await saved_repo.save(
        user_id=ctx.user_id,
        name=body.name,
        selection=resolved.as_selection(),
        preset_key=body.preset_key,
    )


@router.delete("/saved/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved(saved_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    if not await saved_repo.delete(saved_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
