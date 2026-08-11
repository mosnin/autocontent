"""Curated visual-style presets.

Each preset is a production-tested art direction: a `visual_style` prompt
the image/animation models act on verbatim, an optional starter cast, and
an optional reference video (a real render in that style) so users can
*see* the style before committing a niche to it.

`reference_video_url` is a plain URL — point it at a Wasabi presigned/
public object, a CDN, or leave None until a demo has been rendered. The
registry is code (not DB) on purpose: presets are product content that
ships and versions with the app.
"""
from __future__ import annotations

from pydantic import BaseModel


class StylePreset(BaseModel):
    id: str
    name: str
    tagline: str
    visual_style: str
    character_suggestion: str = ""
    # A rendered example of the style, when available.
    reference_video_url: str | None = None
    # UI swatch (CSS gradient) so the picker looks designed with no assets.
    swatch: str = "linear-gradient(135deg, #444, #999)"


PRESETS: list[StylePreset] = [
    StylePreset(
        id="claymation",
        name="Claymation",
        tagline="Tactile, warm, irresistibly stop-motion",
        visual_style=(
            "soft 3D claymation, visible fingerprints and clay texture, warm "
            "3-point lighting, pastel palette, shallow depth of field, "
            "stop-motion feel"
        ),
        character_suggestion=(
            "a wide-eyed clay mascot with oversized hands and a tiny prop "
            "matched to the niche"
        ),
        swatch="linear-gradient(135deg, #e8b08a, #c96f4a)",
    ),
    StylePreset(
        id="isometric-infographic",
        name="Isometric infographic",
        tagline="Clean data-forward explainers",
        visual_style=(
            "isometric 3D infographic, flat pastel colors with soft shadows, "
            "floating labeled elements, clean studio background, minimal, "
            "high contrast focal object"
        ),
        swatch="linear-gradient(135deg, #7fb4e8, #4a6fc9)",
    ),
    StylePreset(
        id="cinematic-photo",
        name="Cinematic photo",
        tagline="Filmic realism, anamorphic mood",
        visual_style=(
            "cinematic photography, anamorphic lens, dramatic golden-hour "
            "light, film grain, teal-orange grade, shallow depth of field"
        ),
        swatch="linear-gradient(135deg, #e8c97f, #2e4a5f)",
    ),
    StylePreset(
        id="papercraft",
        name="Papercraft",
        tagline="Layered cut-paper diorama",
        visual_style=(
            "layered papercraft diorama, cut-paper edges with subtle drop "
            "shadows, bold flat colors, handcrafted texture, top-down key "
            "light"
        ),
        character_suggestion="a folded-paper character with visible crease lines",
        swatch="linear-gradient(135deg, #f0e6c8, #d98a7a)",
    ),
    StylePreset(
        id="retro-anime",
        name="Retro anime",
        tagline="90s cel-shaded nostalgia",
        visual_style=(
            "90s retro anime, cel shading, halation glow, film grain, muted "
            "VHS palette, dramatic speed lines on motion beats"
        ),
        character_suggestion=(
            "a determined protagonist with an expressive face and a signature "
            "jacket"
        ),
        swatch="linear-gradient(135deg, #d97fa8, #5f4a8a)",
    ),
    StylePreset(
        id="chalkboard",
        name="Chalkboard sketch",
        tagline="Hand-drawn lecture energy",
        visual_style=(
            "white chalk line-art on a dark green chalkboard, hand-drawn "
            "diagrams and arrows, dusty texture, single accent color for "
            "emphasis"
        ),
        swatch="linear-gradient(135deg, #2f4a3e, #14231d)",
    ),
    StylePreset(
        id="vaporwave-collage",
        name="Vaporwave collage",
        tagline="Surreal internet-native aesthetics",
        visual_style=(
            "vaporwave collage, marble busts and neon grids, glitch "
            "artifacts, magenta-cyan palette, surreal composition, retro "
            "computer UI fragments"
        ),
        swatch="linear-gradient(135deg, #e87fd9, #4ae8e0)",
    ),
    StylePreset(
        id="ugc-spokesperson",
        name="UGC spokesperson",
        tagline="Authentic creator-to-camera energy",
        visual_style=(
            "authentic UGC smartphone footage, front-facing selfie camera "
            "perspective, natural indoor lighting, slight handheld sway, "
            "casual real-world background (car, kitchen, bedroom desk), "
            "no studio polish, realistic skin texture"
        ),
        character_suggestion=(
            "a relatable everyday creator in their 20s-30s, casual outfit, "
            "speaking directly to camera with natural expressions"
        ),
        swatch="linear-gradient(135deg, #e8a87f, #7f9ce8)",
    ),
    StylePreset(
        id="ugc-product-demo",
        name="UGC product demo",
        tagline="Hands-on product content that converts",
        visual_style=(
            "authentic UGC product video, handheld close-up of hands "
            "holding and using the product, natural window light, shallow "
            "phone-camera depth of field, lived-in home setting, honest "
            "unpolished aesthetic"
        ),
        character_suggestion=(
            "only hands and the product in frame — no faces; the product "
            "is the hero of every shot"
        ),
        swatch="linear-gradient(135deg, #a8e87f, #4a8f5f)",
    ),
    StylePreset(
        id="macro-product",
        name="Macro product",
        tagline="Luxurious close-up detail",
        visual_style=(
            "extreme macro product photography, glossy surfaces, water "
            "droplets, dark backdrop with rim lighting, ultra sharp focus "
            "point, luxurious mood"
        ),
        swatch="linear-gradient(135deg, #8a8f98, #1c1e22)",
    ),
]

_BY_ID = {p.id: p for p in PRESETS}


def get_preset(preset_id: str) -> StylePreset | None:
    return _BY_ID.get(preset_id)
