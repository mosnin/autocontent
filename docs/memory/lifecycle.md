# The life of a fact

A fact is one row: subject, predicate, value or object, where it came from, how much it is trusted, and when it was
true. Facts are invalidated, never deleted ([ADR 0009](../adr/0009-facts-are-invalidated-never-deleted.md)). Forget
is the one exception to "the content stays", and it still leaves the row.

## Fields

| Field | Meaning |
|---|---|
| `subject`, `predicate`, `value` / `object` | What the fact says. See [ontology.md](ontology.md) |
| `source.kind` | `person`, `message`, `approval`, `job`, `metric`, `tool`, `document` or `web` |
| `source.ref` | Which message, tool call, document or URL |
| `source.at`, `source.excerpt` | When, and a short redacted quote of the text it was read from |
| `trust` | `trusted`, `unconfirmed` or `untrusted`. Derived from `source.kind` in code. See [trust.md](trust.md) |
| `confidence` | 0 to 1. An extractor's own confidence is capped at 0.9; a person's fact is 1 |
| `valid_from` | When the fact became true for Marketer |
| `invalid_at`, `invalid_reason`, `superseded_by` | Set together when the fact stops being current |
| `pending`, `challenges` | Waiting for the person, and the current fact it disagrees with |

## States

```
                      ┌──────────── person confirms ────────────┐
                      ▼                                          │
 write ──► current ──────► superseded   (a newer value)          │
   │          │    ──────► corrected    (the person edited it)   │
   │          │    ──────► merged       (a duplicate was folded) │
   │          └──────────► forgotten    (the person forgot it)   │
   └─────► pending ───────────────────────────────────────────────┘
              └──────────► dismissed    (the person said no)
```

| State | In retrieval | On the Memory page |
|---|---|---|
| current | yes | Facts |
| pending | no | Needs you |
| superseded, corrected, merged | no | "Earlier values" of the fact |
| forgotten, dismissed | no | "Forgotten" in the history, with no text |

## Writing

`planWrite` in `agent/src/marketer/memory/facts.ts`, and `_write` in `src/marketer/repos/memory.py`. In order:

1. **Same content as a live fact in the slot.** A duplicate; nothing is written. If a person restates a fact that was
   unconfirmed or pending, that confirms it.
2. **Same content as something the person forgot or dismissed, from a source that is not the person.** Refused.
3. **The account is full.** Refused. Nothing is evicted to make room.
4. **A rule-bearing fact from a source that is not the person.** Stored pending (`needs_person`).
5. **A single-valued slot with a different current value.**
   - The new fact's trust is at least the current fact's: the new fact becomes current and the old one gets
     `invalid_at`, `invalid_reason = superseded` and `superseded_by`.
   - Lower trust: the new fact is stored pending (`lower_trust`) with `challenges` set. A person decides.
6. **Otherwise** it becomes current.

The backend runs these steps in one transaction under a lock on the slot, and a unique index allows one live row per
content per slot, so two writers at once still leave one current value.

## Person-only changes

Only a signed-in person can do these, on the Memory page. The agent's service token gets a 403, and there is no agent
tool for them.

| Action | What happens |
|---|---|
| **Confirm** | The fact becomes `trusted` and current. In a single-valued slot it supersedes whatever was current |
| **Correct** | The corrected value is a new `trusted` fact with source `person`. The old row is invalidated as `corrected` and stays in the history |
| **Forget** | The row becomes a tombstone: value, object name, excerpt and source reference are wiped; `invalid_reason = forgotten`; an audit entry is written. A pending fact becomes `dismissed` the same way |

A tombstone keeps the slot, the times and a hash of the content. The hash is what lets step 2 refuse the same value
when a web page or an extraction offers it again. The person can still state it again themselves.

Account deletion removes every row through the `users` foreign key, tombstones and audit included.

## History

`fact_history` (agent tool) and `GET /api/v1/memory/facts/{id}/history` return every version in the fact's slot,
oldest first, with when each was true and why it changed. "What was our positioning in March?" is answered from here.

## Audit

`memory_audit` records every change: who (`person`, `agent` or `system`), what (`fact.created`, `fact.superseded`,
`fact.pending`, `fact.confirmed`, `fact.corrected`, `fact.forgotten`, `fact.merged`, `learning.recorded`,
`learning.status`), which row, and when. It is append-only (a trigger refuses updates). The detail holds the slot and
the reason, never the fact's text, so the audit cannot leak what a person asked to forget.

## Learnings

A learning is a claim, a status and its evidence ([ADR 0010](../adr/0010-learnings-carry-their-evidence.md)).

| Status | Needs |
|---|---|
| `hypothesis` | At least one evidence item |
| `supported`, `refuted` | At least one measured item: a named metric, a value, and a sample of 5 or more |

Each evidence item has a `kind` (`post`, `article`, `ad`, `metric`, `decision`, `experiment`), a `ref` (the id of the
row it points at) and a `label`; a measurement adds `metric`, `value`, `n`, and optionally `lift` and `window`. A
learning without evidence is rejected in code and by a database check. Moving a hypothesis to a verdict means adding
the measurement in the same call.

A learning shapes drafts and rankings. It never changes a risk tier, a cap, an approval or a brand rule
([ADR 0002](../adr/0002-a-decision-model-can-tighten-never-loosen-a-tier.md)).
