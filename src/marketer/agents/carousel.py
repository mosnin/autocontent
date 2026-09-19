"""Carousel planner: design a cohesive still-image post or slide set.

Turns a niche topic into 1..N slides that tell one story — e.g. "how do
you use hooks in Claude Code" becomes 5 diagram slides that build on each
other. Unlike video keyframes, ON-IMAGE TEXT IS ALLOWED here (headings,
labels, short bullets): gpt-image-1 renders typography well and a
diagram carousel is exactly the place for it.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from agents import Agent

from ..config import settings


class CarouselSlide(BaseModel):
    index: int
    heading: str = Field(description="Short on-image heading (may render in the image)")
    body: str = Field(description="1-2 short on-image support lines or labels")
    visual_prompt: str = Field(
        description="Complete gpt-image-1 prompt for this slide, including "
        "the heading/body text to render and the shared aesthetic"
    )


class CarouselPlan(BaseModel):
    slides: list[CarouselSlide]
    caption: str = Field(description="The post caption (with a hook first line)")
    hashtags: list[str] = Field(default_factory=list)


CAROUSEL_INSTRUCTIONS = """You design still-image posts and carousels for
social feeds (Instagram/LinkedIn-style swipe posts).

Input JSON: {"topic", "kind": "single"|"carousel", "slide_count", "niche",
"audience", "visual_style", "brief_lines": [...]}

Rules:
- kind "single": exactly ONE slide that lands the whole idea at a glance.
- kind "carousel": slide_count slides that tell ONE story with a swipe
  arc — slide 1 is the hook (bold claim/question that earns the swipe),
  middle slides each deliver ONE concrete point/step/diagram, the last
  slide is the payoff/summary.
- ON-IMAGE TEXT IS ENCOURAGED: put the heading (and short labels for
  diagrams) INSIDE each visual_prompt, quoted verbatim, e.g.
  'bold heading text reading "3. Chain your hooks"'. Keep on-image text
  short — headings under 8 words, labels under 4.
- COHESION IS EVERYTHING: repeat the same style block (palette, layout
  grammar, typography vibe, background treatment) verbatim in every
  slide's visual_prompt so the set reads as one designed system.
- Respect visual_style and every brief_lines constraint verbatim.
- caption: hook first line, then 1-3 tight lines of value, then a swipe/
  save prompt. No hashtag spam in the caption body.
"""


def template_carousel_plan(
    *,
    topic: str,
    kind: str,
    slide_count: int,
    niche_title: str = "",
    visual_style: str = "",
) -> CarouselPlan:
    """Deterministic slides. Jev/code pick the arc; gpt-image-1 still renders."""
    subject = (topic or niche_title or "this idea").strip() or "this idea"
    style = (visual_style or "clean editorial, high contrast, bold sans-serif").strip()
    count = 1 if kind == "single" else max(2, min(10, slide_count))
    arcs = [
        (f"Stop guessing {subject}", "The part most people skip"),
        (f"Why {subject} fails", "One concrete cause"),
        (f"The {subject} fix", "Do this next"),
        (f"{subject} in 3 moves", "Screenshot this"),
        ("Do this today", f"{subject}, shipped"),
    ]
    slides: list[CarouselSlide] = []
    for i in range(count):
        heading, body = arcs[i % len(arcs)]
        if i == 0:
            heading = subject[:48] if kind == "single" else heading
        slides.append(
            CarouselSlide(
                index=i,
                heading=heading[:60],
                body=body[:80],
                visual_prompt=(
                    f"{style}. Slide layout with bold heading text reading "
                    f"\"{heading}\" and short support text reading \"{body}\". "
                    "No logos, no watermark, no extra paragraphs."
                ),
            )
        )
    return CarouselPlan(
        slides=slides,
        caption=f"{subject}. Save this for later.",
        hashtags=[w.lower() for w in subject.split() if len(w) > 3][:4],
    )


def build_carousel_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="CarouselPlanner",
        instructions=CAROUSEL_INSTRUCTIONS,
        output_type=CarouselPlan,
    )
