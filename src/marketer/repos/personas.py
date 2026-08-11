"""Brand personas + their conversations (asyncpg).

Every query is user-scoped — a persona id alone is never enough to read,
write, or delete anything. Both tables carry ``user_id`` so they are (a)
picked up automatically by the GDPR export in ``repos.privacy`` (which
discovers per-user tables by that column) and (b) FK-cascaded from
``users(id)`` on erasure. See migration 0034.
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from ..db import get_pool
from ..personas.schemas import (
    MAX_MESSAGE_CHARS,
    MAX_REPLY_CHARS,
    Persona,
    PersonaMessage,
    PersonaTurn,
    clean_banned_topics,
)

_COLS = (
    "id, user_id, niche_id, name, tagline, persona, greeting, voice_rules, "
    "banned_topics, visual_ref_path, visual_locked_at, created_at, updated_at"
)
_MSG_COLS = "id, persona_id, user_id, role, content, created_at"

# Hard ceiling on how many messages one GET can return. The conversation
# view is a scrollback, not a bulk export; the erasure/export path uses
# repos.privacy instead.
MAX_LIST_MESSAGES = 200


def _row(r) -> Persona:
    d = dict(r)
    d["banned_topics"] = list(d.get("banned_topics") or [])
    d["visual_ref_path"] = d.get("visual_ref_path") or ""
    return Persona(**d)


def _msg_row(r) -> PersonaMessage:
    return PersonaMessage(**dict(r))


async def create(
    *,
    user_id: str,
    name: str,
    tagline: str = "",
    persona: str = "",
    greeting: str = "",
    voice_rules: str = "",
    banned_topics: list[str] | None = None,
    niche_id: UUID | None = None,
) -> Persona:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into brand_personas
            (user_id, niche_id, name, tagline, persona, greeting,
             voice_rules, banned_topics)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning {_COLS}
        """,
        user_id, niche_id, name, tagline, persona, greeting, voice_rules,
        clean_banned_topics(banned_topics),
    )
    return _row(row)


async def get(persona_id: UUID, *, user_id: str) -> Persona | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from brand_personas where id = $1 and user_id = $2",
        persona_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(user_id: str, *, limit: int = 100) -> list[Persona]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from brand_personas
         where user_id = $1
         order by created_at desc
         limit $2
        """,
        user_id, max(1, min(int(limit), 500)),
    )
    return [_row(r) for r in rows]


_UPDATABLE = {
    "name", "tagline", "persona", "greeting", "voice_rules",
    "banned_topics", "niche_id",
}


async def update(persona_id: UUID, *, user_id: str, **fields) -> Persona | None:
    """Partial update. Only writable identity fields — the visual lock is
    never editable through here (see ``lock_visual``), so a PUT can't
    silently re-point a persona at someone else's reference image."""
    sets: list[str] = []
    values: list[object] = []
    i = 1
    for key, val in fields.items():
        if key not in _UPDATABLE:
            continue
        if key == "banned_topics":
            val = clean_banned_topics(val)  # noqa: PLW2901
        sets.append(f"{key} = ${i}")
        values.append(val)
        i += 1
    if not sets:
        return await get(persona_id, user_id=user_id)
    sets.append("updated_at = now()")
    values += [persona_id, user_id]

    pool = await get_pool()
    row = await pool.fetchrow(
        "update brand_personas set " + ", ".join(sets)
        + f" where id = ${i} and user_id = ${i + 1} returning {_COLS}",
        *values,
    )
    return _row(row) if row else None


async def delete(persona_id: UUID, *, user_id: str) -> bool:
    """Delete the persona. Its messages cascade (FK on delete cascade)."""
    pool = await get_pool()
    result = await pool.execute(
        "delete from brand_personas where id = $1 and user_id = $2",
        persona_id, user_id,
    )
    return result.endswith("1")


async def lock_visual(
    persona_id: UUID, *, user_id: str, path: str | Path
) -> Persona | None:
    """Record the generated reference and stamp the lock.

    ``visual_locked_at is null`` in the predicate makes the lock
    write-once at the database level: two concurrent POSTs to
    ``/visual`` cannot both claim it, so the persona's face can never be
    swapped by a race.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update brand_personas
           set visual_ref_path = $3, visual_locked_at = now(), updated_at = now()
         where id = $1 and user_id = $2 and visual_locked_at is null
        returning {_COLS}
        """,
        persona_id, user_id, str(path),
    )
    return _row(row) if row else None


# ── Conversation ───────────────────────────────────────────────────────


async def list_messages(
    persona_id: UUID, *, user_id: str, limit: int = 50
) -> list[PersonaMessage]:
    """The newest ``limit`` messages, returned oldest-first.

    We select the newest slice and reverse it rather than taking the
    oldest: a long-running conversation must open on what was just said,
    and it keeps the query bounded no matter how many turns exist.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_MSG_COLS} from brand_persona_messages
         where persona_id = $1 and user_id = $2
         order by created_at desc, id desc
         limit $3
        """,
        persona_id, user_id, max(1, min(int(limit), MAX_LIST_MESSAGES)),
    )
    return [_msg_row(r) for r in reversed(rows)]


async def append_turn(
    persona_id: UUID, *, user_id: str, user_content: str, assistant_content: str
) -> PersonaTurn:
    """Persist the user message and the persona's reply as one unit.

    Both rows land in a single transaction *after* the LLM call succeeds,
    so a failed or cap-refused turn leaves no orphan user message dangling
    in the thread (and no phantom turn to resend as history next time).
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            user_row = await conn.fetchrow(
                f"""
                insert into brand_persona_messages
                    (persona_id, user_id, role, content)
                values ($1, $2, 'user', $3)
                returning {_MSG_COLS}
                """,
                persona_id, user_id, user_content[:MAX_MESSAGE_CHARS],
            )
            assistant_row = await conn.fetchrow(
                f"""
                insert into brand_persona_messages
                    (persona_id, user_id, role, content)
                values ($1, $2, 'assistant', $3)
                returning {_MSG_COLS}
                """,
                persona_id, user_id, assistant_content[:MAX_REPLY_CHARS],
            )
    return PersonaTurn(
        user_message=_msg_row(user_row),
        assistant_message=_msg_row(assistant_row),
    )


async def clear_messages(persona_id: UUID, *, user_id: str) -> int:
    """Wipe the conversation, keeping the persona. Returns rows deleted."""
    pool = await get_pool()
    result = await pool.execute(
        "delete from brand_persona_messages where persona_id = $1 and user_id = $2",
        persona_id, user_id,
    )
    try:
        return int(result.split()[-1])
    except (ValueError, IndexError):  # pragma: no cover - driver format drift
        return 0
