"""Retrieve-then-judge + compact state — TypeSafe's accuracy ceiling.

Jev has no world knowledge beyond the state we send. The TypeSafe
jaggedness note is blunt: pad the state and accuracy falls; ground it
in a weak source and Jev returns a well-calibrated judgment about *bad*
material. So the harness fetches precisely, then judges cheaply.

This module:

- trims ``ask()`` state to the fields a question needs (faster + more
  accurate than dumping a 24k transcript)
- extracts checkable claims (numbers, studies, "research shows")
- turns citation-verifier notes into a QA penalty so unsourced copy
  rewrites instead of publishing
"""
from __future__ import annotations

import json
import re
from typing import Any

from .primitives import State

MAX_STATE_CHARS = 4000
MAX_FIELD_CHARS = 1200
_CLAIM_RE = re.compile(
    r"(\d[\d,.]*%|\$\d[\d,.]*|\b\d{3,}\b|according to|study shows|"
    r"research shows|scientists|published in)",
    re.IGNORECASE,
)


def compact_state(state: State, *, max_chars: int = MAX_STATE_CHARS) -> State:
    """Send Jev only what the question needs. Identity for small states."""
    if isinstance(state, str):
        return state if len(state) <= max_chars else state[:max_chars]
    if not isinstance(state, dict):
        return state
    out: dict[str, Any] = {}
    for key, value in state.items():
        if isinstance(value, str) and len(value) > MAX_FIELD_CHARS:
            out[key] = value[:MAX_FIELD_CHARS]
        elif isinstance(value, list) and len(value) > 8:
            out[key] = value[:8]
        else:
            out[key] = value
    raw = json.dumps(out, default=str)
    if len(raw) <= max_chars:
        return out
    # Second pass: keep shortest fields first so ids/flags survive.
    items = sorted(out.items(), key=lambda kv: len(json.dumps(kv[1], default=str)))
    trimmed: dict[str, Any] = {}
    for key, value in items:
        candidate = {**trimmed, key: value}
        if len(json.dumps(candidate, default=str)) > max_chars:
            continue
        trimmed[key] = value
    return trimmed or out


def extract_claim_sentences(text: str, *, limit: int = 6) -> list[str]:
    """Sentences that assert a specific fact Jev can check against sources."""
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text)
    out: list[str] = []
    for part in parts:
        sentence = part.strip()
        if len(sentence) < 12:
            continue
        if _CLAIM_RE.search(sentence):
            out.append(sentence[:400])
        if len(out) >= limit:
            break
    return out


def audit_penalty(notes: list[str], *, per_note: float = 0.08, cap: float = 0.35) -> float:
    """Drop overall quality when citation-verifier flags contradictions."""
    if not notes:
        return 0.0
    return min(cap, per_note * len(notes))


_FACT_TOKEN_RE = re.compile(
    r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$\d[\d,.]*|\d+(?:\.\d+)?%|"
    r"\b(?:19|20)\d{2}\b)",
    re.IGNORECASE,
)
_STUDYISH_RE = re.compile(
    r"according to|study shows|research shows|scientists|published in",
    re.IGNORECASE,
)


def research_text(research: Any) -> str:
    """Flatten SERP titles + highlights + excerpts for fact locking."""
    if research is None:
        return ""
    parts: list[str] = []
    results = getattr(research, "topResults", None) or []
    for row in results:
        for attr in ("title", "domain", "url"):
            value = getattr(row, attr, "") or ""
            if value:
                parts.append(str(value))
        highlights = getattr(row, "highlights", None) or []
        parts.extend(str(h) for h in highlights if str(h).strip())
        excerpt = getattr(row, "excerpt", "") or ""
        if excerpt:
            parts.append(str(excerpt))
    return "\n".join(parts)


def fact_tokens(text: str) -> set[str]:
    """Checkable number / year / money / percent tokens."""
    return {m.group(0).lower() for m in _FACT_TOKEN_RE.finditer(text or "")}


def allowed_facts(research: Any) -> set[str]:
    """Numbers the writer is allowed to repeat. Empty → invent nothing."""
    return fact_tokens(research_text(research))


def is_ungrounded_claim(sentence: str, allowed: set[str]) -> bool:
    """True when a claim sentence introduces a fact the sources do not have."""
    tokens = fact_tokens(sentence)
    if tokens:
        return any(token not in allowed for token in tokens)
    return bool(_STUDYISH_RE.search(sentence or ""))


def strip_ungrounded_claims(
    text: str, allowed: set[str], *, limit: int = 20
) -> tuple[str, list[str]]:
    """Drop invented-stat sentences in milliseconds. No LLM rewrite required."""
    claims = extract_claim_sentences(text, limit=limit)
    removed: list[str] = []
    out = text or ""
    for sentence in claims:
        if not is_ungrounded_claim(sentence, allowed):
            continue
        removed.append(sentence)
        out = out.replace(sentence, "")
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    notes = [f"stripped unsourced claim: {s[:120]}" for s in removed]
    return out, notes


def research_grounding_block(research: Any) -> str:
    """Compact source excerpts + the fact lock the writer may use."""
    if research is None:
        return (
            "No sourced numbers. Do not invent studies, percentages, "
            "dollar figures, quotes, or citation years."
        )
    results = getattr(research, "topResults", None) or []
    lines: list[str] = []
    for row in results[:4]:
        title = getattr(row, "title", "") or ""
        domain = getattr(row, "domain", "") or ""
        highlights = getattr(row, "highlights", None) or []
        blob = " ".join(str(h) for h in highlights) if highlights else ""
        if not blob:
            continue
        label = domain or title or "source"
        lines.append(f"- {label}: {blob[:400]}")
    facts = sorted(allowed_facts(research))
    lock = (
        "Allowed facts (repeat these numbers/years only; otherwise write "
        "qualitatively): " + ", ".join(facts[:16])
        if facts
        else "No sourced numbers. Do not invent percentages, dollar figures, or study years."
    )
    if not lines:
        return lock
    return (
        "Grounding sources (use ONLY these for specific facts, numbers, "
        "or citations. If a fact is not here, write qualitatively — "
        "do not invent studies, percentages, or quotes):\n"
        + "\n".join(lines)
        + "\n"
        + lock
    )
