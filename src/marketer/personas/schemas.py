"""Persona models + the hard bounds every persona field lives inside.

Why every field is length-bounded
---------------------------------
Persona text is *interpolated into a system prompt on every chat turn*.
An unbounded field is therefore two problems at once:

* **Money.** The persona block is resent with each turn, so one 200 KB
  "backstory" would silently multiply the input-token bill of every
  message forever. Bounding the fields bounds the fixed cost of a turn.
* **Injection surface.** Persona text is untrusted (a user pastes it,
  and a teammate on a shared account may not have written it). It is
  carried into the prompt as *data* inside delimiters (see
  ``personas.prompt``); a smaller field is a smaller thing to smuggle.

The limits below are generous for real brand copy and are enforced at
the schema layer, so nothing reaches the DB or the prompt over-length,
whichever door it came through (HTTP, SDK, or a future importer).
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# ── Field bounds (characters) ──────────────────────────────────────────
MAX_NAME_CHARS = 80
MAX_TAGLINE_CHARS = 200
MAX_PERSONA_CHARS = 4_000
MAX_GREETING_CHARS = 800
MAX_VOICE_RULES_CHARS = 2_000
MAX_BANNED_TOPICS = 40
MAX_BANNED_TOPIC_CHARS = 120

# ── Conversation bounds ────────────────────────────────────────────────
# One inbound message. Long enough to paste a landing-page section for a
# rewrite, short enough that a single turn can't blow up the prompt.
MAX_MESSAGE_CHARS = 4_000
# History windowing: the newest N messages, further trimmed to a total
# character budget. See personas.prompt.window_history for why.
MAX_HISTORY_MESSAGES = 20
MAX_HISTORY_CHARS = 8_000
# Per-turn output ceiling. The chat loop is the one place in the product
# where a user can trigger LLM calls in a tight loop, so the *output*
# side is capped too, not just the input side.
MAX_REPLY_TOKENS = 800
MAX_REPLY_CHARS = 6_000


class Persona(BaseModel):
    """A persistent brand voice: who talks, how, and what they look like."""

    id: UUID
    user_id: str
    # Optional link to a niche. When set, the persona's LLM/image spend is
    # attributed to that niche and honors its daily cap; when null the
    # global daily cap and prepaid credit are the only gates.
    niche_id: UUID | None = None

    name: str = Field(max_length=MAX_NAME_CHARS)
    tagline: str = Field(default="", max_length=MAX_TAGLINE_CHARS)
    # The backstory / personality brief. Untrusted data, never instructions.
    persona: str = Field(default="", max_length=MAX_PERSONA_CHARS)
    # The opening line shown when a conversation is empty.
    greeting: str = Field(default="", max_length=MAX_GREETING_CHARS)
    # Explicit do/don't voice rules ("never say 'game changer'", "always
    # lead with the customer outcome").
    voice_rules: str = Field(default="", max_length=MAX_VOICE_RULES_CHARS)
    banned_topics: list[str] = Field(default_factory=list, max_length=MAX_BANNED_TOPICS)

    # Locked visual reference (see personas.visual). Empty until locked.
    visual_ref_path: str = ""
    visual_locked_at: datetime | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    @property
    def has_visual(self) -> bool:
        return bool(self.visual_ref_path and self.visual_locked_at)


class PersonaCreate(BaseModel):
    """Writable fields — the exact POST /personas body."""

    name: str = Field(min_length=1, max_length=MAX_NAME_CHARS)
    tagline: str = Field(default="", max_length=MAX_TAGLINE_CHARS)
    persona: str = Field(default="", max_length=MAX_PERSONA_CHARS)
    greeting: str = Field(default="", max_length=MAX_GREETING_CHARS)
    voice_rules: str = Field(default="", max_length=MAX_VOICE_RULES_CHARS)
    banned_topics: list[str] = Field(default_factory=list, max_length=MAX_BANNED_TOPICS)
    niche_id: UUID | None = None


class PersonaUpdate(BaseModel):
    """Partial update. Unset fields are left untouched (exclude_unset)."""

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_CHARS)
    tagline: str | None = Field(default=None, max_length=MAX_TAGLINE_CHARS)
    persona: str | None = Field(default=None, max_length=MAX_PERSONA_CHARS)
    greeting: str | None = Field(default=None, max_length=MAX_GREETING_CHARS)
    voice_rules: str | None = Field(default=None, max_length=MAX_VOICE_RULES_CHARS)
    banned_topics: list[str] | None = Field(default=None, max_length=MAX_BANNED_TOPICS)
    niche_id: UUID | None = None


class PersonaMessage(BaseModel):
    """One turn in a persona conversation. Personal data — cascades on
    user erasure (see migration 0034)."""

    id: UUID
    persona_id: UUID
    user_id: str
    role: str  # 'user' | 'assistant'
    content: str
    created_at: datetime | None = None


class PersonaTurn(BaseModel):
    """The result of POST /personas/{id}/messages: the user's message and
    the persona's metered reply, both already persisted."""

    user_message: PersonaMessage
    assistant_message: PersonaMessage


def clean_banned_topics(topics: list[str] | None) -> list[str]:
    """Normalize the blocklist: trim, drop blanks, bound count and length,
    de-duplicate case-insensitively (a list is a prompt line, not a set of
    near-identical restatements)."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in topics or []:
        topic = " ".join(str(raw).split())[:MAX_BANNED_TOPIC_CHARS].strip()
        if not topic:
            continue
        key = topic.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(topic)
        if len(out) >= MAX_BANNED_TOPICS:
            break
    return out
