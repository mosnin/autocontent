"""Memory: temporal facts with provenance, learnings with evidence, and an
append-only audit (see db/migrations/0029_memory.sql and docs/memory/).

The rules live here, in code, and every caller goes through them:

- **Tenant isolation.** Every function takes ``user_id`` and every query
  filters on it. There is no function that reads across users, and an id that
  belongs to another user behaves exactly like an id that does not exist.
- **Ontology.** A fact must use an entity type and predicate from the marketing
  ontology below (pinned to ``docs/memory/ontology.json``, the same file the
  agent is tested against). Anything else is rejected, never coerced.
- **Trust comes from the source.** ``person`` is trusted; ``message``, ``job``,
  ``metric`` and ``approval`` are unconfirmed; ``web``, ``document`` and
  ``tool`` are untrusted. A request body cannot set trust.
- **Supersede, never delete.** A new value in a single-valued slot invalidates
  the old row (``invalid_at``, ``invalid_reason``, ``superseded_by``). A
  lower-trust value never replaces a higher-trust one, and a rule-bearing fact
  from a non-person source never becomes current: both are stored ``pending``
  until the person decides.
- **Forget is a tombstone.** The content is wiped, the row stays invalid, and
  an audit entry records it. Retrieval never returns it again, and the same
  value is refused if a non-person source offers it later.
- **No secrets.** A fact whose value looks like a credential is rejected;
  excerpts are redacted.
- **Caps.** Per fact (name, value, excerpt, ref) and per user (active facts,
  total rows, learnings). A write past a cap is refused; nothing is evicted.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool

# ── Ontology (pinned by docs/memory/ontology.json) ───────────────────────────

ONTOLOGY_VERSION = "marketing.v1"

ENTITY_TYPES: tuple[str, ...] = (
    "brand", "audience", "offer", "product", "competitor", "channel",
    "campaign", "creative", "claim", "rule", "preference",
)

_ONE: dict[str, Any] = {"cardinality": "one"}
_MANY: dict[str, Any] = {"cardinality": "many"}

ATTRIBUTES: dict[str, dict[str, dict[str, Any]]] = {
    "brand": {"name": _ONE, "voice": _ONE, "positioning": _ONE, "tagline": _ONE,
              "mission": _ONE, "website": _ONE},
    "audience": {"description": _ONE, "pain_point": _MANY, "goal": _MANY,
                 "language": _ONE, "location": _ONE},
    "offer": {"description": _ONE, "price": _ONE, "guarantee": _ONE, "deadline": _ONE},
    "product": {"description": _ONE, "price": _ONE, "feature": _MANY, "category": _ONE},
    "competitor": {"positioning": _ONE, "price": _ONE, "strength": _MANY,
                   "weakness": _MANY, "website": _ONE},
    "channel": {"handle": _ONE, "cadence": _ONE, "best_time": _ONE, "format": _MANY},
    "campaign": {"goal": _ONE, "status": _ONE, "window": _ONE, "budget_note": _ONE},
    "creative": {"hook": _ONE, "format": _ONE, "angle": _ONE},
    "claim": {
        "text": _ONE,
        "status": {"cardinality": "one", "values": ["approved", "forbidden"], "ruleBearing": True},
        "proof": _MANY,
    },
    "rule": {
        "text": {"cardinality": "one", "ruleBearing": True},
        "scope": {"cardinality": "one", "ruleBearing": True},
    },
    "preference": {"text": _ONE},
}

RELATIONS: dict[str, dict[str, Any]] = {
    "targets": {"from": ["brand", "offer", "product", "campaign", "creative"],
                "to": ["audience"], "cardinality": "many"},
    "competes_with": {"from": ["brand", "offer", "product"], "to": ["competitor"],
                      "cardinality": "many"},
    "runs_on": {"from": ["campaign", "creative"], "to": ["channel"], "cardinality": "many"},
    "offers": {"from": ["brand"], "to": ["offer", "product"], "cardinality": "many"},
    "promotes": {"from": ["campaign", "creative"], "to": ["offer", "product"],
                 "cardinality": "many"},
    "makes": {"from": ["brand", "creative", "competitor"], "to": ["claim"],
              "cardinality": "many"},
    "forbids": {"from": ["brand", "rule"], "to": ["claim", "channel", "creative"],
                "cardinality": "many", "ruleBearing": True},
    "prefers": {"from": ["brand", "audience"], "to": ["channel", "creative", "preference"],
                "cardinality": "many"},
}


def ontology_snapshot() -> dict[str, Any]:
    return {
        "version": ONTOLOGY_VERSION,
        "entityTypes": list(ENTITY_TYPES),
        "attributes": ATTRIBUTES,
        "relations": RELATIONS,
    }


def predicate_spec(entity_type: str, predicate: str) -> dict[str, Any] | None:
    attr = ATTRIBUTES.get(entity_type, {}).get(predicate)
    if attr is not None:
        return {"kind": "attribute", **attr}
    rel = RELATIONS.get(predicate)
    if rel is not None and entity_type in rel["from"]:
        return {"kind": "relation", **rel}
    return None


# ── Limits ───────────────────────────────────────────────────────────────────

MAX_NAME = 120
MAX_VALUE = 500
MAX_EXCERPT = 300
MAX_REF = 200
MAX_ACTIVE_FACTS = 2000
MAX_TOTAL_FACTS = 20000
MAX_LEARNINGS = 500
MAX_CLAIM = 300
MAX_EVIDENCE_ITEMS = 12
MAX_EVIDENCE_LABEL = 160
MIN_SAMPLE = 5

SOURCE_KINDS = ("person", "message", "approval", "job", "metric", "tool", "document", "web")
EVIDENCE_KINDS = ("post", "article", "ad", "metric", "decision", "experiment")
LEARNING_STATUSES = ("hypothesis", "supported", "refuted")
_TRUST_RANK = {"untrusted": 0, "unconfirmed": 1, "trusted": 2}

Actor = Literal["person", "agent", "system"]


def trust_for(source_kind: str) -> str:
    if source_kind == "person":
        return "trusted"
    if source_kind in ("web", "document", "tool"):
        return "untrusted"
    return "unconfirmed"


# ── Text checks: secrets, instruction-like text, normalisation ───────────────

_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("api_key", re.compile(
        r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"
        r"|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}"
        r"|\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{35}")),
    ("credential_assignment", re.compile(
        r"\b(?:pass(?:word|wd|phrase)?|secret|api[_ -]?key|access[_ -]?key|auth[_ -]?token"
        r"|client[_ -]?secret|token)\b\s*(?:[=:]\s*\S{6,}|is\s+(?=\S*\d)\S{8,})", re.I)),
    ("authorization_header", re.compile(r"\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}", re.I)),
    ("url_credentials", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@", re.I)),
    ("long_hex_secret", re.compile(r"\b[a-f0-9]{40,}\b", re.I)),
    ("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
)
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn(digits: str) -> bool:
    if not 13 <= len(digits) <= 19:
        return False
    total, double = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if double:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        double = not double
    return total % 10 == 0


def secret_kinds(text: str) -> list[str]:
    """Kinds of credential found in ``text`` (empty when clean)."""
    if not text:
        return []
    kinds = [name for name, pattern in _SECRET_PATTERNS if pattern.search(text)]
    if any(_luhn(re.sub(r"\D", "", m.group(0))) for m in _CARD.finditer(text)):
        kinds.append("credit_card")
    return kinds


def redact_secrets(text: str) -> str:
    out = text
    for name, pattern in _SECRET_PATTERNS:
        out = pattern.sub(f"[REDACTED_{name.upper()}]", out)
    return _CARD.sub(
        lambda m: "[REDACTED_CREDIT_CARD]" if _luhn(re.sub(r"\D", "", m.group(0))) else m.group(0),
        out,
    )


_INSTRUCTION = re.compile(
    r"\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|the)\b"
    r"[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|directives?|guidelines?)"
    r"|\b(?:system|developer|admin|root)\s*(?:override|mode|prompt|message)\s*[:-]"
    r"|\b(?:reveal|print|show|output|repeat|leak)\b[^.\n]{0,40}\b(?:system prompt|hidden instructions"
    r"|your instructions|api keys?|secrets?|credentials?)"
    r"|</?(?:system|assistant|instructions?|untrusted_content)>|\[/?INST\]|<\|im_(?:start|end)\|>"
    r"|\b(?:call|invoke|execute|run)\b[^.\n]{0,20}\b(?:the\s+)?(?:tool|function)\b",
    re.I,
)


def instruction_like(text: str) -> bool:
    return bool(_INSTRUCTION.search(text))


_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_SPACE = re.compile(r"\s+")


def clean(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    return _SPACE.sub(" ", _CONTROL.sub(" ", text)).strip()


def normalize_value(text: str) -> str:
    out = _SPACE.sub(" ", unicodedata.normalize("NFKC", text).lower())
    return re.sub(r"[\s.!;,]+$", "", out).strip()


def entity_key(name: str) -> str:
    slug = re.sub(r"[\W_]+", "-", unicodedata.normalize("NFKC", name).lower()).strip("-")[:80]
    return slug or "x" + hashlib.sha256(name.encode()).hexdigest()[:10]


def content_hash(value: str | None, object_type: str | None, object_key: str | None) -> str:
    text = f"rel:{object_type}:{object_key}" if object_type else f"val:{normalize_value(value or '')}"
    return hashlib.sha256(text.encode()).hexdigest()[:32]


# ── Validation ───────────────────────────────────────────────────────────────


class MemoryRejected(ValueError):
    """A candidate that breaks a rule. ``reason`` is machine-readable."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class ValidFact:
    subject_type: str
    subject_name: str
    subject_key: str
    predicate: str
    kind: str
    value: str | None
    object_type: str | None
    object_name: str | None
    object_key: str | None
    source_kind: str
    source_ref: str
    source_at: datetime
    source_excerpt: str | None
    trust: str
    confidence: float
    rule_bearing: bool
    cardinality: str
    value_hash: str


