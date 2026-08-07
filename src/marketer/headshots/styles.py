"""Headshot style catalog: pure data, no I/O.

Each entry is the *art direction* for one kind of professional portrait,
split into the four axes a portrait photographer actually controls —
wardrobe, lighting, background, lens — because the image model responds
to those as separate instructions far more reliably than to a single
adjective like "corporate". The split also lets the UI show a real
preview of the prompt language instead of a marketing blurb.

WHY THIS CATALOG IS SHORTER THAN THE SOURCE'S
---------------------------------------------
This feature renders **photographs of real, identifiable people** from
photographs those people uploaded. That makes the catalog a safety
surface, not just a taste surface, and it is the one place where we
deliberately diverge from the app we ported this from.

Excluded on purpose, and not to be added later:

* **Occupational costume** (the source ships `Doctor`, `Lawyer`,
  `CEO`, `CapAndGown`, `IdentificationPhoto`). Putting a real person in
  scrubs, judicial robes, or a graduation gown fabricates a credential
  they may not hold, and an ID-photo style fabricates a document. A
  founder who *is* a doctor can say so in `subject_notes`; the catalog
  will not assert it for them.
* **Dating / personal-life packs** (`Tinder`, `Bumble`, `DatingPack`,
  `TheBigWeddingDay`, `MobWife`). Out of scope for a marketing product
  and the highest-harm misuse of an uploaded face.
* **Fictional and period genres** (`Cyberpunk`, `Anime`, `DarkAcademia`,
  `90s`, `Halloween`, `GoddessOfNature`). A stylized render of a real
  colleague is a deepfake with extra steps.
* **Newsworthy or achievement scenarios** (`ChampionSportsMoment`,
  `JobSwapDaydream`, `TravelTheWorld`). These place a real person at an
  event that did not happen — the exact misleading-context failure the
  prompt rules in `prompts.py` exist to prevent.

What remains is ten variations on one honest claim: "this is what this
person looks like, photographed well, for professional use."
"""
from __future__ import annotations

from pydantic import BaseModel


class UnknownStyleError(ValueError):
    """Raised for a style key that isn't in the catalog."""


class HeadshotStyle(BaseModel):
    """One professional-portrait look.

    The four prompt axes are stored separately (rather than pre-joined)
    so `prompts.py` owns assembly order and so a future per-axis
    override — "this style, but on a white background" — doesn't need a
    string-surgery pass over a baked sentence.
    """

    key: str
    label: str
    description: str

    # --- the four prompt axes, in the order they are rendered ---
    wardrobe: str
    lighting: str
    background: str
    lens: str

    # Who should pick this, in the product's own vocabulary. Shown in the
    # picker; never sent to the model.
    best_for: str

    @property
    def prompt_language(self) -> str:
        """The style's contribution to the final prompt, verbatim.

        Exposed on `GET /styles` so the picker can show exactly what the
        model will be told — art direction the user can't read is art
        direction the user can't debug.
        """
        return " ".join(
            part.strip().rstrip(".") + "."
            for part in (self.wardrobe, self.lighting, self.background, self.lens)
        )


