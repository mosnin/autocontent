"""The executable operation catalog for the Design Agent.

Every operation a plan step may name lives here, and every one of them is
a thin mapping onto an EXISTING image service — nothing in this module
talks to a provider directly:

    generate      -> openai_images.generate_keyframe(reference_image_path=None)
    edit          -> openai_images.generate_keyframe(reference_image_path=<dep>)
    compose       -> openai_images.generate_remix(reference_paths=[<deps>])
    upscale       -> openai_images.generate_keyframe(<dep>, quality="high")
    text_overlay  -> openai_images.generate_keyframe(<dep>) + typography prompt

Keeping the catalog declarative (arity + quality policy as data) is what
lets ``plan.validate_plan`` reject a malformed LLM-authored plan *before*
the executor spends a cent: the validator reads the same table the
executor dispatches on, so "known operation" and "right number of
inputs" can never drift apart.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Sequence

from ..services import openai_images
from ..services.openai_pricing import image_cost
from ..services.spend_context import SpendContext

# A single step may fan out over at most this many upstream objects.
# gpt-image-1's multi-reference edit accepts more, but every extra
# reference is untrusted planner input that inflates the request; a
# hard ceiling keeps one step from becoming an unbounded batch.
MAX_STEP_INPUTS = 4

QUALITIES = ("low", "medium", "high")


@dataclass(frozen=True)
class Operation:
    """Declarative spec for one canvas operation.

    ``min_inputs``/``max_inputs`` are the number of *upstream steps* the
    operation consumes (its ``depends_on`` arity). ``forced_quality``
    pins the render tier regardless of what the planner asked for —
    an upscale that renders at "low" is not an upscale.
    """

    name: str
    min_inputs: int
    max_inputs: int
    requires_text: bool
    forced_quality: str | None
    summary: str


OPERATIONS: dict[str, Operation] = {
    "generate": Operation(
        name="generate",
        min_inputs=0,
        max_inputs=0,
        requires_text=False,
        forced_quality=None,
        summary=(
            "Create a brand-new canvas object from a prompt alone. "
            "Has no depends_on. Use it for the base plate(s) of the design."
        ),
    ),
    "edit": Operation(
        name="edit",
        min_inputs=1,
        max_inputs=1,
        requires_text=False,
        forced_quality=None,
        summary=(
            "Re-render exactly one earlier object with a change described "
            "in the prompt (recolor, restyle, swap a subject, extend). "
            "depends_on must name exactly one step."
        ),
    ),
    "compose": Operation(
        name="compose",
        min_inputs=2,
        max_inputs=MAX_STEP_INPUTS,
        requires_text=False,
        forced_quality=None,
        summary=(
            f"Combine 2-{MAX_STEP_INPUTS} earlier objects into one image "
            "(product onto a background, logo onto a poster, a grid of "
            "panels). depends_on names every object to merge."
        ),
    ),
    "upscale": Operation(
        name="upscale",
        min_inputs=1,
        max_inputs=1,
        requires_text=False,
        forced_quality="high",
        summary=(
            "Re-render one earlier object at the highest fidelity tier "
            "without changing its composition. Use it once, on the final "
            "deliverable — it is the most expensive operation."
        ),
    ),
    "text_overlay": Operation(
        name="text_overlay",
        min_inputs=1,
        max_inputs=1,
        requires_text=True,
        forced_quality=None,
        summary=(
            "Render literal typography onto one earlier object. The exact "
            "copy goes in inputs.text (headline, tagline, CTA); the prompt "
            "describes placement, weight, and treatment."
        ),
    ),
}


def catalog_lines() -> list[str]:
    """One human-readable line per operation, for the planner prompt.

    The planner is told about operations from the same table the
    validator enforces, so a hallucinated operation is a prompt bug we
    can see rather than a runtime surprise.
    """
    return [
        f"- {op.name} (depends_on: {op.min_inputs}"
        + (f"-{op.max_inputs}" if op.max_inputs != op.min_inputs else "")
        + f"): {op.summary}"
        for op in OPERATIONS.values()
    ]


def effective_quality(operation: str, requested: str) -> str:
    op = OPERATIONS.get(operation)
    if op is None:
        raise KeyError(operation)
    return op.forced_quality or requested


def step_cost_usd(operation: str, *, quality: str, size: str) -> Decimal:
    """Pre-flight USD estimate for one step, priced off the real table."""
    return image_cost(effective_quality(operation, quality), size=size)


def file_digest(path: Path) -> str:
    """sha256 of a file's bytes, truncated to 32 hex chars.

    Canvas objects are content-addressed: an object's identity is what it
    *is*, not which attempt produced it. That is what makes resume free —
    a step whose recipe and inputs are unchanged resolves to the same
    path on the volume, so a retry finds the finished file and skips the
    generation instead of re-buying it.
    """
    h = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:32]


def recipe_digest(
    *,
    operation: str,
    prompt: str,
    text: str,
    quality: str,
    size: str,
    input_digests: Sequence[str],
) -> str:
    """Deterministic address for a step's output.

    Derived from the full recipe (operation + prompt + copy + render
    tier + format + the *content* digests of every input), so two steps
    that would produce the same thing share one file and a re-run of an
    unchanged step is a no-op.
    """
    h = hashlib.sha256()
    for part in (operation, prompt, text, quality, size, *input_digests):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:32]


# --------------------------------------------------------------- execution

_UPSCALE_SUFFIX = (
    "\nRe-render this exact image at maximum fidelity and detail. Keep the "
    "composition, framing, palette, and every element identical — sharpen "
    "and refine only. Do not add, remove, or reposition anything."
)


def _text_suffix(text: str) -> str:
    return (
        f'\nRender this copy on the image, spelled EXACTLY and verbatim: "{text}". '
        "Typography must be crisp, correctly spelled, and legible at small "
        "sizes. Change nothing else about the image."
    )


async def run_operation(
    *,
    operation: str,
    prompt: str,
    text: str,
    quality: str,
    size: str,
    inputs: Sequence[Path],
    out_path: Path,
    spend: SpendContext | None = None,
) -> Path:
    """Execute one catalog operation onto ``out_path``.

    Metering is not re-implemented here: every branch below lands in
    ``openai_images``, which does ``ensure_can_spend`` before the provider
    call and ``spend.log`` after it. Adding a second ledger write here
    would double-count the image.
    """
    op = OPERATIONS.get(operation)
    if op is None:  # unreachable for a validated plan — defence in depth
        raise KeyError(f"unknown design operation: {operation!r}")
    if not (op.min_inputs <= len(inputs) <= op.max_inputs):
        raise ValueError(
            f"operation {operation!r} takes {op.min_inputs}-{op.max_inputs} "
            f"inputs, got {len(inputs)}"
        )

    q = effective_quality(operation, quality)
    full_prompt = prompt
    if operation == "upscale":
        full_prompt += _UPSCALE_SUFFIX
    elif operation == "text_overlay":
        full_prompt += _text_suffix(text)

    if operation == "compose":
        return await openai_images.generate_remix(
            full_prompt,
            out_path,
            reference_paths=list(inputs),
            quality=q,
            size=size,
            spend=spend,
        )

    return await openai_images.generate_keyframe(
        full_prompt,
        out_path,
        quality=q,
        size=size,
        reference_image_path=inputs[0] if inputs else None,
        spend=spend,
    )