def _entity(raw: Any, label: str) -> tuple[str, str, str]:
    data = raw if isinstance(raw, dict) else {}
    etype = data.get("type")
    if etype not in ENTITY_TYPES:
        reason = "unknown_entity_type" if label == "subject" else "invalid_object"
        raise MemoryRejected(reason, f"{label} type is not in the ontology")
    name = clean(data.get("name"))
    if not name:
        raise MemoryRejected("empty", f"{label} name is empty")
    if len(name) > MAX_NAME:
        raise MemoryRejected("too_long", f"{label} name is longer than {MAX_NAME} characters")
    if secret_kinds(name):
        raise MemoryRejected("secret", f"{label} name looks like a credential")
    return etype, name, entity_key(name)


def validate_fact(
    *,
    subject: Any,
    predicate: Any,
    value: Any = None,
    object: Any = None,  # noqa: A002 — mirrors the wire field
    source_kind: str,
    source_ref: Any,
    source_at: datetime | None = None,
    source_excerpt: Any = None,
    confidence: float | None = None,
    now: datetime | None = None,
) -> ValidFact:
    """Check one candidate against the ontology, the caps and the text rules.
    Raises :class:`MemoryRejected`. Pure: no I/O."""
    now = now or datetime.now(timezone.utc)
    if source_kind not in SOURCE_KINDS:
        raise MemoryRejected("invalid_source", "source.kind is not a known source")
    ref = clean(source_ref)
    if not ref:
        raise MemoryRejected("invalid_source", "source.ref is required")
    if len(ref) > MAX_REF:
        raise MemoryRejected("too_long", "source.ref is too long")
    if secret_kinds(ref):
        raise MemoryRejected("secret", "source.ref looks like it contains a credential")

    s_type, s_name, s_key = _entity(subject, "subject")
    pred = clean(predicate).lower()
    spec = predicate_spec(s_type, pred)
    if spec is None:
        raise MemoryRejected("unknown_predicate", f'"{pred[:64]}" is not a predicate of {s_type}')

    val: str | None = None
    o_type = o_name = o_key = None
    if spec["kind"] == "relation":
        o_type, o_name, o_key = _entity(object, "object")
        if o_type not in spec["to"]:
            raise MemoryRejected("invalid_object", f"{pred} cannot point at a {o_type}")
    else:
        val = clean(value)
        if not val:
            raise MemoryRejected("empty", "value is empty")
        if len(val) > MAX_VALUE:
            raise MemoryRejected("too_long", f"value is longer than {MAX_VALUE} characters")
        if secret_kinds(val):
            raise MemoryRejected("secret", "value looks like a credential; memory never stores secrets")
        if spec.get("values"):
            normal = normalize_value(val)
            if normal not in spec["values"]:
                raise MemoryRejected("invalid_value", f"{pred} must be one of {', '.join(spec['values'])}")
            val = normal

    trust = trust_for(source_kind)
    if trust != "trusted" and instruction_like(f"{s_name} {val or o_name or ''}"):
        raise MemoryRejected("instruction_like", "the text reads like an instruction, not a fact")

    excerpt = clean(source_excerpt)
    excerpt = redact_secrets(excerpt)[:MAX_EXCERPT] if excerpt else None
    conf = confidence if confidence is not None else (1.0 if trust == "trusted" else 0.6)
    at = source_at or now
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return ValidFact(
        subject_type=s_type, subject_name=s_name, subject_key=s_key, predicate=pred,
        kind=spec["kind"], value=val, object_type=o_type, object_name=o_name, object_key=o_key,
        source_kind=source_kind, source_ref=ref, source_at=min(at, now), source_excerpt=excerpt,
        trust=trust, confidence=max(0.0, min(1.0, float(conf))),
        rule_bearing=bool(spec.get("ruleBearing")), cardinality=spec["cardinality"],
        value_hash=content_hash(val, o_type, o_key),
    )


