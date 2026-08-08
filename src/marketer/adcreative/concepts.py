"""The twelve prompt implementations behind the Creative Direction catalog.

Every builder produces the same four-part prompt: the treatment, the
brand line, the typography spec, and the HARD RULES. The typography spec
and HARD RULES are the load-bearing parts — they are what keeps a model
from spelling the headline wrong, inventing a second product, printing a
hex code, or transcribing these very instructions into the artwork. They
are ported verbatim from Branda; edit them only with rendered evidence.

Nothing in here touches the network, so a prompt can be asserted on in a
test without configuring any provider.
"""
from __future__ import annotations

from collections.abc import Callable

from .schemas import Brief, ConceptSubject


class PromptInput:
    """The flattened Brief + concept fields one prompt interpolates.

    A small explicit carrier rather than passing the Brief around: it
    documents exactly which facts are allowed to reach a prompt, and it
    is the reason `color_a`/`color_b` are phrases — a hex code has no
    field to travel in.
    """

    __slots__ = (
        "brand_name",
        "domain",
        "summary",
        "industry",
        "mood",
        "font_family",
        "color_a",
        "color_b",
        "subject",
        "headline",
        "subheadline",
    )

    def __init__(
        self,
        *,
        brand_name: str,
        domain: str,
        summary: str,
        industry: str,
        mood: str,
        font_family: str | None,
        color_a: str,
        color_b: str,
        subject: ConceptSubject,
        headline: str,
        subheadline: str,
    ) -> None:
        self.brand_name = brand_name
        self.domain = domain
        self.summary = summary
        self.industry = industry
        self.mood = mood
        self.font_family = font_family
        self.color_a = color_a
        self.color_b = color_b
        self.subject = subject
        self.headline = headline
        self.subheadline = subheadline

    @classmethod
    def from_brief(
        cls,
        brief: Brief,
        *,
        subject: ConceptSubject,
        headline: str,
        subheadline: str,
    ) -> PromptInput:
        return cls(
            brand_name=brief.brand_name,
            domain=brief.domain,
            summary=brief.summary,
            industry=brief.industry,
            mood=brief.mood,
            font_family=brief.font_family,
            color_a=brief.color_a,
            color_b=brief.color_b,
            subject=subject,
            headline=headline,
            subheadline=subheadline,
        )


def _typography(p: PromptInput, *, include_url: bool = False) -> str:
    lines = [
        # "TOP PRIORITY", not "#1 PRIORITY": prompts must stay entirely
        # hash-free so the no-hex-codes invariant is checkable as "# never
        # appears" — and models have printed literal "#1" into the art.
        "TEXT IS THE TOP PRIORITY. The typography must look like it was set by a "
        "professional designer in Figma — clean, sharp, flawless. Follow these "
        "rules exactly:",
        "• The image must contain EXACTLY these pieces of text, and absolutely "
        "nothing else — no labels, no numbering, no extra words:",
        f'   "{p.headline}" — set largest, bold (this is the headline)',
    ]
    if p.subheadline:
        lines.append(
            f'   "{p.subheadline}" — set at about 40% of the headline size, regular weight'
        )
    lines.append(f'   "{p.brand_name}" — set small (the brand name)')
    if include_url:
        lines.append(f'   "{p.domain}" — set small')
    lines.append(
        "• Spelling must be 100% correct, letter for letter. Do NOT invent, add, "
        "translate, repeat, or drop any words."
    )
    lines.append(
        f"• Use {p.font_family}, the brand's Google Font, for every text element. "
        "Preserve its authentic letterforms and use it consistently."
        if p.font_family
        else "• Use ONE clean, modern geometric sans-serif typeface (Inter / Geist / "
        "Helvetica style) for everything. Consistent, even letterforms."
    )
    lines.extend(
        [
            "• Tight professional kerning; comfortable line-height; no letter overlaps, "
            "no squished or stretched glyphs, no warping, no faux-3D.",
            "• Strong contrast: place text over the calmest part of the composition so "
            "every character is perfectly legible.",
            "• Clear hierarchy and generous breathing room. Never hyphenate or break a "
            "word across lines.",
            "• IMPORTANT: everything in this brief is an instruction to you, NOT copy to "
            "render. The ONLY text that may appear in the image is the quoted strings "
            "listed above. Never transcribe rules, notes, or any other sentence from "
            "this brief into the artwork.",
        ]
    )
    return "\n".join(lines)


