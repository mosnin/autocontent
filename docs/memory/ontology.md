# The marketing ontology

Memory holds only what fits this table. A candidate with another entity type, another predicate, or a relation
pointing at the wrong kind of entity is rejected, never coerced.

- Source of truth: `agent/src/marketer/memory/ontology.ts`.
- The backend's copy: `src/marketer/repos/memory.py`.
- Both are tested against [`ontology.json`](ontology.json), so they cannot drift apart silently. Version:
  `marketing.v1`.

## Entity types and attributes

An attribute fact is `subject · attribute · value`.

| Entity type | Attributes (one value) | Attributes (many values) |
|---|---|---|
| `brand` | `name`, `voice`, `positioning`, `tagline`, `mission`, `website` | |
| `audience` | `description`, `language`, `location` | `pain_point`, `goal` |
| `offer` | `description`, `price`, `guarantee`, `deadline` | |
| `product` | `description`, `price`, `category` | `feature` |
| `competitor` | `positioning`, `price`, `website` | `strength`, `weakness` |
| `channel` | `handle`, `cadence`, `best_time` | `format` |
| `campaign` | `goal`, `status`, `window`, `budget_note` | |
| `creative` | `hook`, `format`, `angle` | |
| `claim` | `text`, `status` (`approved` or `forbidden`, rule-bearing) | `proof` |
| `rule` | `text` (rule-bearing), `scope` (rule-bearing) | |
| `preference` | `text` | |

## Relations

A relation fact is `subject · relation · object`. All relations hold many values.

| Relation | From | To |
|---|---|---|
| `targets` | brand, offer, product, campaign, creative | audience |
| `competes_with` | brand, offer, product | competitor |
| `runs_on` | campaign, creative | channel |
| `offers` | brand | offer, product |
| `promotes` | campaign, creative | offer, product |
| `makes` | brand, creative, competitor | claim |
| `forbids` (rule-bearing) | brand, rule | claim, channel, creative |
| `prefers` | brand, audience | channel, creative, preference |

## Terms

- **Slot.** One subject plus one predicate, for one account. `brand "Pasta Club" · voice` is a slot.
- **One value.** The slot holds a single current fact. A new value supersedes the old one.
- **Many values.** The slot holds a set. A new value is added; an equal value is a duplicate.
- **Rule-bearing.** The fact says what Marketer must or must not say. It only becomes current after a person
  confirms it. See [trust.md](trust.md).
- **Entity key.** The slug of the entity's name (lower case, letters and digits joined by `-`). "Pasta Club" and
  "pasta club" are the same entity.

Two values are the same when they match after lower-casing, collapsing spaces and dropping trailing punctuation.

## Changing the ontology

1. Edit `ontology.ts` and the tables in `src/marketer/repos/memory.py`.
2. Regenerate the pinned file:
   ```bash
   cd agent && node --experimental-strip-types -e 'import("./src/marketer/memory/ontology.ts").then(async (m) => (await import("node:fs")).writeFileSync("../docs/memory/ontology.json", JSON.stringify(m.ontologySnapshot(), null, 2) + "\n"))'
   ```
3. Bump `ONTOLOGY_VERSION` on both sides when a type or predicate is removed or changes meaning.
4. Run `pnpm vitest run test/memory.test.ts` and `pytest tests/test_memory_rules.py`.
5. Update the tables above.

Removing a predicate does not delete stored facts that use it. They stay readable in history and stop being written.