def is_measured(item: dict[str, Any]) -> bool:
    return bool(item.get("metric")) and item.get("value") is not None and (item.get("n") or 0) >= MIN_SAMPLE


def status_allowed(status: str, evidence: list[dict[str, Any]]) -> bool:
    if not evidence:
        return False
    return status == "hypothesis" or any(is_measured(e) for e in evidence)


def _number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if v == v and abs(v) != float("inf") else None


def validate_evidence(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise MemoryRejected("no_evidence", "a learning without evidence is not stored")
    if len(raw) > MAX_EVIDENCE_ITEMS:
        raise MemoryRejected("too_long", f"at most {MAX_EVIDENCE_ITEMS} evidence items")
    out: list[dict[str, Any]] = []
    for item in raw:
        data = item if isinstance(item, dict) else {}
        kind, ref, label = data.get("kind"), clean(data.get("ref")), clean(data.get("label"))
        if kind not in EVIDENCE_KINDS or not ref or not label:
            raise MemoryRejected("invalid_evidence", "each evidence item needs a kind, a ref and a label")
        if len(ref) > MAX_REF or len(label) > MAX_EVIDENCE_LABEL:
            raise MemoryRejected("too_long", "evidence ref or label is too long")
        if secret_kinds(f"{ref} {label}"):
            raise MemoryRejected("secret", "evidence looks like it contains a credential")
        row: dict[str, Any] = {"kind": kind, "ref": ref, "label": label}
        metric, window = clean(data.get("metric"))[:60], clean(data.get("window"))[:60]
        if metric:
            row["metric"] = metric
        for key in ("value", "lift"):
            num = _number(data.get(key))
            if num is not None:
                row[key] = num
        n = _number(data.get("n"))
        if n is not None:
            row["n"] = max(0, int(n))
        if window:
            row["window"] = window
        out.append(row)
    return out


def validate_learning(*, claim: Any, status: str, evidence: Any) -> tuple[str, list[dict[str, Any]]]:
    text = clean(claim)
    if not text:
        raise MemoryRejected("empty", "claim is empty")
    if len(text) > MAX_CLAIM:
        raise MemoryRejected("too_long", f"claim is longer than {MAX_CLAIM} characters")
    if secret_kinds(text):
        raise MemoryRejected("secret", "claim looks like it contains a credential")
    if instruction_like(text):
        raise MemoryRejected("instruction_like", "the claim reads like an instruction")
    if status not in LEARNING_STATUSES:
        raise MemoryRejected("invalid_status", "unknown status")
    items = validate_evidence(evidence)
    if not status_allowed(status, items):
        raise MemoryRejected(
            "weak_evidence", f'"{status}" needs a measured metric with a sample of at least {MIN_SAMPLE}'
        )
    return text, items


# ── Rows ─────────────────────────────────────────────────────────────────────


class Fact(BaseModel):
    id: UUID
    subject_type: str
    subject_name: str
    subject_key: str
    predicate: str
    kind: str
    value: str | None
    object_type: str | None
    object_name: str | None
    object_key: str | None
    source_kind: str
    source_ref: str
    source_at: datetime
    source_excerpt: str | None
    trust: str
    confidence: float
    valid_from: datetime
    invalid_at: datetime | None
    invalid_reason: str | None
    superseded_by: UUID | None
    pending: bool
    challenges: UUID | None
    created_at: datetime


class Learning(BaseModel):
    id: UUID
    claim: str
    status: str
    evidence: list[dict[str, Any]]
    confidence: float
    source: str
    created_at: datetime
    updated_at: datetime


class AuditEntry(BaseModel):
    id: UUID
    actor: str
    action: str
    fact_id: UUID | None
    learning_id: UUID | None
    detail: str
    created_at: datetime


class WriteOutcome(BaseModel):
    """created | superseded | pending | duplicate | refused."""

    status: str
    reason: str | None = None
    fact: Fact | None = None


# user_id and value_hash never leave the repo.
_FACT_COLS = (
    "id, subject_type, subject_name, subject_key, predicate, kind, value, object_type, "
    "object_name, object_key, source_kind, source_ref, source_at, source_excerpt, trust, "
    "confidence, valid_from, invalid_at, invalid_reason, superseded_by, pending, challenges, "
    "created_at"
)
_LEARNING_COLS = "id, claim, status, evidence, confidence, source, created_at, updated_at"


def _fact(r) -> Fact:
    return Fact(**{k: r[k] for k in Fact.model_fields})


def _learning(r) -> Learning:
    d = dict(r)
    if isinstance(d.get("evidence"), str):
        d["evidence"] = json.loads(d["evidence"])
    return Learning(**d)


def _slot(v: ValidFact | Any) -> str:
    return f"{v.subject_type}:{v.subject_key}:{v.predicate}"[:200]


async def _audit(conn, user_id: str, actor: str, action: str, detail: str, *,
                 fact_id: UUID | None = None, learning_id: UUID | None = None) -> None:
    await conn.execute(
        "insert into memory_audit (user_id, actor, action, fact_id, learning_id, detail) "
        "values ($1, $2, $3, $4, $5, $6)",
        user_id, actor, action, fact_id, learning_id, detail[:300],
    )


async def _lock_slot(conn, user_id: str, slot: str) -> None:
    """Serialise writers of one user's slot for the length of the transaction."""
    await conn.execute("select pg_advisory_xact_lock(hashtextextended($1, 0))", f"memory:{user_id}:{slot}")


async def _slot_rows(conn, user_id: str, subject_type: str, subject_key: str, predicate: str):
    return await conn.fetch(
        "select *, value_hash from memory_facts where user_id = $1 and subject_type = $2 "
        "and subject_key = $3 and predicate = $4 order by valid_from, created_at",
        user_id, subject_type, subject_key, predicate,
    )


async def _invalidate(conn, user_id: str, ids: list[UUID], reason: str, by: UUID | None,
                      actor: str, slot: str) -> None:
    for fact_id in ids:
        await conn.execute(
            "update memory_facts set invalid_at = now(), invalid_reason = $3, superseded_by = $4, "
            "pending = false where id = $1 and user_id = $2 and invalid_at is null",
            fact_id, user_id, reason, by,
        )
        await _audit(conn, user_id, actor, "fact.merged" if reason == "merged" else "fact.superseded",
                     f"{slot}: {reason}", fact_id=fact_id)


async def _confirm(conn, user_id: str, row, slot_rows, slot: str) -> Fact:
    """Make ``row`` trusted and current; in a single-valued slot it supersedes
    whatever was current."""
    spec = predicate_spec(row["subject_type"], row["predicate"])
    holders = [
        r["id"] for r in slot_rows
        if r["id"] != row["id"] and r["invalid_at"] is None and not r["pending"]
    ] if spec and spec["cardinality"] == "one" else []
    await _invalidate(conn, user_id, holders, "superseded", row["id"], "person", slot)
    updated = await conn.fetchrow(
        "update memory_facts set trust = 'trusted', pending = false, challenges = null, "
        "confidence = 1, valid_from = case when pending then now() else valid_from end "
        f"where id = $1 and user_id = $2 returning {_FACT_COLS}",
        row["id"], user_id,
    )
    await _audit(conn, user_id, "person", "fact.confirmed", slot, fact_id=row["id"])
    return _fact(updated)


async def _write(conn, user_id: str, v: ValidFact, actor: str, *, correcting: UUID | None = None) -> WriteOutcome:
    slot = _slot(v)
    await _lock_slot(conn, user_id, slot)
    rows = await _slot_rows(conn, user_id, v.subject_type, v.subject_key, v.predicate)
    live = [r for r in rows if r["invalid_at"] is None]

    same = next((r for r in live if r["value_hash"] == v.value_hash), None)
    if same is not None:
        if v.trust == "trusted" and (same["pending"] or same["trust"] != "trusted"):
            return WriteOutcome(status="superseded", fact=await _confirm(conn, user_id, same, rows, slot))
        return WriteOutcome(status="duplicate", fact=_fact(same))

    if v.trust != "trusted" and any(
        r["invalid_reason"] in ("forgotten", "dismissed") and r["value_hash"] == v.value_hash for r in rows
    ):
        return WriteOutcome(status="refused", reason="forgotten")

    counts = await conn.fetchrow(
        "select count(*) filter (where invalid_at is null) as active, count(*) as total "
        "from memory_facts where user_id = $1",
        user_id,
    )
    if counts["active"] >= MAX_ACTIVE_FACTS or counts["total"] >= MAX_TOTAL_FACTS:
        return WriteOutcome(status="refused", reason="tenant_full")

    holders = [r for r in live if not r["pending"]] if v.cardinality == "one" else []
    strongest = max(holders, key=lambda r: _TRUST_RANK[r["trust"]], default=None)
    pending, reason = False, None
    if v.rule_bearing and v.trust != "trusted":
        pending, reason = True, "needs_person"
    elif strongest is not None and _TRUST_RANK[v.trust] < _TRUST_RANK[strongest["trust"]]:
        pending, reason = True, "lower_trust"

    inserted = await conn.fetchrow(
        f"""
        insert into memory_facts (
            user_id, subject_type, subject_name, subject_key, predicate, kind, value,
            object_type, object_name, object_key, source_kind, source_ref, source_at,
            source_excerpt, trust, confidence, pending, challenges, value_hash)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        returning {_FACT_COLS}
        """,
        user_id, v.subject_type, v.subject_name, v.subject_key, v.predicate, v.kind, v.value,
        v.object_type, v.object_name, v.object_key, v.source_kind, v.source_ref, v.source_at,
        v.source_excerpt, v.trust, v.confidence, pending,
        strongest["id"] if pending and strongest is not None else None, v.value_hash,
    )
    new_id = inserted["id"]
    if pending:
        await _audit(conn, user_id, actor, "fact.pending", f"{slot} ({reason})", fact_id=new_id)
        return WriteOutcome(status="pending", reason=reason, fact=_fact(inserted))

    to_invalidate = [r["id"] for r in holders if r["id"] != correcting]
    await _invalidate(conn, user_id, to_invalidate, "superseded", new_id, actor, slot)
    if correcting is not None:
        await _invalidate(conn, user_id, [correcting], "corrected", new_id, actor, slot)
    action = "fact.corrected" if correcting is not None else "fact.created"
    await _audit(conn, user_id, actor, action, slot, fact_id=new_id)
    return WriteOutcome(status="superseded" if (to_invalidate or correcting) else "created", fact=_fact(inserted))


# ── Public API: facts ────────────────────────────────────────────────────────


async def write_fact(user_id: str, fact: ValidFact, *, actor: Actor) -> WriteOutcome:
    """Store one validated fact for ``user_id``. Only ``actor="person"`` may
    write a ``person`` (trusted) source."""
    if fact.source_kind == "person" and actor != "person":
        raise MemoryRejected("invalid_source", "only a person can write a person-sourced fact")
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        return await _write(conn, user_id, fact, actor)


async def list_facts(
    user_id: str,
    *,
    state: Literal["current", "pending", "active", "all"] = "current",
    entity_type: str | None = None,
    limit: int = 200,
) -> list[Fact]:
    """The user's facts. ``current`` (the default) is what retrieval may use:
    not invalid and not waiting for the person. ``active`` adds pending;
    ``all`` adds history and tombstones."""
    where, args = ["user_id = $1"], [user_id]
    if state == "current":
        where.append("invalid_at is null and not pending")
    elif state == "pending":
        where.append("invalid_at is null and pending")
    elif state == "active":
        where.append("invalid_at is null")
    if entity_type:
        args.append(entity_type)
        where.append(f"subject_type = ${len(args)}")
    args.append(limit)
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_FACT_COLS} from memory_facts where {' and '.join(where)} "
        f"order by valid_from desc, id limit ${len(args)}",
        *args,
    )
    return [_fact(r) for r in rows]