HARD_RULES = "\n".join(
    [
        "HARD RULES:",
        "• Never print hex codes, color codes, or color names anywhere in the image.",
        "• No placeholder labels, lorem ipsum, hashtags, fake URLs, or gibberish "
        "micro-text of any kind.",
        "• Absolutely NO people, faces, or hands.",
        "• No watermarks, borders, or frames.",
    ]
)


def _brand_line(p: PromptInput) -> str:
    parts = [
        f"The brand: {p.brand_name} ({p.domain})"
        + (f", {p.industry}" if p.industry else "")
        + "."
    ]
    if p.summary:
        parts.append(f"What they sell: {p.summary}")
    if p.subject.kind == "product":
        parts.append(
            f'CAMPAIGN FOCUS: the specific {p.brand_name} product "{p.subject.name}". '
            f"Product facts: {p.subject.description}. Make the central visual "
            "unmistakably about this product, not a generic company-level metaphor "
            "or a different offering."
        )
    else:
        parts.append(
            f"CAMPAIGN FOCUS: {p.brand_name} as a company and its overall value, "
            "not any one specific product."
        )
    parts.append(f"Brand visual mood: {p.mood}.")
    return " ".join(parts)


def _compose(opening: str, treatment: str, p: PromptInput, *, include_url: bool = False) -> str:
    return "\n\n".join(
        [opening, _brand_line(p), treatment, _typography(p, include_url=include_url), HARD_RULES]
    )


def _product_hero(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 editorial advertisement: a single hero product shot "
        "with dramatic studio lighting.",
        "One flagship product (or an elegant stand-in object that embodies the "
        f"offering) on a seamless studio backdrop in {p.color_a}, lit with one "
        f"dramatic key light and a soft rim light in {p.color_b}. Deep, soft shadow "
        "under the object. Composition like a high-end print campaign: product "
        "slightly off-center, headline in the negative space.",
        p,
    )


def _isometric(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement in the style of a top-tier SaaS landing "
        "page: a crisp isometric 3D diagram.",
        "A clean isometric illustration of an abstract system — floating planes, "
        "nodes, and connecting pipes — that visualises the product working. Dominant "
        f"color {p.color_a} with accents of {p.color_b} on a very light neutral "
        "background. Soft ambient occlusion, precise 30-degree isometric angles, "
        "matte materials, zero clutter.",
        p,
    )


def _typographic(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 Swiss-design typographic poster. Typography IS the artwork.",
        "Massive, confident headline type filling most of the frame on a flat "
        f"{p.color_a} background, set on a strict grid with one deliberate asymmetric "
        "offset. A single thin rule line and the small wordmark and URL anchor the "
        f"corners. Ink color in {p.color_b} or the strongest opposite of the "
        "background — the type must contrast HARD against the background (never "
        "light-on-light or dark-on-dark). International Typographic Style: order, "
        "whitespace, tension.",
        p,
        include_url=True,
    )


def _macro_material(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement built on an extreme macro close-up of a "
        "beautiful material.",
        "Fill the frame with one sumptuous macro texture that evokes the brand — "
        "liquid, fabric, brushed metal, glass, or organic surface — rendered in "
        f"{p.color_a} with glints of {p.color_b}. Shallow depth of field, "
        "razor-sharp focal band, luxurious light. The texture leaves one calm, "
        "softly blurred region where the text sits.",
        p,
    )


def _gradient_field(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement made of pure atmosphere: a vast, smooth "
        "gradient field.",
        f"An expansive color field flowing from deep {p.color_a} into luminous "
        f"{p.color_b}, with subtle grain and one soft light bloom rising from the "
        "lower third — like dawn over a horizon. No objects at all. The gradient "
        "alone carries the emotion; the typography carries the message.",
        p,
    )


