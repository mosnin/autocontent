"""Niche-draft agent: one sentence in, a full channel spec out.

The onboarding front door used to buy a 5–20s writer that invented a
channel spec. Code now builds a closed set of reviewable drafts from
the one-liner (and brand-kit lines, when present). Jev picks. A dark
harness returns templates[0]. The review screen still edits every field.
"""
from __future__ import annotations

import re
from typing import Literal

from agents import Agent
from pydantic import BaseModel, Field

from ..config import settings

# Voices the TTS layer supports — the model must pick one of these.
_VOICES = "alloy, echo, fable, onyx, nova, shimmer, ash, sage, coral"
_VOICE_IDS = (
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
    "ash",
    "sage",
    "coral",
)
_STOP = {
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at",
    "how", "what", "that", "this", "with", "from", "into", "your", "our",
    "about", "over", "under", "than", "then", "when", "why", "who",
    "videos", "video", "channel", "content", "make", "making", "explaining",
    "explain", "short", "form", "shortform",
}

DRAFT_INSTRUCTIONS = f"""You turn a one-sentence channel description into a
complete short-form video channel spec. Infer every field from the
description; make confident, specific choices a creator can tweak later.

Guidance:
- title: 2-4 words, the channel's name, not a sentence.
- description: one crisp sentence on what the channel publishes.
- target_audience: precisely scoped (never "everyone").
- visual_style: concrete art direction (medium, palette, mood) the image
  model can act on — e.g. "claymation, warm 3-point lighting, tactile".
- voice: choose the single best fit from: {_VOICES}.
- hashtags: 4-6 lowercase tags, no '#', relevant to the niche.
- target_duration_sec: 30-60 for most; longer only if the topic needs it.
- scene_count: 4-8. image_quality: 'medium' unless the style demands 'high'.
- video_resolution: '720p' for anything cinematic, else '480p'.
- tts_style_directions: a short delivery note matching the vibe
  (e.g. "calm and conspiratorial", "high-energy explainer").
- character_description: when the niche benefits from a recurring cast
  (mascot, host, ensemble), describe it concretely (names, species/look,
  wardrobe). Leave empty for styles without characters.
"""


class NicheDraft(BaseModel):
    """Channel spec inferred from the one-liner. Mirrors the onboarding
    wizard fields; scheduling + spend cap stay with the human."""

    title: str
    description: str
    target_audience: str
    hashtags: list[str] = Field(default_factory=list)
    visual_style: str
    voice: Literal[
        "alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "sage", "coral"
    ]
    target_duration_sec: int = Field(ge=15, le=90)
    scene_count: int = Field(ge=2, le=12)
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = Field(default=5, ge=1, le=15)
    tts_style_directions: str = ""
    character_description: str = ""


def build_niche_draft_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="NicheDraft",
        instructions=DRAFT_INSTRUCTIONS,
        output_type=NicheDraft,
    )


def parse_brand_context(brand_context: str) -> dict[str, str | list[str]]:
    """Parse ``as_prompt_context`` lines. Empty dict when nothing usable."""
    out: dict[str, str | list[str]] = {}
    for raw in (brand_context or "").splitlines():
        line = raw.strip().lstrip("- ").strip()
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().casefold()
        value = value.strip()
        if not value:
            continue
        if key == "brand":
            out["brand"] = value
        elif key == "tagline":
            out["tagline"] = value
        elif key == "tone of voice":
            out["tone"] = value
        elif key == "core audience":
            out["audience"] = value
        elif key == "never use these words":
            out["banned"] = [w.strip() for w in value.split(",") if w.strip()]
        elif key == "preferred hashtags":
            tags = [w.strip().lstrip("#").lower() for w in value.split(",") if w.strip()]
            out["hashtags"] = [t for t in tags if t]
    return out


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w]


def _content_words(text: str) -> list[str]:
    return [w for w in _words(text) if w not in _STOP and len(w) > 2]


def _title_case(words: list[str]) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in words if w)