async def fact_counts(user_id: str) -> dict[str, int]:
    pool = await get_pool()
    r = await pool.fetchrow(
        "select count(*) filter (where invalid_at is null and not pending) as current, "
        "count(*) filter (where invalid_at is null and pending) as pending, "
        "count(*) as total from memory_facts where user_id = $1",
        user_id,
    )
    return {"current": r["current"], "pending": r["pending"], "total": r["total"]}


async def fact_history(user_id: str, fact_id: UUID) -> list[Fact]:
    """Every version of the fact's slot, oldest first. Empty when the fact is
    not the user's."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {', '.join('f.' + c.strip() for c in _FACT_COLS.split(','))}
          from memory_facts f
          join memory_facts t on t.user_id = f.user_id and t.subject_type = f.subject_type
           and t.subject_key = f.subject_key and t.predicate = f.predicate
         where t.id = $1 and t.user_id = $2 and f.user_id = $2
         order by f.valid_from, f.created_at
        """,
        fact_id, user_id,
    )
    return [_fact(r) for r in rows]


async def _own_row(conn, user_id: str, fact_id: UUID):
    return await conn.fetchrow(
        "select *, value_hash from memory_facts where id = $1 and user_id = $2", fact_id, user_id
    )


async def confirm_fact(user_id: str, fact_id: UUID) -> Fact | None:
    """Person only. None when the fact is not the user's or is no longer live."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await _own_row(conn, user_id, fact_id)
        if row is None or row["invalid_at"] is not None:
            return None
        slot = _slot(_RowSlot(row))
        await _lock_slot(conn, user_id, slot)
        rows = await _slot_rows(conn, user_id, row["subject_type"], row["subject_key"], row["predicate"])
        fresh = next((r for r in rows if r["id"] == fact_id), None)
        if fresh is None or fresh["invalid_at"] is not None:
            return None
        return await _confirm(conn, user_id, fresh, rows, slot)


async def correct_fact(user_id: str, fact_id: UUID, *, value: Any = None, object: Any = None) -> WriteOutcome | None:  # noqa: A002
    """Person only: the corrected value becomes a new trusted fact and the old
    row is invalidated as ``corrected``. None when the fact is not the user's
    or is no longer live. Raises :class:`MemoryRejected` on a bad value."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await _own_row(conn, user_id, fact_id)
        if row is None or row["invalid_at"] is not None:
            return None
        valid = validate_fact(
            subject={"type": row["subject_type"], "name": row["subject_name"]},
            predicate=row["predicate"], value=value, object=object,
            source_kind="person", source_ref=f"memory-page:{fact_id}",
        )
        outcome = await _write(conn, user_id, valid, "person", correcting=fact_id)
        # Corrected to a value that already exists: the old row merges into it.
        if outcome.fact is not None and outcome.fact.id != fact_id:
            await conn.execute(
                "update memory_facts set invalid_at = now(), invalid_reason = 'merged', superseded_by = $3, "
                "pending = false where id = $1 and user_id = $2 and invalid_at is null",
                fact_id, user_id, outcome.fact.id,
            )
        return outcome