def _editorial_spread(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement styled like a page from a minimalist "
        "lifestyle magazine (Kinfolk / Monocle).",
        "A quiet, beautifully art-directed still-life scene on a table or shelf — "
        "objects related to the offering, natural window light, muted tones grounded "
        f"in {p.color_a} with a single accent of {p.color_b}. Lots of calm negative "
        "space. Text set like refined magazine layout: small, precise, unhurried.",
        p,
    )


def _sculptural_object(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement featuring one abstract 3D sculpture in an "
        "empty studio space.",
        "A single elegant sculptural form — a twisted ribbon, torus, or fluid glass "
        "shape — that metaphorically embodies the product, floating in a softly lit "
        f"infinite room washed in {p.color_a}. The sculpture refracts and glows with "
        f"{p.color_b}. Octane-render quality, soft global illumination, mirror-calm "
        "floor reflection.",
        p,
    )


def _data_viz(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement where an abstract data visualisation "
        "becomes the artwork.",
        "One oversized, beautiful chart form — an ascending line, layered area "
        "curves, or a radial plot — drawn as art, not UI: thick luminous strokes in "
        f"{p.color_b} over a deep {p.color_a} canvas, with faint grid ticks and glow. "
        "The curve should feel optimistic and rising. No axis labels, no numbers, no "
        "legend — pure form.",
        p,
    )


def _blueprint(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement drawn as a technical blueprint schematic.",
        "A precise engineering drawing of a machine or system that represents the "
        f"offering: fine white and {p.color_b} line work, dashed construction lines, "
        f"small circular detail callouts, on a rich {p.color_a} drafting-paper "
        "background with subtle grid. Confident, exact, drafted by hand on a light "
        "table. The callout circles stay EMPTY — no annotation text.",
        p,
    )


def _retro_arcade(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement in a late-80s arcade aesthetic — but "
        "executed with modern polish.",
        "A neon wireframe grid racing toward a glowing horizon, a low chrome sun, and "
        f"one bold geometric shape floating center — all in electric {p.color_a} and "
        f"{p.color_b} against near-black. Scanline shimmer, phosphor glow, immaculate "
        "symmetry. Nostalgic but expensive-looking.",
        p,
    )


def _monochrome_crop(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement: a tight, single-hue detail crop with "
        "extreme restraint.",
        "An ultra-tight crop of one exquisite detail — an edge, a curve, a clasp, a "
        "surface — of an object embodying the brand, rendered entirely in tones of "
        f"{p.color_a} (highlights, midtones, shadows all within that hue). One "
        f"razor-thin accent line of {p.color_b}. Dramatic chiaroscuro, vast dark "
        "negative space where the type sits.",
        p,
    )


def _collage(p: PromptInput) -> str:
    return _compose(
        "A premium square 1:1 advertisement composed as a layered cut-paper collage.",
        "Hand-cut paper shapes — arcs, torn strips, circles, and abstract forms "
        "suggesting the offering — layered with real drop shadows on a warm paper "
        f"background. Palette anchored in {p.color_a} and {p.color_b} with cream and "
        "kraft accents. Playful but rigorously composed, like a gallery poster.",
        p,
    )


PROMPT_BUILDERS: dict[str, Callable[[PromptInput], str]] = {
    "product_hero": _product_hero,
    "isometric": _isometric,
    "typographic": _typographic,
    "macro_material": _macro_material,
    "gradient_field": _gradient_field,
    "editorial_spread": _editorial_spread,
    "sculptural_object": _sculptural_object,
    "data_viz": _data_viz,
    "blueprint": _blueprint,
    "retro_arcade": _retro_arcade,
    "monochrome_crop": _monochrome_crop,
    "collage": _collage,
}


def build_concept_prompt(key: str, prompt_input: PromptInput) -> str:
    builder = PROMPT_BUILDERS.get(key)
    if builder is None:
        raise ValueError(f"no prompt implementation for Creative Direction {key!r}")
    return builder(prompt_input)


def logo_instruction(brand_name: str) -> str:
    """Appended only when a raster-logo-capable model actually got the logo."""
    return (
        f"The attached image is {brand_name}'s REAL logo mark. Where the "
        "wordmark/logo appears, reproduce this exact mark faithfully — do not "
        "redraw, restyle, or hallucinate a different logo."
    )
