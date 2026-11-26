"""Topic → hook + narration + search terms (one model call per variant).

Each variant gets a different hook angle so a batch is a real A/B set, not
the same video five times. The model also returns one or two stock-footage
terms per sentence; anything missing or odd falls back to the deterministic
extractor (``keywords.py``). Cost is metered by the caller (``Meter``) from
the token usage recorded here, with a GenAI span per call
(docs/observability/braintrust.md).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal

import openai

from ..config import settings
from ..observability import model_span
from ..services.openai_pricing import LLM_CALL_ESTIMATE_USD, llm_cost
from ..services.spend_context import SpendContext
from . import keywords

PROVIDER = "openai"

HOOK_ANGLES: tuple[str, ...] = (
    "open with a direct question the viewer has asked themselves",
    "open with a bold, specific claim",
    "open with a surprising number or fact",
    "open with a mistake people make",
    "open with a ten-second story",
    "open with a before/after contrast",
    "open with a myth and bust it",
    "open with 'stop scrolling if…' aimed at the audience",
    "open with the payoff first, then explain",
    "open with a quick tip people can use today",
)

_client: openai.AsyncOpenAI | None = None


def _oai() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=settings.openai_api_key, timeout=120.0, max_retries=2)
    return _client


@dataclass
class Draft:
    hook: str
    script: str
    terms: list[tuple[int, str]] = field(default_factory=list)


def angle_for(variant: int) -> str:
    return HOOK_ANGLES[(variant - 1) % len(HOOK_ANGLES)]


def build_prompt(
    *, topic: str, variant: int, duration_sec: int, language: str, tone: str,
    brand_voice: str = "", banned_words: list[str] | None = None,
) -> tuple[str, str]:
    words = int(duration_sec * 2.5)
    system = (
        "You write narration for short vertical videos (TikTok, Reels, Shorts). Plain spoken sentences, no stage "
        "directions, no emoji, no hashtags, no em-dashes. Return JSON: {\"hook\": str, \"sentences\": "
        "[{\"text\": str, \"terms\": [str, str]}]}. 'terms' are one or two short, concrete, filmable stock-footage "
        "search phrases in English for that sentence (e.g. 'city traffic', 'coffee pour')."
    )
    rules = [f"Topic: {topic}", f"About {words} words in total, language: {language}.",
             f"Hook: {angle_for(variant)}. The first sentence is the hook."]
    if tone:
        rules.append(f"Tone: {tone}")
    if brand_voice:
        rules.append(f"Brand voice: {brand_voice}")
    if banned_words:
        rules.append("Never use these words: " + ", ".join(banned_words[:40]))
    return system, "\n".join(rules)


def parse_draft(raw: str, *, topic: str) -> Draft:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        data = {}
    sentences = data.get("sentences") if isinstance(data, dict) else None
    texts: list[str] = []
    terms: list[tuple[int, str]] = []
    for i, s in enumerate(sentences or []):
        if not isinstance(s, dict):
            continue
        text = str(s.get("text") or "").strip()
        if not text:
            continue
        texts.append(text)
        for t in (s.get("terms") or [])[:2]:
            ct = keywords.clean_term(str(t))
            if ct:
                terms.append((len(texts) - 1, ct))
    script = " ".join(texts)
    if not script:
        raise ValueError("the script writer returned no sentences")
    hook = str(data.get("hook") or texts[0]).strip()[:300]
    if not terms:
        terms = keywords.search_terms(script, topic=topic)
    return Draft(hook=hook, script=script, terms=terms[:16])


async def write(
    *, topic: str, variant: int, duration_sec: int, language: str, tone: str,
    brand_voice: str, banned_words: list[str], spend: SpendContext,
) -> Draft:
    model = settings.agent_model
    await spend.ensure_can_spend(LLM_CALL_ESTIMATE_USD)
    system, user = build_prompt(
        topic=topic, variant=variant, duration_sec=duration_sec, language=language, tone=tone,
        brand_voice=brand_voice, banned_words=banned_words,
    )
    async with model_span("chat", model=model, provider=PROVIDER, tenant_id=spend.user_id,
                          attributes={"marketer.short_video.variant": variant}) as call:
        call.prompt([{"role": "system", "content": system}, {"role": "user", "content": user}])
        resp = await _oai().chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
            temperature=0.9,
        )
        u = getattr(resp, "usage", None)
        in_tok = int(getattr(u, "prompt_tokens", 0) or 0)
        out_tok = int(getattr(u, "completion_tokens", 0) or 0)
        cost = llm_cost(model, in_tok, out_tok)
        call.usage(in_tok, out_tok)
        call.cost(cost)
        raw = resp.choices[0].message.content or "{}"
        call.completion(raw)
        await spend.log(provider=PROVIDER, sku=f"llm:{model}", units=Decimal(in_tok + out_tok), cost_usd=cost)
    return parse_draft(raw, topic=topic)
