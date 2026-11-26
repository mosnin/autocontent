# Consolidation

Consolidation is a pass over one account's facts that merges duplicates and flags contradictions. It never decides
which of two disagreeing facts is right: each contradiction becomes a question for the person.

## The pure function

`consolidate(facts)` in `agent/src/marketer/memory/consolidate.ts` takes the account's live facts and returns a plan.
It does no I/O and does not change its input.

```ts
const plan = consolidate(facts);
// plan.merges:         [{ slot, keep, drop: [...] }]
// plan.contradictions: [{ kind, slot, factIds, question }]
```

**Merges.** Facts in the same slot with the same content. The one kept is current before pending, then the most
trusted, then the oldest. The others are invalidated with `invalid_reason = merged` and `superseded_by` pointing at
the keeper.

**Contradictions.**

| Kind | Found when | The question |
|---|---|---|
| `slot_conflict` | A single-valued slot holds two different current values | "Memory holds 2 different values for ... Which one is right?" |
| `pending_challenge` | A lower-trust value is waiting against the current one | "Keep the current value or accept the new one?" |
| `rule_conflict` | A `forbids` fact points at something the brand `makes`, or at a claim whose status is `approved` | "Which should Marketer follow?" |

## Running it

```ts
import { ApiMemoryStore, runConsolidation } from "../marketer/memory/index.ts";

const store = new ApiMemoryStore({ env: () => env as unknown as Record<string, unknown> });
const report = await runConsolidation(store, tenantId);
// { tenantId, inspected, merged, contradictions }
```

`runConsolidation` reads the account's live facts, applies the merges through the store and returns the
contradictions. It is safe to repeat: a second run finds nothing left to merge. The backend re-checks every merge
(`merge_duplicates`): it only touches rows of the same account, in the same slot and with the same content as the
keeper, so a merge can never remove a different fact. Each merge writes an audit entry with actor `system`.

## Scheduling it

Nothing schedules it today. The harness has two places it could run, and neither is wired, for these reasons:

- **The minute cron** (`agent/src/lib/cron.ts`, `sweepHeartbeats`). It has no list of accounts. Consolidation needs
  one tenant id per run.
- **The autopilot heartbeat** (`agent/src/marketer/heartbeat.ts`, the persistent agent). It runs per account, so the
  tenant id is at hand. This is the place to wire it.

To wire it into the autopilot:

1. On a tick, at most once a day per account, call `runConsolidation(store, tenant.tenantId)` with an
   `ApiMemoryStore` built from the tick's env. A persistent agent's calls go through the credential broker, so pass
   its fetch: `new ApiMemoryStore({ env, fetch: ctx.services.fetch })`.
2. Keep the last run time in the agent's own persistent state, under a key that does not start with `as:`.
3. For each contradiction in the report, put `question` in front of the person. The autopilot already proposes
   through `propose_next_moves`; a contradiction is a proposal that asks a question and changes nothing. Do not act
   on a contradiction without an answer.
4. Treat a failure as "skip this tick". Consolidation is housekeeping; it must never fail a heartbeat.

A backend job can do the same without the agent: `list_facts(user_id, state="active")`, group by slot and content,
and call `merge_duplicates`. The backend has no port of `consolidate` yet, so the contradiction rules would need
porting first.

## What it does not do

- It does not merge near-duplicates ("Warm and practical" and "Practical, warm"). Only equal content after
  normalising case, spacing and trailing punctuation.
- It does not expire old facts. A fact stays current until something supersedes it or the person forgets it.
- It does not confirm, correct or forget anything.
