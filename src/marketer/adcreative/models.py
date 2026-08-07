"""The Image Model catalog, its tiers, and per-run model assignment.

Branda catalogued six models behind one AI-gateway id space. This port
keeps the shape — six models, three primary and three secondary, each
declaring whether it can take a raster logo as an input image — but
re-points the ids at the two providers this codebase actually has
adapters and keys for: OpenAI (`services/openai_images.py`) and fal
(`services/fal_video.py` is the shape reference). `renderer.py` is the
only module that knows how to call one, so swapping the catalog for a
different provider set touches this file and that seam alone.

Two invariants the rest of the studio leans on:

* **Tier is placement.** The three Company Planned Concepts take the
  three primary models; the Product Planned Concepts take secondary
  ones. Primary models are exactly the ones that accept a reference
  image, because the company ads are the ones that carry the wordmark.
* **Every model in one Ad Run is distinct.** A run is a spread across
  models by construction, not by luck — that is the whole point of
  generating six at once.

Prices are pinned per image rather than looked up, so COGS stays
priceable: an unpriced model would spend real money that never lands in
`spend_ledger`. Update the table when a vendor republishes its rates.
OpenAI models are the exception — they defer to
`services/openai_pricing.image_cost`, the single source of truth the
rest of the product already bills against.
"""
from __future__ import annotations

import random as _random
from dataclasses import dataclass
from decimal import Decimal

from .policy import AD_PRIMARY_MODEL_COUNT

ImageModelTier = str  # "primary" | "secondary"


@dataclass(frozen=True, slots=True)
class ImageModel:
    id: str
    tier: ImageModelTier
    display_name: str
    # True when the model accepts the Brand's real logo as an input image.
    # False models get the same prompt without the logo instruction.
    raster_logo: bool
    # "openai" | "fal" — selects the adapter in renderer.py.
    provider: str
    # Provider-native model identifier passed on the wire.
    api_model: str
    # fal only: the request field that carries the reference image. Empty
    # for text-to-image models.
    image_input_field: str = ""


IMAGE_MODELS: tuple[ImageModel, ...] = (
    ImageModel(
        id="openai/gpt-image-1",
        tier="primary",
        display_name="GPT Image 1",
        raster_logo=True,
        provider="openai",
        api_model="gpt-image-1",
    ),
    ImageModel(
        id="fal-ai/flux-pro/kontext",
        tier="primary",
        display_name="FLUX.1 Kontext Pro",
        raster_logo=True,
        provider="fal",
        api_model="fal-ai/flux-pro/kontext",
        image_input_field="image_url",
    ),
    ImageModel(
        id="fal-ai/bytedance/seedream/v4/edit",
        tier="primary",
        display_name="Seedream 4",
        raster_logo=True,
        provider="fal",
        api_model="fal-ai/bytedance/seedream/v4/edit",
        image_input_field="image_urls",
    ),
    ImageModel(
        id="fal-ai/imagen4/preview",
        tier="secondary",
        display_name="Imagen 4",
        raster_logo=False,
        provider="fal",
        api_model="fal-ai/imagen4/preview",
    ),
    ImageModel(
        id="fal-ai/recraft/v3/text-to-image",
        tier="secondary",
        display_name="Recraft V3",
        raster_logo=False,
        provider="fal",
        api_model="fal-ai/recraft/v3/text-to-image",
    ),
    ImageModel(
        id="fal-ai/flux/dev",
        tier="secondary",
        display_name="FLUX.1 dev",
        raster_logo=False,
        provider="fal",
        api_model="fal-ai/flux/dev",
    ),
)

IMAGE_MODEL_IDS: tuple[str, ...] = tuple(m.id for m in IMAGE_MODELS)

_BY_ID = {m.id: m for m in IMAGE_MODELS}

# Pinned USD per generated 1:1 image, by catalog id. Every non-OpenAI
# render logs this into spend_ledger; a model missing from the table
# would silently render for free, so `image_price` refuses instead.
FAL_IMAGE_USD_PER_IMAGE: dict[str, Decimal] = {
    "fal-ai/flux-pro/kontext": Decimal("0.04"),
    "fal-ai/bytedance/seedream/v4/edit": Decimal("0.03"),
    "fal-ai/imagen4/preview": Decimal("0.04"),
    "fal-ai/recraft/v3/text-to-image": Decimal("0.04"),
    "fal-ai/flux/dev": Decimal("0.025"),
}

# 1:1 is the only aspect an Ad Run renders, so the OpenAI size is fixed.
SQUARE_SIZE = "1024x1024"
SQUARE_QUALITY = "medium"


def image_model_by_id(model_id: str) -> ImageModel | None:
    return _BY_ID.get(model_id)


def image_model_name(model_id: str) -> str:
    model = _BY_ID.get(model_id)
    return model.display_name if model is not None else model_id


def image_models_by_tier(tier: ImageModelTier) -> tuple[ImageModel, ...]:
    return tuple(m for m in IMAGE_MODELS if m.tier == tier)


def image_price(model: ImageModel) -> Decimal:
    """USD for one 1:1 image from this model.

    OpenAI models defer to the product-wide pricing table; everything
    else must be present in the pinned table above.
    """
    if model.provider == "openai":
        from ..services.openai_pricing import image_cost

        return image_cost(SQUARE_QUALITY, size=SQUARE_SIZE)
    price = FAL_IMAGE_USD_PER_IMAGE.get(model.id)
    if price is None:
        raise ValueError(f"no pinned price for image model {model.id!r}")
    return price


def assign_image_models(rng: _random.Random | None = None) -> tuple[str, ...]:
    """Every Image Model once, primary placements before secondary ones.

    Shuffled within each tier so consecutive runs for the same domain do
    not always pair the same direction with the same model.
    """
    shuffler = rng or _random
    primary = list(image_models_by_tier("primary"))
    secondary = list(image_models_by_tier("secondary"))
    if len(primary) != AD_PRIMARY_MODEL_COUNT:
        raise RuntimeError(
            f"expected {AD_PRIMARY_MODEL_COUNT} primary Image Models, "
            f"found {len(primary)}"
        )
    shuffler.shuffle(primary)
    shuffler.shuffle(secondary)
    return tuple(m.id for m in [*primary, *secondary])
