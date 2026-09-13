from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from ..db import get_pool
from ..models.production import ProductionCommand, readiness, approval_current
from . import creative_library as library


class Conflict(ValueError):
    pass


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


def response(source: dict, row, events: list) -> dict:
    state = decode(row["state"]) if row else {}
    brief_version = row["brief_version"] if row else 0
    return {
        "source": {
            key: source[key]
            for key in ("item", "fingerprint", "anchors", "excerpt", "preview_count")
        },
        "version": row["version"] if row else 0,
        "brief_version": brief_version,
        "state": state,
        "readiness": readiness(source, state),
        "approved": approval_current(source, state, brief_version),
        "events": events,
    }


async def get(user_id: str, kind: str, creative_id: UUID) -> dict | None:
    pool = await get_pool()
    source = await library.source(user_id, kind, creative_id)
    if not source:
        return None
    row = await pool.fetchrow(
        "SELECT * FROM production_packages WHERE user_id=$1 AND creative_kind=$2 AND creative_id=$3",
        user_id,
        kind,
        creative_id,
    )
    events = await pool.fetch(
        "SELECT version, action, source_fingerprint, created_at FROM production_events WHERE user_id=$1 AND creative_kind=$2 AND creative_id=$3 ORDER BY version DESC LIMIT 50",
        user_id,
        kind,
        creative_id,
    )
    return response(source, row, [dict(e) for e in events])


async def apply(
    user_id: str, kind: str, creative_id: UUID, command: ProductionCommand
) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        source = await library.source(user_id, kind, creative_id, connection=conn, lock=True)
        if not source:
            return None
        await conn.execute(
            "INSERT INTO production_packages (user_id,creative_kind,creative_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            user_id,
            kind,
            creative_id,
        )
        row = await conn.fetchrow(
            "SELECT * FROM production_packages WHERE user_id=$1 AND creative_kind=$2 AND creative_id=$3 FOR UPDATE",
            user_id,
            kind,
            creative_id,
        )
        if (
            row["version"] != command.expected_version
            or source["fingerprint"] != command.source_fingerprint
        ):
            raise Conflict("This creative or brief changed. Reload before saving your review.")
        state = decode(row["state"])
        brief_version = row["brief_version"]
        now = datetime.now(timezone.utc).isoformat()
        if command.action == "save":
            if not command.brief:
                raise ValueError("A brief is required")
            ids = [i.id for i in command.brief.inputs]
            if len(ids) != len(set(ids)):
                raise ValueError("Required inputs must have distinct IDs")
            parent = command.brief.variant_of
            if parent:
                try:
                    parent_kind, parent_id = parent.split(":", 1)
                    parent_source = await library.source(
                        user_id, parent_kind, UUID(parent_id), connection=conn
                    )
                except ValueError:
                    parent_source = None
                if not parent_source or parent == f"{kind}:{creative_id}":
                    raise ValueError(
                        "Choose another creative in your workspace as the variant source"
                    )
            state["brief"] = command.brief.model_dump(mode="json")
            brief_version += 1
        elif command.action == "note":
            if not command.text or command.anchor not in {a["id"] for a in source["anchors"]}:
                raise ValueError("Choose a current section and write a review note")
            notes = state.setdefault("notes", [])
            if len(notes) >= 100:
                raise ValueError("This creative has reached its 100-note limit")
            notes.append(
                {
                    "id": str(uuid4()),
                    "text": command.text,
                    "anchor": command.anchor,
                    "blocking": command.blocking,
                    "source_fingerprint": source["fingerprint"],
                    "created_at": now,
                    "author": user_id,
                }
            )
        elif command.action == "resolve":
            note = next(
                (
                    n
                    for n in state.get("notes", [])
                    if n["id"] == command.note_id and not n.get("resolved_at")
                ),
                None,
            )
            if not note or not command.text:
                raise ValueError("An open note and a resolution are required")
            note.update(resolved_at=now, resolution=command.text, resolved_by=user_id)
        elif command.action == "approve":
            issues = readiness(source, state)
            if issues:
                raise ValueError("; ".join(issues))
            state["approval"] = {
                "source_fingerprint": source["fingerprint"],
                "brief_version": brief_version,
                "at": now,
                "by": user_id,
            }
        elif command.action == "handoff":
            if (
                not approval_current(source, state, brief_version)
                or not command.text
                or not command.evidence_url
            ):
                raise ValueError(
                    "Approve the current version and provide a destination and handoff note"
                )
            handoffs = state.setdefault("handoffs", [])
            if len(handoffs) >= 50:
                raise ValueError("This creative has reached its 50-handoff limit")
            handoffs.append(
                {
                    "version": row["version"] + 1,
                    "source_fingerprint": source["fingerprint"],
                    "brief_version": brief_version,
                    "at": now,
                    "by": user_id,
                    "text": command.text,
                    "url": str(command.evidence_url),
                }
            )
        elif command.action == "outcome":
            if not command.text or not command.evidence_url:
                raise ValueError(
                    "Describe the measured result, period and next step, and link its evidence"
                )
            handoff = next(
                (h for h in state.get("handoffs", []) if h["version"] == command.handoff_version),
                None,
            )
            if not handoff:
                raise ValueError("Select the handoff version these results describe")
            outcomes = state.setdefault("outcomes", [])
            if len(outcomes) >= 50:
                raise ValueError("This creative has reached its 50-outcome limit")
            outcomes.append(
                {
                    "source_fingerprint": handoff["source_fingerprint"],
                    "handoff_version": handoff["version"],
                    "at": now,
                    "by": user_id,
                    "text": command.text,
                    "url": str(command.evidence_url),
                }
            )
        version = row["version"] + 1
        await conn.execute(
            "UPDATE production_packages SET state=$4::jsonb,version=$5,brief_version=$6,updated_at=now() WHERE user_id=$1 AND creative_kind=$2 AND creative_id=$3",
            user_id,
            kind,
            creative_id,
            json.dumps(state),
            version,
            brief_version,
        )
        await conn.execute(
            "INSERT INTO production_events (user_id,creative_kind,creative_id,version,action,source_fingerprint,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
            user_id,
            kind,
            creative_id,
            version,
            command.action,
            source["fingerprint"],
            command.model_dump_json(),
        )
    return await get(user_id, kind, creative_id)
