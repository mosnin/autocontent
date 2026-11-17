---
status: proposed
---

# Learnings carry their evidence

A learning ("hooks that name a number beat hooks that don't on TikTok for this playbook") is stored with the evidence
behind it: which posts, which metrics, which window, how many samples. A learning without evidence is not stored.

## Why

- **Agents act on learnings.** If the content producer writes every hook with a number because of a learning, a
  person must be able to see why, and challenge it.
- **Evidence ages.** A learning from 12 posts in March may not hold in November; the evidence makes that visible.
- **No confident nonsense.** Requiring evidence stops a model's plausible guess from becoming policy.

## Consequences

- Planned with the memory work (plan section 3): a learnings table with evidence references to `post_metrics` rows and
  a window; today's performance context (`agents/performance_context.py`) is the starting point. Nothing is built yet.
- A learning never changes a risk tier or a cap (ADR 0002); it can shape drafts and rankings.