def _scrub(text: str, banned: list[str]) -> str:
    if not banned or not text:
        return text
    out = text
    for word in banned:
        if not word:
            continue
        out = re.sub(re.escape(word), "", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip()


def _voice_for(description: str) -> str:
    blob = (description or "").casefold()
    hints = (
        (("calm", "conspiratorial", "mystery", "economics", "explain"), "onyx"),
        (("energetic", "hype", "high-energy", "fitness"), "nova"),
        (("warm", "story", "narrative", "clay", "claymation"), "fable"),
        (("news", "documentary", "serious", "policy"), "sage"),
        (("playful", "fun", "kids", "cartoon"), "shimmer"),
        (("luxury", "premium", "elegant"), "coral"),
        (("tutorial", "howto", "how"), "alloy"),
    )
    for keys, voice in hints:
        if any(k in blob for k in keys):
            return voice
    return "onyx"


def _visual_style(description: str) -> str:
    blob = (description or "").casefold()
    hints = (
        (("claymation", "clay"), "claymation, warm 3-point lighting, tactile"),
        (("stop-motion", "stopmotion"), "stop-motion, tactile, warm lighting"),
        (("whiteboard",), "whiteboard explainer, clean lines, high contrast"),
        (("3d", "cgi"), "stylized 3d, clean lighting, graphic"),
        (("animation", "animated", "cartoon"), "flat motion graphics, bold type, limited palette"),
        (("documentary", "cinematic", "film"), "documentary stills, natural light, restrained grade"),
        (("illustration", "illustrated"), "editorial illustration, limited palette, textured paper"),
        (("photo", "photography"), "editorial photography, natural light, shallow depth"),
    )
    for keys, style in hints:
        if any(k in blob for k in keys):
            return style
    return "clean editorial stills, natural light, restrained grade"


def _hashtags(description: str, brand_tags: list[str]) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for tag in list(brand_tags) + _content_words(description):
        clean = tag.strip().lstrip("#").lower()
        if not clean or clean in seen or len(clean) < 3:
            continue
        seen.add(clean)
        tags.append(clean)
        if len(tags) >= 6:
            break
    while len(tags) < 4:
        filler = ("shorts", "learn", "daily", "tips")[len(tags) % 4]
        if filler not in seen:
            seen.add(filler)
            tags.append(filler)
    return tags[:6]


def _titles(description: str, brand: str) -> list[str]:
    words = _content_words(description)
    brand_words = _content_words(brand)[:2]
    pairs = [
        words[:2] or ["Daily", "Channel"],
        words[1:3] or words[:2] or ["Topic", "Daily"],
        brand_words or words[:3] or ["Creator", "Channel"],
        (words[:1] + ["Daily"]) if words else ["Daily", "Notes"],
    ]
    titles: list[str] = []
    seen: set[str] = set()
    for parts in pairs:
        title = _title_case(parts[:4]) or "Daily Channel"
        key = title.casefold()
        if key in seen:
            title = f"{title} Lab" if "lab" not in key else f"{title} Daily"
            key = title.casefold()
        seen.add(key)
        titles.append(title)
    return titles


def template_niche_drafts(
    description: str,
    *,
    brand_context: str = "",
    limit: int = 4,
) -> list[NicheDraft]:
    """Deterministic channel specs. Jev picks; the writer does not invent."""
    kit = parse_brand_context(brand_context)
    banned = [str(w) for w in (kit.get("banned") or []) if str(w).strip()]
    text = _scrub((description or "").strip(), banned) or "short-form explainers"
    audience = str(kit.get("audience") or "")
    if not audience:
        words = _content_words(text)
        audience = (
            " ".join(words[-3:]) if len(words) >= 3 else "curious adults in this niche"
        )
        if audience == text.casefold() or len(audience) < 4:
            audience = "curious adults in this niche"
    brand_tags = [str(t) for t in (kit.get("hashtags") or [])]
    tags = _hashtags(text, brand_tags)
    voice0 = _voice_for(text)
    style = _visual_style(text)
    tone = str(kit.get("tone") or "")
    cinematic = any(k in text.casefold() for k in ("cinematic", "documentary", "film", "clay"))
    quality: Literal["low", "medium", "high"] = "high" if cinematic else "medium"
    resolution: Literal["480p", "720p"] = "720p" if cinematic else "480p"
    titles = _titles(text, str(kit.get("brand") or ""))
    voices = [voice0] + [v for v in _VOICE_IDS if v != voice0]
    one_liner = text if text.endswith(".") else f"{text}."
    wants_cast = any(
        k in text.casefold() for k in ("host", "mascot", "character", "cast", "persona")
    )
    angles = (
        ("calm explainer", 45, 5, "calm and clear"),
        ("high-energy explainer", 30, 6, "high-energy explainer"),
        ("warm storyteller", 60, 4, "warm and conversational"),
        ("tight tutorial", 40, 7, "crisp and specific"),
    )
    drafts: list[NicheDraft] = []
    for i, (_angle, duration, scenes, delivery) in enumerate(angles):
        title = titles[i % len(titles)]
        tts = _scrub(tone or delivery, banned) or delivery
        drafts.append(
            NicheDraft(
                title=_scrub(title, banned) or title,
                description=_scrub(one_liner, banned) or one_liner,
                target_audience=_scrub(audience, banned) or audience,
                hashtags=tags,
                visual_style=style,
                voice=voices[i % len(voices)],  # type: ignore[arg-type]
                target_duration_sec=duration,
                scene_count=scenes,
                image_quality=quality,
                video_resolution=resolution,
                scene_max_duration_sec=5,
                tts_style_directions=tts,
                character_description=(
                    f"A recurring host for {title}, matching {style}."
                    if wants_cast
                    else ""
                ),
            )
        )
        if len(drafts) >= max(2, limit):
            break
    return drafts


async def _pick_draft(
    description: str,
    drafts: list[NicheDraft],
    *,
    spend=None,
) -> NicheDraft:
    if len(drafts) == 1:
        return drafts[0]
    try:
        from ..jev import available as jev_available
        from ..jev.ask import ask as jev_ask
        from ..jev.client import choice

        if not (settings.jev_enabled and jev_available()):
            return drafts[0]
        labels = {
            f"d{i}": f"{d.title}: {d.visual_style}; voice={d.voice}"
            for i, d in enumerate(drafts)
        }
        result = await jev_ask(
            {
                "description": description,
                "candidates": [d.model_dump() for d in drafts],
            },
            {
                "pick": choice(
                    "Which channel spec best matches the one-sentence brief "
                    "for a reviewable onboarding draft?",
                    labels,
                )
            },
            spend=spend,
        )
        picked = result.choice("pick").choice
        if isinstance(picked, str) and picked.startswith("d") and picked[1:].isdigit():
            idx = int(picked[1:])
            if 0 <= idx < len(drafts):
                return drafts[idx]
    except Exception as exc:
        from ..repos.spend import SpendCapExceeded

        if isinstance(exc, SpendCapExceeded):
            raise
    return drafts[0]


async def draft_niche(
    description: str, *, brand_context: str = "", spend=None
) -> NicheDraft:
    """Turn a one-line channel description into a full draft spec.

    Templates + one Jev Choice. Dark harness / judge miss → templates[0].
    The writer is not invoked — invented stats on the front door are worse
    than a reviewable template the operator can edit.
    """
    drafts = template_niche_drafts(description, brand_context=brand_context)
    if not drafts:
        raise ValueError("could not draft a channel from that description")
    return await _pick_draft(description, drafts, spend=spend)