async def forget_fact(user_id: str, fact_id: UUID) -> bool:
    """Person only: wipe the content, keep a tombstone, write an audit entry.
    False when the fact is not the user's or is already forgotten."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            update memory_facts
               set value = null,
                   object_name = case when object_type is null then null else '' end,
                   object_key = case when object_type is null then null else '' end,
                   source_excerpt = null,
                   source_ref = '',
                   invalid_reason = case when invalid_at is null and pending then 'dismissed' else 'forgotten' end,
                   invalid_at = coalesce(invalid_at, now()),
                   pending = false,
                   challenges = null
             where id = $1 and user_id = $2
               and (invalid_reason is null or invalid_reason not in ('forgotten', 'dismissed'))
            returning subject_type, subject_key, predicate, invalid_reason
            """,
            fact_id, user_id,
        )
        if row is None:
            return False
        await _audit(conn, user_id, "person", "fact.forgotten",
                     f"{_slot(_RowSlot(row))}: {row['invalid_reason']}", fact_id=fact_id)
        return True


async def merge_duplicates(user_id: str, keep: UUID, drop: list[UUID], *, actor: Actor = "system") -> int:
    """Consolidation: invalidate ``drop`` as merged into ``keep``. Only rows of
    this user, live, in the same slot and with the same content as ``keep``
    are touched, so this can never be used to remove a different fact."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        kept = await _own_row(conn, user_id, keep)
        if kept is None or kept["invalid_at"] is not None:
            return 0
        slot = _slot(_RowSlot(kept))
        merged = 0
        for fact_id in drop:
            if fact_id == keep:
                continue
            result = await conn.execute(
                "update memory_facts set invalid_at = now(), invalid_reason = 'merged', superseded_by = $3, "
                "pending = false where id = $1 and user_id = $2 and invalid_at is null "
                "and subject_type = $4 and subject_key = $5 and predicate = $6 and value_hash = $7",
                fact_id, user_id, keep, kept["subject_type"], kept["subject_key"], kept["predicate"],
                kept["value_hash"],
            )
            if result.split()[-1] == "1":
                merged += 1
                await _audit(conn, user_id, actor, "fact.merged", f"{slot}: merged", fact_id=fact_id)
        return merged


class _RowSlot:
    """Adapts a row to ``_slot``."""

    def __init__(self, row) -> None:
        self.subject_type = row["subject_type"]
        self.subject_key = row["subject_key"]
        self.predicate = row["predicate"]


# ── Public API: learnings and audit ──────────────────────────────────────────


async def record_learning(
    user_id: str, *, claim: str, status: str, evidence: list[dict[str, Any]],
    confidence: float | None, source: str, actor: Actor,
) -> Learning | None:
    """Insert a validated learning. None when the user's learnings are full."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("select pg_advisory_xact_lock(hashtextextended($1, 0))", f"memory:{user_id}:learnings")
        count = await conn.fetchval("select count(*) from memory_learnings where user_id = $1", user_id)
        if count >= MAX_LEARNINGS:
            return None
        conf = confidence if confidence is not None else (0.4 if status == "hypothesis" else 0.7)
        row = await conn.fetchrow(
            "insert into memory_learnings (user_id, claim, status, evidence, confidence, source) "
            f"values ($1, $2, $3, $4::jsonb, $5, $6) returning {_LEARNING_COLS}",
            user_id, claim, status, json.dumps(evidence), max(0.0, min(1.0, conf)), source,
        )
        await _audit(conn, user_id, actor, "learning.recorded", status, learning_id=row["id"])
        return _learning(row)


