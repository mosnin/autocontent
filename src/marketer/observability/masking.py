"""The one masking function for everything the backend exports as a span
(docs/observability/braintrust.md, rule 3).

- secret redaction: the same patterns memory uses (``repos.memory.redact_secrets``,
  the backend twin of the agent's ``memory/redact.ts``), which also replaces
  card numbers that pass a Luhn check;
- emails and phone numbers are replaced;
- attributes named like a credential (``authorization``, ``cookie``, ``token``,
  ``secret``, ``password``, ``api_key`` ...) are dropped, whatever their value;
- in ``metadata`` mode, every attribute that carries prompt or output text is
  dropped, and exception and status messages are cut to the exception type.

Recall spans (rule 5) keep only an allowlist of counts, timing and scope kind.
"""
from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from ..repos.memory import redact_secrets

REDACTED = "redacted"
METADATA = "metadata"
CONTENT_MODES: tuple[str, ...] = (REDACTED, METADATA)

MAX_VALUE_CHARS = 32_000

_EMAIL = re.compile(r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")
# Loose on purpose: a run of digits with separators, optionally +country and
# (area). Kept only when it holds 9 to 15 digits, so dates, prices, ids and
# years stay readable.
_PHONE = re.compile(r"(?<![\w+])\+?\(?\d[\d\s().-]{7,}\d(?![\w])")


def normalize_mode(value: object) -> str:
    """``redacted`` or ``metadata``. Anything unknown is ``metadata`` (fail closed)."""
    return REDACTED if str(value or "").strip().lower() == REDACTED else METADATA


def _phone(m: re.Match[str]) -> str:
    text = m.group(0)
    digits = re.sub(r"\D", "", text)
    if not 9 <= len(digits) <= 15:
        return text
    # A bare run of digits with no separator is an id or a number, not a phone.
    if text.isdigit() and not text.startswith("+"):
        return text
    # ISO dates and times: 2026-11-20, 2026-11-20 10:31.
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}[:.]\d{2})?", text.strip()):
        return text
    return "[PHONE]"


def mask_text(text: str) -> str:
    """Secrets, then emails, then phone numbers. Card numbers go with the
    secrets (Luhn-checked) before the phone pattern can see them."""
    if not text:
        return text
    out = redact_secrets(text)
    out = _EMAIL.sub("[EMAIL]", out)
    out = _PHONE.sub(_phone, out)
    if len(out) > MAX_VALUE_CHARS:
        out = out[:MAX_VALUE_CHARS] + "…[truncated]"
    return out


# ------------------------------------------------------------------ attribute names

_SECRET_WORDS = re.compile(
    r"(authorization|cookie|token|secret|password|passwd|passphrase|api[_-]?key|apikey"
    r"|private[_-]?key|credential|session[_-]?id|signature)",
    re.I,
)
# Names that contain a secret word but are counts, not credentials.
_SAFE_PREFIXES: tuple[str, ...] = (
    "gen_ai.usage.",
    "gen_ai.request.max_tokens",
    "braintrust.metrics.",
    "llm.token_count.",
    "marketer.tokens",
)


def is_secret_name(name: str) -> bool:
    n = name.lower()
    if n.startswith(_SAFE_PREFIXES):
        return False
    return bool(_SECRET_WORDS.search(n))


# Attributes that carry prompt or output text (dropped in metadata mode).
_CONTENT_PREFIXES: tuple[str, ...] = (
    "gen_ai.prompt",
    "gen_ai.completion",
    "gen_ai.input.messages",
    "gen_ai.output.messages",
    "gen_ai.system_instructions",
    "gen_ai.tool.call.arguments",
    "gen_ai.tool.call.result",
    "braintrust.input",
    "braintrust.output",
    "braintrust.expected",
    "llm.input_messages",
    "llm.output_messages",
    "llm.prompts",
    "input.value",
    "output.value",
    "marketer.content.",
)


def is_content_name(name: str) -> bool:
    return name.startswith(_CONTENT_PREFIXES)


# Span events whose attributes are message text (GenAI events).
_CONTENT_EVENTS: tuple[str, ...] = (
    "gen_ai.user.message",
    "gen_ai.system.message",
    "gen_ai.assistant.message",
    "gen_ai.tool.message",
    "gen_ai.choice",
    "gen_ai.content.prompt",
    "gen_ai.content.completion",
)


def is_content_event(name: str) -> bool:
    return name in _CONTENT_EVENTS


# ------------------------------------------------------------------ recall

# What a recall span may carry: counts, timing, scope kind, outcome. Nothing a
# person said, nothing a memory holds, no namespace.
RECALL_ALLOWED: frozenset[str] = frozenset(
    {
        "marketer.recall",
        "marketer.recall.op",
        "marketer.recall.scope",
        "marketer.recall.count",
        "marketer.recall.status",
        "marketer.recall.error",
        "marketer.recall.latency_ms",
        "http.request.method",
        "http.method",
        "http.response.status_code",
        "http.status_code",
        "tenant_id",
        "actor_id",
    }
)


# ------------------------------------------------------------------ values


def _mask_json(node: Any, depth: int = 0) -> Any:
    if depth > 32:
        return "[truncated]"
    if isinstance(node, str):
        return mask_text(node)
    if isinstance(node, list):
        return [_mask_json(v, depth + 1) for v in node]
    if isinstance(node, dict):
        return {k: _mask_json(v, depth + 1) for k, v in node.items() if not (isinstance(k, str) and is_secret_name(k))}
    return node


def _mask_string(value: str) -> str:
    """JSON stays JSON: a value that parses as an array or object is masked
    string by string (a pattern run over the raw text could eat a closing
    quote). Anything else is masked as text."""
    head = value.lstrip()[:1]
    if head in ("[", "{"):
        try:
            parsed = json.loads(value)
        except ValueError:
            parsed = None
        if isinstance(parsed, (list, dict)):
            out = json.dumps(_mask_json(parsed), ensure_ascii=False)
            if len(out) > MAX_VALUE_CHARS:
                # Too long to keep whole: masked text, clearly cut.
                return mask_text(value)
            return out
    return mask_text(value)


def mask_value(value: Any) -> Any:
    if isinstance(value, str):
        return _mask_string(value)
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return tuple(mask_value(v) for v in value)
    return mask_text(str(value))


def mask_attributes(
    attributes: Mapping[str, Any] | None,
    *,
    mode: str = REDACTED,
    recall: bool = False,
) -> dict[str, Any]:
    """A new, masked copy. Never mutates the input."""
    out: dict[str, Any] = {}
    if not attributes:
        return out
    metadata = normalize_mode(mode) == METADATA
    for name, value in attributes.items():
        if recall and name not in RECALL_ALLOWED:
            continue
        if is_secret_name(name):
            continue
        if metadata and is_content_name(name):
            continue
        out[name] = mask_value(value)
    return out


def mask_exception_attributes(attributes: Mapping[str, Any] | None, *, mode: str, recall: bool) -> dict[str, Any]:
    """An ``exception`` event: type always; message and stack masked, or cut in
    metadata mode and on recall spans (an error can echo a prompt or a memory)."""
    attrs = dict(attributes or {})
    keep_text = normalize_mode(mode) == REDACTED and not recall
    out: dict[str, Any] = {}
    if "exception.type" in attrs:
        out["exception.type"] = mask_text(str(attrs["exception.type"]))
    if keep_text:
        for k in ("exception.message", "exception.stacktrace"):
            if k in attrs:
                out[k] = mask_text(str(attrs[k]))
    if "exception.escaped" in attrs:
        out["exception.escaped"] = attrs["exception.escaped"]
    return out