STYLES: tuple[HeadshotStyle, ...] = (
    HeadshotStyle(
        key="corporate_classic",
        label="Corporate Classic",
        description=(
            "The default business headshot: neutral, warm, and unambiguous. "
            "Reads correctly at 48px on a team page and at full size on a "
            "conference badge."
        ),
        wardrobe=(
            "wearing a well-fitted plain business shirt or a simple blazer in a "
            "neutral color, no logos, no busy patterns"
        ),
        lighting=(
            "soft key light slightly above eye level with a gentle fill, a "
            "flattering catchlight in both eyes, no harsh shadows under the chin"
        ),
        background=(
            "a smooth mid-grey studio background with a subtle vertical gradient, "
            "cleanly separated from the subject"
        ),
        lens=(
            "shot on an 85mm portrait lens at f/4, head-and-shoulders crop, "
            "subject facing the camera, eyes on the lens"
        ),
        best_for="Team pages, LinkedIn, press kits, email signatures",
    ),
    HeadshotStyle(
        key="executive_portrait",
        label="Executive Portrait",
        description=(
            "Darker, more deliberate, slightly more contrast. The portrait you "
            "use when the caption underneath is a quote."
        ),
        wardrobe=(
            "wearing a dark tailored suit jacket over a crisp shirt, understated, "
            "no visible branding"
        ),
        lighting=(
            "directional key light with controlled falloff and a soft rim light "
            "separating the shoulders, deep but open shadows"
        ),
        background=(
            "a deep charcoal seamless backdrop falling off to near-black at the edges"
        ),
        lens=(
            "shot on a 105mm lens at f/2.8, chest-up crop, body angled slightly "
            "away from the camera with the face turned back to it"
        ),
        best_for="Founder quotes, investor decks, executive bios, bylines",
    ),
    HeadshotStyle(
        key="editorial_founder",
        label="Editorial Founder",
        description=(
            "Magazine-profile framing: environmental, a little air around the "
            "subject, room for a headline to sit beside them."
        ),
        wardrobe=(
            "wearing smart-casual clothing — a knit, an unstructured jacket, or a "
            "plain shirt with the collar open — relaxed but intentional"
        ),
        lighting=(
            "large soft window light from one side, natural falloff across the "
            "frame, warm and unfussy"
        ),
        background=(
            "a softly defocused modern interior with architectural lines and "
            "generous negative space to one side of the subject"
        ),
        lens=(
            "shot on a 50mm lens at f/2, waist-up crop, subject off-center, "
            "relaxed posture, candid but composed expression"
        ),
        best_for="About pages, long-form article headers, podcast artwork",
    ),
    HeadshotStyle(
        key="studio_backdrop",
        label="Studio Backdrop",
        description=(
            "High-key seamless white. The most reusable output in the catalog: "
            "it composites onto anything and cuts out cleanly."
        ),
        wardrobe=(
            "wearing simple solid-colored clothing with clean edges against a "
            "bright background, no white-on-white"
        ),
        lighting=(
            "even high-key studio lighting from a large softbox with a reflector "
            "fill, bright and shadowless on the face"
        ),
        background=(
            "a pure seamless white studio backdrop, evenly lit, no visible seam "
            "or floor line"
        ),
        lens=(
            "shot on an 85mm lens at f/5.6, centered head-and-shoulders crop, "
            "square-on to the camera"
        ),
        best_for="Cutouts, slide overlays, ad creative, press releases",
    ),
    HeadshotStyle(
        key="outdoor_natural_light",
        label="Outdoor Natural Light",
        description=(
            "Golden-hour exteriors. Warmer and more approachable than studio "
            "work without drifting into vacation-photo territory."
        ),
        wardrobe=(
            "wearing everyday professional outerwear appropriate to a mild day, "
            "plain and uncluttered"
        ),
        lighting=(
            "late-afternoon golden-hour sunlight backlighting the subject with a "
            "soft bounce on the face, warm highlights in the hair"
        ),
        background=(
            "an outdoor urban or park setting rendered as soft bokeh, no legible "
            "signage or recognizable landmarks"
        ),
        lens=(
            "shot on a 135mm lens at f/2, chest-up crop, subject looking just off "
            "camera, natural relaxed smile"
        ),
        best_for="Consultants, coaches, community-facing brands, newsletters",
    ),
    HeadshotStyle(
        key="modern_office",
        label="Modern Office",
        description=(
            "In the workplace, but not busy with it. The environment reads as "
            "context rather than as a subject in its own right."
        ),
        wardrobe=(
            "wearing normal office-appropriate clothing, layered, no lanyards or "
            "badges"
        ),
        lighting=(
            "mixed daylight from a large window with soft overhead ambience, "
            "clean neutral white balance"
        ),
        background=(
            "a bright contemporary office interior thrown well out of focus — "
            "glass, plants, pale wood — with no readable screens or whiteboards"
        ),
        lens=(
            "shot on a 35mm lens at f/2.8, waist-up environmental crop, subject "
            "standing and turned three-quarters to the camera"
        ),
        best_for="Careers pages, team directories, culture posts",
    ),
    HeadshotStyle(
        key="creative_studio",
        label="Creative Studio",
        description=(
            "Colored gel lighting on a clean set. Distinctive enough to carry a "
            "brand palette, controlled enough to stay a headshot."
        ),
        wardrobe=(
            "wearing plain modern clothing in a solid neutral tone that lets the "
            "colored light do the work"
        ),
        lighting=(
            "a soft neutral key on the face with a single colored gel rim light "
            "from behind, saturated but never blowing out skin tones"
        ),
        background=(
            "a smooth colored studio backdrop with a gentle pool of light behind "
            "the subject's head"
        ),
        lens=(
            "shot on an 85mm lens at f/2.8, tight head-and-shoulders crop, "
            "direct confident gaze"
        ),
        best_for="Design and creative teams, brand-forward landing pages",
    ),
    HeadshotStyle(
        key="conference_stage",
        label="Conference Stage",
        description=(
            "Speaker portrait lit like a stage but shot like a headshot — no "
            "audience, no event branding, no implied appearance."
        ),
        wardrobe=(
            "wearing what a speaker wears — a plain shirt or a simple jacket, "
            "no event lanyard, no sponsor branding"
        ),
        lighting=(
            "warm theatrical key light from the front-left with a cool contrasting "
            "backlight, dramatic but even on the face"
        ),
        background=(
            "a dark out-of-focus auditorium wash with soft bokeh lights, "
            "no readable text, signage, logos, or crowd"
        ),
        lens=(
            "shot on a 135mm lens at f/2, chest-up crop, mid-gesture expression, "
            "looking slightly off camera"
        ),
        best_for="Speaker bios, event submissions, webinar promos",
    ),
    HeadshotStyle(
        key="monochrome_classic",
        label="Monochrome Classic",
        description=(
            "Black and white, high tonal range. Ages well and unifies a team "
            "page whose members were photographed in different decades."
        ),
        wardrobe=(
            "wearing simple clothing with clear tonal separation from the "
            "background, texture over pattern"
        ),
        lighting=(
            "classic sculpted portrait lighting with a defined key and a soft "
            "shadow side, rich midtones, detail held in both highlights and shadows"
        ),
        background=(
            "a plain mid-tone grey backdrop rendered in monochrome"
        ),
        lens=(
            "shot on an 85mm lens at f/2.8 in black and white, head-and-shoulders "
            "crop, calm direct expression"
        ),
        best_for="Mixed-vintage team pages, mastheads, print bios",
    ),
    HeadshotStyle(
        key="spokesperson_clean",
        label="Spokesperson (Clean Plate)",
        description=(
            "Front-facing, evenly lit, neutral background — built to be a "
            "reference frame. This is the style to pick when the portrait is "
            "going to become a recurring on-camera presence across formats."
        ),
        wardrobe=(
            "wearing plain solid clothing with a simple neckline, nothing that "
            "changes shape between frames"
        ),
        lighting=(
            "flat, even, shadow-minimal frontal lighting so the face reads the "
            "same from any later crop"
        ),
        background=(
            "a plain neutral light-grey background, completely uniform, "
            "no gradient and no props"
        ),
        lens=(
            "shot on an 85mm lens at f/5.6, centered head-and-shoulders crop, "
            "square-on to the camera, neutral relaxed expression, mouth closed"
        ),
        best_for=(
            "Minting a consistent AI presenter for UGC and micro-drama, and "
            "for reference sheets"
        ),
    ),
)

STYLE_KEYS: tuple[str, ...] = tuple(s.key for s in STYLES)

_BY_KEY: dict[str, HeadshotStyle] = {s.key: s for s in STYLES}


def get_style(key: str) -> HeadshotStyle:
    """Look up one style. Raises `UnknownStyleError` for anything else —
    an unrecognized key must never silently degrade into a generic
    portrait the user did not ask for and would still be charged for."""
    try:
        return _BY_KEY[key]
    except KeyError:
        raise UnknownStyleError(
            f"unknown headshot style {key!r}; known: {', '.join(STYLE_KEYS)}"
        ) from None


def list_styles() -> list[dict]:
    """Catalog as plain dicts for `GET /api/v1/headshots/styles`."""
    return [
        {
            "key": s.key,
            "label": s.label,
            "description": s.description,
            "best_for": s.best_for,
            "wardrobe": s.wardrobe,
            "lighting": s.lighting,
            "background": s.background,
            "lens": s.lens,
            "prompt_preview": s.prompt_language,
        }
        for s in STYLES
    ]