async def list_learnings(user_id: str, *, status: str | None = None, limit: int = 50) -> list[Learning]:
    pool = await get_pool()
    args: list[Any] = [user_id]
    where = "user_id = $1"
    if status:
        args.append(status)
        where += " and status = $2"
    args.append(limit)
    rows = await pool.fetch(
        f"select {_LEARNING_COLS} from memory_learnings where {where} "
        f"order by updated_at desc, id limit ${len(args)}",
        *args,
    )
    return [_learning(r) for r in rows]


async def set_learning_status(
    user_id: str, learning_id: UUID, *, status: str, add_evidence: list[dict[str, Any]], actor: Actor,
) -> Learning | None:
    """Change a learning's status, optionally adding evidence. None when it is
    not the user's. Raises :class:`MemoryRejected` when the evidence does not
    carry the status."""
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "select evidence from memory_learnings where id = $1 and user_id = $2 for update",
            learning_id, user_id,
        )
        if row is None:
            return None
        current = row["evidence"]
        current = json.loads(current) if isinstance(current, str) else list(current)
        merged = [*current, *add_evidence]
        if len(merged) > MAX_EVIDENCE_ITEMS:
            raise MemoryRejected("too_long", f"at most {MAX_EVIDENCE_ITEMS} evidence items")
        if not status_allowed(status, merged):
            raise MemoryRejected(
                "weak_evidence", f'"{status}" needs a measured metric with a sample of at least {MIN_SAMPLE}'
            )
        updated = await conn.fetchrow(
            "update memory_learnings set status = $3, evidence = $4::jsonb, updated_at = now() "
            f"where id = $1 and user_id = $2 returning {_LEARNING_COLS}",
            learning_id, user_id, status, json.dumps(merged),
        )
        await _audit(conn, user_id, actor, "learning.status", status, learning_id=learning_id)
        return _learning(updated)


async def list_audit(user_id: str, *, limit: int = 50) -> list[AuditEntry]:
    pool = await get_pool()
    rows = await pool.fetch(
        "select id, actor, action, fact_id, learning_id, detail, created_at from memory_audit "
        "where user_id = $1 order by created_at desc, id desc limit $2",
        user_id, limit,
    )
    return [AuditEntry(**dict(r)) for r in rows]
