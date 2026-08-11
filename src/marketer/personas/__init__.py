"""Brand personas: a reusable, conversable voice asset.

A **brand kit** (``repos.brand_kit``) is the account's *identity card* —
name, tagline, tone, banned words, hashtags, accent color. It is a flat
set of constraints every generator reads.

A **brand persona** is the *speaker* built on top of that card: a named
character with a backstory, a greeting, explicit do/don't voice rules, a
topic blocklist, and a locked visual reference sheet. It is not a second
brand kit — it never restates the kit's fields; it layers on top of them
(``prompt.build_system_prompt`` renders the kit first, then the persona)
so a user has exactly one place to change the brand's tone and one place
per persona to change *who is talking*.

Two things make the persona earn its place in a marketing product:

1. It is **conversable**. Marketers draft and refine copy by talking to
   the persona, in voice, instead of hand-tuning prompts. That chat is
   the interface, not the product.
2. It is **consumable**. The persona's system prompt and its locked
   visual reference are a voice/consistency source the rest of the
   pipeline can pull from, the same way niches pull their character
   sheet today.
"""
from __future__ import annotations

from .schemas import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_CHARS,
    MAX_REPLY_CHARS,
    MAX_REPLY_TOKENS,
    Persona,
    PersonaCreate,
    PersonaMessage,
    PersonaTurn,
    PersonaUpdate,
)

__all__ = [
    "MAX_HISTORY_CHARS",
    "MAX_HISTORY_MESSAGES",
    "MAX_MESSAGE_CHARS",
    "MAX_REPLY_CHARS",
    "MAX_REPLY_TOKENS",
    "Persona",
    "PersonaCreate",
    "PersonaMessage",
    "PersonaTurn",
    "PersonaUpdate",
]
