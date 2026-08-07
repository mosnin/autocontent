"""Screenwriter stage: an idea becomes a screenplay + shot list.

This is the drama analogue of `agents/scriptwriter.py`, but the output
structure is deliberately different: a screenplay (title, logline, story
beats, sluglined shots with dialogue) rather than a hook + narration beats.
Everything is metered through `run_metered`, which is the only sanctioned
way to reach the Agents SDK in this codebase.

When the caller supplies a finished script this stage is SKIPPED entirely
(`screenplay_from_script`) — no LLM call, no spend. That path exists because
a writer who already has the scene on paper should not pay for it twice.
"""
from __future__ import annotations

import json

from agents import Agent

from ..agents.metered import run_metered
from ..config import settings
from ..models import Niche
from ..services.spend_context import SpendContext
from .schemas import (
    MAX_SHOT_SEC,
    MIN_SHOT_SEC,
    Screenplay,
    ScreenplayDraft,
    Shot,
    clamp_shot_count,
    shots_from_screenplay,
)

DRAMA_SCREENWRITER_INSTRUCTIONS = f"""You are a micro-drama screenwriter for
vertical short-form video (TikTok/Reels/Shorts). Turn the supplied idea into a
complete, filmable screenplay.

Input is JSON: {{"idea", "shot_count", "aspect", "niche", "audience",
"visual_style", "cast_hint", "brand_voice"}}.

STRUCTURE (non-negotiable):
- `title`: under 8 words, concrete, no colon-subtitle.
- `logline`: one sentence — protagonist, want, obstacle, stakes.
- `beats`: 3-5 story beats in order (setup, escalation, turn, payoff).
- `shots`: EXACTLY `shot_count` shots. Not more. Not fewer.

EACH SHOT:
- `slugline`: screenplay form, e.g. "INT. LAUNDROMAT - NIGHT".
- `action`: one or two sentences of what is physically visible. Present
  tense, concrete nouns, camera-ready.
- `character_names`: only the recurring cast members VISIBLE in this shot,
  spelled IDENTICALLY every time they appear. The same person must never be
  called "Mei" in one shot and "the woman" in another — a renamed character
  is re-cast as a different actor downstream.
- `dialogue`: at most one short spoken line (under 14 words) or "" for a
  silent shot. Dialogue is performed as voiceover, so keep it speakable.
- `duration_sec`: between {MIN_SHOT_SEC} and {MAX_SHOT_SEC}.

DRAMA CRAFT:
- Shot 0 opens mid-conflict — no establishing throat-clearing.
- Reuse a SMALL cast (1-3 people). Every new face costs the viewer
  orientation, and continuity is the point of the form.
- Escalate every shot: new information, reversal, or rising stakes.
- The final shot lands a turn — a reveal, a cost, or an unresolved threat.
- Keep locations few and repeated; drama comes from people, not tourism.
- Never describe on-screen text, captions, subtitles, or signage.
"""


def build_drama_screenwriter_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="DramaScreenwriter",
        instructions=DRAMA_SCREENWRITER_INSTRUCTIONS,
        output_type=ScreenplayDraft,
    )


def screenplay_from_script(script: str) -> tuple[Screenplay, list[Shot]]:
    """The script-supplied path: no LLM, no spend.

    The raw script becomes the screenplay body and the shot list stays empty
    — the storyboard stage derives the shots from the script text. Returning
    an empty shot list (rather than one giant shot) is what lets the
    storyboard fan the script out into `shot_count` filmable pieces.
    """
    text = script.strip()
    first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    return (
        Screenplay(
            title=first_line[:80],
            logline="",
            beats=[],
            source="script",
            script_text=text,
        ),
        [],
    )


async def write_screenplay(
    idea: str,
    *,
    niche: Niche,
    shot_count: int,
    aspect: str,
    brand_voice: str = "",
    spend: SpendContext | None = None,
) -> tuple[Screenplay, list[Shot]]:
    """Idea -> (screenplay, story-level shot list). One metered LLM call."""
    shot_count = clamp_shot_count(shot_count)
    payload = {
        "idea": idea,
        "shot_count": shot_count,
        "aspect": aspect,
        "niche": niche.title,
        "audience": niche.target_audience,
        "visual_style": niche.visual_style,
        "cast_hint": niche.character_description or "",
        "brand_voice": brand_voice,
    }
    result = await run_metered(
        build_drama_screenwriter_agent(),
        json.dumps(payload),
        spend=spend,
        sku=f"llm:{settings.agent_model}:drama_screenwriter",
    )
    draft = result.final_output_as(ScreenplayDraft)
    screenplay = Screenplay(
        title=draft.title,
        logline=draft.logline,
        beats=list(draft.beats),
        source="idea",
    )
    return screenplay, shots_from_screenplay(draft, shot_count=shot_count)
