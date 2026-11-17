---
status: proposed
---

# Facts are invalidated, never deleted

When a fact about a tenant's world stops being true (a competitor's price, a channel's audience, a brand rule), we
mark it invalid with the time and the reason instead of deleting it. Reads return currently valid facts by default;
history stays queryable.

## Why

- **Decisions need their context.** An execution record or a learning that cited a fact must still explain itself
  after the fact changes.
- **Agents misremember.** If a wrong fact is overwritten, nobody can see that the agent acted on it.
- **Same discipline as the rails ledger.** `rails_executions` rows are inserted once and their outcome set once;
  facts follow the same append-mostly rule.

## Consequences

- Planned with the memory work (plan section 3): a temporal wrapper over the entity graph with `valid_from`,
  `invalid_at`, `invalidated_by` and a source. Nothing is built yet.
- Privacy deletion (account deletion, data export requests) still removes data; invalidation is about truth over
  time, not retention.
