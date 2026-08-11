"""Assemble the final generation prompt for one headshot variant.

WHY THE RULES BLOCK IS NOT OPTIONAL
-----------------------------------
Every prompt this module emits is an instruction to redraw a real,
identifiable person from photographs they uploaded. Two obligations
follow, and both are encoded here rather than left to the caller:

1. **Identity preservation.** The subject's face must survive the
   restyling. A "headshot" that returns a different person is not a
   cosmetic failure — it is a metered charge for a picture of a stranger
   that a user may then publish as their colleague.

2. **No misleading depiction.** The output must not place the subject
   somewhere they weren't, in a role they don't hold, or beside content
   that asserts something on their behalf. The style catalog is already
   fenced to professional-portrait contexts (see `styles.py` for the
   categories deliberately dropped from the source app); these rules are
   the second fence, applied to *every* prompt regardless of style, so a
   future catalog entry cannot quietly opt out of them. In particular the
   rules ban uniforms and insignia (fabricated credentials), readable
   text and logos (fabricated endorsements), and additional people
   (fabricated associations).

`subject_notes` is free text from the user and is the one place their
words reach the model. It is bounded, stripped of newlines, and — this
is the load-bearing part — inserted *before* the rules block, never
after, so the rules are always the last instruction the model reads.
"""
from __future__ import annotations

from .styles import HeadshotStyle

MAX_SUBJECT_NOTES_CHARS = 400

# Framing/expression deltas that make a batch feel like a photo session
# rather than one image printed N times. They touch pose and crop only:
# anything that could alter identity (age, build, hair, skin) or the
# chosen art direction stays out, because variety is worth nothing if the
# twelve results aren't recognizably the same person in the same style.
VARIATION_BEATS: tuple[str, ...] = (
    "Front-facing, square to the camera, calm neutral expression.",
    "Head and shoulders turned slightly to the subject's right, eyes on the lens, "
    "faint natural smile.",
    "Three-quarter angle from the subject's left, relaxed shoulders, "
    "warm open expression.",
    "Slightly wider crop with more headroom, upright posture, composed expression.",
    "Tighter crop just below the collarbone, direct confident gaze.",
    "Chin lowered a fraction, gaze level with the lens, thoughtful expression.",
)

# Applied to every prompt, last, verbatim. Ordered most-important-first
# because models weight early lines in a block more heavily.
IDENTITY_RULES: tuple[str, ...] = (
    "Preserve the subject's identity exactly as it appears in the reference "
    "photograph(s): same face, bone structure, eye color, skin tone, apparent "
    "age, hairline and hair texture, facial hair, glasses, and any freckles, "
    "moles, or scars. This is a restyled photograph of a specific real person, "
    "not a new person inspired by them.",
    "Do not slim, reshape, lighten, darken, de-age, or otherwise 'improve' the "
    "subject's face or body. Retouching is limited to what a photographer does "
    "in-camera: lighting, focus, and framing.",
    "Exactly one person is in the frame. No second person, no hands or limbs "
    "belonging to anyone else, no reflections of other people.",
    "No text anywhere in the image: no captions, watermarks, signatures, "
    "name plates, slogans, or legible writing on clothing, props, or background.",
    "No logos, brand marks, uniforms, badges, lanyards, medical or military or "
    "academic or legal attire, or any insignia that would imply a profession, "
    "employer, rank, or credential.",
    "This is a studio-style professional portrait. Do not depict the subject at "
    "a news event, a protest, a crime scene, a celebration, or any identifiable "
    "real-world location or situation.",
    "Photorealistic photography. Not an illustration, painting, 3D render, "
    "caricature, or anime.",
)


def sanitize_subject_notes(notes: str) -> str:
    """Collapse user notes to a single bounded line.

    Newlines are the cheap way to fake a new instruction block and push
    the rules out of context, so they are collapsed rather than trimmed.
    """
    if not notes:
        return ""
    return " ".join(notes.split())[:MAX_SUBJECT_NOTES_CHARS].strip()


def variation_beat(variant_index: int) -> str:
    """The pose/framing delta for variant N, cycling the beat list."""
    return VARIATION_BEATS[variant_index % len(VARIATION_BEATS)]


def rules_block() -> str:
    return "Hard requirements:\n" + "\n".join(f"- {r}" for r in IDENTITY_RULES)


def build_variant_prompt(
    style: HeadshotStyle,
    *,
    variant_index: int = 0,
    subject_notes: str = "",
    has_reference: bool = True,
) -> str:
    """Full prompt for one variant of one batch.

    `has_reference` is False only when no source photo survived
    validation. It swaps the "restyle this photograph" framing for a
    generic-portrait framing so the identity rules don't instruct the
    model to preserve a face it was never shown — but callers should
    prefer refusing the batch, because a headshot with no subject is not
    what anyone paid for.
    """
    opening = (
        "Professional portrait photograph of the person in the supplied "
        "reference photograph(s), restyled as described below."
        if has_reference
        else "Professional portrait photograph of a single person."
    )

    parts = [
        opening,
        f"Style — {style.label}: {style.prompt_language}",
        variation_beat(variant_index),
    ]

    notes = sanitize_subject_notes(subject_notes)
    if notes:
        # Framed as a preference, not an override: the model must not read
        # "wearing a red tie" as permission to also change the face.
        parts.append(
            f"Subject preferences (apply only to wardrobe, grooming, and framing; "
            f"they never override the hard requirements below): {notes}"
        )

    parts.append(rules_block())
    return "\n\n".join(parts)
