"""System One LLM wrapper — Qwen via OpenRouter answers Jev-shaped questions.

TypeSafe's own evals constrain LLMs to the System One interface when
comparing Jev to frontier models. We use the same wrapper so marketer
still makes typed, probabilistic decisions when:

- no TypeSafe key is configured, or
- Jev is overloaded / auth-fails and the caller asked for a fallback.

Qwen is the generation + fallback-decision model (OpenRouter). Output is
forced to the official System One answer schema so the rest of the
harness never branches on backend.
"""
from __future__ import annotations

import json
from typing import Any

from ..config import settings
from ..services import openrouter
from .primitives import (
    Choice,
    ChoiceAnswer,
    Noul,
    NoulAnswer,
    Questions,
    Score,
    ScoreAnswer,
    State,
    SystemOneResult,
    Usage,
    questions_payload,
)

QWEN_DECISION_MODEL = "qwen/qwen3-32b"
_qwen_client = None


class QwenDecisionError(RuntimeError):
    pass


def fallback_enabled() -> bool:
    return openrouter.enabled() and bool(settings.openai_api_key or settings.openrouter_api_key)


def _system_prompt() -> str:
    return (
        "You are a System One decision model. You do not generate prose. "
        "Given a JSON state and a map of typed questions (noul / choice / "
        "score), answer EVERY question independently against the same state. "
        "Return ONLY JSON of shape:\n"
        '{"answers": {<id>: <answer>}, "usage": {"input_tokens": 0, '
        '"output_tokens": 0}}\n'
        "Answer shapes:\n"
        '- noul: {"type":"noul","noul": <float 0-1>}\n'
        '- choice: {"type":"choice","choice": <option key>,'
        '"probabilities": {<option>: <float>}, "confidence": <0-1>}\n'
        '- score: {"type":"score","score": <float>, "legend": '
        '{<index>:<level>}, "probabilities": {<index>:<float>}, '
        '"confidence": <0-1>}\n'
        "Probabilities for a question MUST sum to 1. Confidence is high "
        "when the distribution is peaked, low when it is flat. Be honest "
        "about uncertainty. Never invent option keys or extra fields."
    )


def _normalize_noul(raw: dict[str, Any]) -> NoulAnswer:
    value = float(raw.get("noul") or 0.0)
    return NoulAnswer(noul=max(0.0, min(1.0, value)))


def _normalize_choice(raw: dict[str, Any], question: Choice) -> ChoiceAnswer:
    options = list(question.criteria.keys())
    probs_in = raw.get("probabilities") or {}
    probs: dict[str, float] = {}
    for opt in options:
        try:
            probs[opt] = max(0.0, float(probs_in.get(opt, 0.0)))
        except (TypeError, ValueError):
            probs[opt] = 0.0
    picked = raw.get("choice")
    if picked not in options:
        picked = max(probs, key=probs.get) if probs else options[0]
    total = sum(probs.values())
    if total <= 0:
        probs = {opt: (1.0 if opt == picked else 0.0) for opt in options}
    else:
        probs = {opt: p / total for opt, p in probs.items()}
    try:
        conf = float(raw.get("confidence") or max(probs.values(), default=0.0))
    except (TypeError, ValueError):
        conf = max(probs.values(), default=0.0)
    return ChoiceAnswer(
        choice=str(picked),
        probabilities=probs,
        confidence=max(0.0, min(1.0, conf)),
    )


def _normalize_score(raw: dict[str, Any], question: Score) -> ScoreAnswer:
    legend = {str(i): level for i, level in enumerate(question.criteria)}
    n = len(question.criteria)
    probs_in = raw.get("probabilities") or {}
    probs: dict[str, float] = {}
    for i in range(n):
        key = str(i)
        try:
            probs[key] = max(0.0, float(probs_in.get(key, 0.0)))
        except (TypeError, ValueError):
            probs[key] = 0.0
    total = sum(probs.values())
    if total <= 0:
        try:
            reported = float(raw.get("score") or 0.0)
        except (TypeError, ValueError):
            reported = 0.0
        idx = round(max(0.0, min(float(n - 1), reported)))
        probs = {str(i): (1.0 if i == idx else 0.0) for i in range(n)}
        score_val = float(idx)
    else:
        probs = {k: v / total for k, v in probs.items()}
        score_val = sum(int(k) * p for k, p in probs.items())
    try:
        conf = float(raw.get("confidence") or max(probs.values(), default=0.0))
    except (TypeError, ValueError):
        conf = max(probs.values(), default=0.0)
    return ScoreAnswer(
        score=score_val,
        legend=legend,
        probabilities=probs,
        confidence=max(0.0, min(1.0, conf)),
    )


def _normalize_answers(
    raw_answers: dict[str, Any], questions: Questions
) -> dict[str, NoulAnswer | ChoiceAnswer | ScoreAnswer]:
    out: dict[str, NoulAnswer | ChoiceAnswer | ScoreAnswer] = {}
    for key, question in questions.items():
        raw = raw_answers.get(key) or {}
        if not isinstance(raw, dict):
            raw = {}
        if isinstance(question, Noul):
            out[key] = _normalize_noul(raw)
        elif isinstance(question, Choice):
            out[key] = _normalize_choice(raw, question)
        else:
            out[key] = _normalize_score(raw, question)
    return out


async def system_one_qwen(
    state: State,
    questions: Questions,
    *,
    model: str | None = None,
) -> SystemOneResult:
    """Answer System One questions with Qwen (OpenRouter)."""
    if not openrouter.enabled():
        raise QwenDecisionError("MARKETER_OPENROUTER_API_KEY is not set")
    if not questions:
        raise QwenDecisionError("system_one_qwen requires at least one question")

    from openai import AsyncOpenAI

    global _qwen_client
    model_id = model or settings.jev_fallback_model or QWEN_DECISION_MODEL
    if _qwen_client is None:
        _qwen_client = AsyncOpenAI(
            base_url=openrouter.BASE_URL,
            api_key=settings.openrouter_api_key,
        )
    client = _qwen_client
    user = json.dumps(
        {"state": state, "questions": questions_payload(questions)},
        default=str,
    )
    resp = await client.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
    )
    raw_text = resp.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise QwenDecisionError("Qwen returned non-JSON System One payload") from exc
    if not isinstance(parsed, dict):
        raise QwenDecisionError("Qwen System One payload is not an object")

    usage = Usage(
        input_tokens=int(getattr(resp.usage, "prompt_tokens", 0) or 0),
        output_tokens=int(getattr(resp.usage, "completion_tokens", 0) or 0),
    )
    return SystemOneResult(
        model=model_id,
        answers=_normalize_answers(parsed.get("answers") or {}, questions),
        usage=usage,
        backend="qwen",
    )
