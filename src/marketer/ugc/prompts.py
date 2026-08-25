"""`@imageN` reference handling and UGC prompt assembly.

The studio's multi-reference workflow (ported from the source's upload
panel + prompt hint) lets a script address individual uploads inline:

    "@image1 holds up @image2 and says: this fixed my morning routine"

`@image1` is the first entry of `images_list`, `@image2` the second, and
so on — 1-based, in upload order. The tokens are passed through to the
provider verbatim (MUAPI's multi-reference models parse them), so our job
is validation, not rewriting: a script that references `@image3` when only
two images were attached would render *something* — the model quietly
ignores the dangling token — and the user would pay full price for an ad
missing the product they asked for. We reject it up front instead.

Dual mode is decided the same way the source decides it: reference images
present => image-to-video, none => text-to-video (and then the prompt is
mandatory, since there is nothing else to render from).
"""
from __future__ import annotations

import re

# Greedy `\d+` so `@image12` is reference 12, not reference 1 followed by
# a stray "2"; `@images` (no digits) is not a reference at all.
_REF_RE = re.compile(r"@image(\d+)")

TEXT_TO_VIDEO = "text_to_video"
IMAGE_TO_VIDEO = "image_to_video"

# Appended to the user's script so a bare line of dialogue still renders
# as a UGC ad rather than a generic clip. Kept short and non-prescriptive
# about the subject: the reference images (or the script itself) supply
# who and what; this only supplies the *format*.
UGC_DIRECTIVE = (
    "Single continuous take, vertical handheld selfie framing, natural lighting, "
    "authentic user-generated-content delivery, speaking directly to camera."
)

MAX_PROMPT_CHARS = 4000


class UgcPromptError(ValueError):
    """A malformed script or an unsatisfiable `@imageN` reference."""


def parse_image_refs(prompt: str) -> list[int]:
    """Every `@imageN` index in the prompt, in order of appearance.

    Duplicates are preserved — the same image may legitimately be
    referenced in several beats of one script.
    """
    return [int(m.group(1)) for m in _REF_RE.finditer(prompt or "")]


def validate_image_refs(prompt: str, image_count: int) -> list[int]:
    """Raise unless every `@imageN` in `prompt` addresses an attached image."""
    refs = parse_image_refs(prompt)
    if not refs:
        return refs
    if image_count <= 0:
        raise UgcPromptError(
            "script references @image1-style uploads but no reference images were attached"
        )
    bad = sorted({n for n in refs if n < 1 or n > image_count})
    if bad:
        listed = ", ".join(f"@image{n}" for n in bad)
        raise UgcPromptError(
            f"script references {listed} but only {image_count} reference "
            f"image(s) were attached (references are 1-based, in upload order)"
        )
    return refs


def render_mode_for(image_count: int) -> str:
    """image-to-video when references were attached, else text-to-video."""
    return IMAGE_TO_VIDEO if image_count > 0 else TEXT_TO_VIDEO


def assemble_prompt(
    script: str,
    *,
    image_count: int,
    add_directive: bool = True,
) -> str:
    """Validate a script and return the prompt to send to the provider.

    Whitespace is collapsed (a textarea full of stray newlines otherwise
    eats prompt budget), `@imageN` references are checked against the
    attached image count, and the UGC framing directive is appended unless
    the caller opts out.

    An empty script is fine in image-to-video mode — animating a product
    shot with no direction is a legitimate render — but is refused in
    text-to-video mode, where the script is the only input there is.
    """
    text = re.sub(r"[ \t]+", " ", (script or "").strip())
    text = re.sub(r"\n{3,}", "\n\n", text)

    if not text and image_count <= 0:
        raise UgcPromptError("a script is required when no reference images are attached")
    if len(text) > MAX_PROMPT_CHARS:
        raise UgcPromptError(
            f"script is {len(text)} characters, over the {MAX_PROMPT_CHARS}-character limit"
        )

    validate_image_refs(text, image_count)

    if not add_directive:
        return text
    return f"{text}\n\n{UGC_DIRECTIVE}" if text else UGC_DIRECTIVE
