"""One metered persona chat turn.

Metering
--------
A chat loop is the most open-ended spend surface in the product: unlike a
video or an article, nothing about it is rate-limited by a pipeline, and
a user can trigger a turn as fast as they can type. So this module runs
every turn through ``agents.metered.run_metered``, which is the single
sanctioned choke point — ``SpendContext.ensure_can_spend`` before the
provider is touched, ``SpendContext.log`` with the real token cost after.
No new LLM client is created here.

Spend is bounded on three axes:

* **Before the call** — the niche daily cap (when the persona is linked
  to a niche), the user's global daily cap, and prepaid credit are all
  evaluated by ``ensure_can_spend``; a tripped cap raises
  ``SpendCapExceeded`` and the provider is never called.
* **Input size** — the persona block is bounded by the schema, and the
  history is windowed by ``prompt.build_turn_input``, so the input cost
  of turn N does not grow with N.
* **Output size** — ``ModelSettings(max_tokens=MAX_REPLY_TOKENS)`` caps
  what a single turn can generate, so no one message can run away.
"""
from __future__ import annotations

import re

from agents import Agent, ModelSettings

from ..agents.metered import run_metered
from ..config import settings
from ..repos.brand_kit import BrandKit
from ..services.spend_context import SpendContext
from . import prompt as prompt_mod
from .schemas import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_CHARS,
    MAX_REPLY_CHARS,
    MAX_REPLY_TOKENS,
    Persona,
    PersonaMessage,
)

SKU_KIND = "persona-chat"

# Models sometimes ignore "no speaker label" and open with "Name:" anyway.
_LABEL = re.compile(r"^\s*[A-Za-z0-9 '._-]{1,80}\s*:\s*")


def build_persona_agent(persona: Persona, kit: BrandKit | None = None) -> Agent:
    """The Agents-SDK agent for this persona. Instructions are the fenced
    system prompt; the output ceiling is set here so it applies to every
    caller, including future non-HTTP ones."""
    return Agent(
        model=settings.agent_model,
        name="BrandPersona",
        instructions=prompt_mod.build_system_prompt(persona, kit),
        model_settings=ModelSettings(max_tokens=MAX_REPLY_TOKENS),
    )


def normalize_reply(raw: object, persona_name: str) -> str:
    """Strip a leading speaker label and hard-cap the reply length.

    The token ceiling already bounds generation; this is the character-side
    backstop so a pathological response can never be persisted unbounded
    into a table we resend as history.
    """
    text = str(raw or "").strip()
    stripped = _LABEL.sub("", text, count=1)
    # Only accept the strip when it removed *this* persona's label (or the
    # generic "User:"), so a legitimate reply starting "Monday: ..." survives.
    prefix = text[: len(text) - len(stripped)].rstrip(": ").strip().lower()
    if prefix and prefix in {persona_name.strip().lower(), "user", "assistant"}:
        text = stripped.strip()
    return text[:MAX_REPLY_CHARS]


async def generate_turn(
    *,
    persona: Persona,
    user_content: str,
    history: list[PersonaMessage] | None = None,
    kit: BrandKit | None = None,
    spend: SpendContext | None = None,
    max_history_messages: int = MAX_HISTORY_MESSAGES,
    max_history_chars: int = MAX_HISTORY_CHARS,
) -> str:
    """Produce the persona's reply to *user_content*. Metered via *spend*.

    Raises ValueError on an empty message (a blank turn would spend money
    for nothing). Cap violations propagate as ``SpendCapExceeded`` from
    the spend context — the caller maps that to 402.
    """
    content = " ".join(str(user_content or "").split())[:MAX_MESSAGE_CHARS]
    if not content:
        raise ValueError("message content is required")

    agent = build_persona_agent(persona, kit)
    turn_input = prompt_mod.build_turn_input(
        persona,
        history or [],
        content,
        max_messages=max_history_messages,
        max_chars=max_history_chars,
    )
    result = await run_metered(
        agent,
        turn_input,
        spend=spend,
        sku=f"llm:{settings.agent_model}:{SKU_KIND}",
    )
    return normalize_reply(getattr(result, "final_output", ""), persona.name)
