---
status: accepted
---

# A decision model can tighten, never loosen, a tier

A decision model may raise a risk tier, add a review, or hold a draft. It may never lower a tier, approve CRITICAL
work, or move money. A failed model call (timeout, error, abstain) is an error, never a "no" and never a "yes".

## Why

- **The reviewed tables stay authoritative.** `EXPECTED_RISK`, `RAILS_TOOLS` and the backend `ACTIONS` registry are
  the risk decisions a person made on purpose, in code review. A model that could lower them would make every tier a
  suggestion.
- **The cost of errors is asymmetric.** A model that holds a good draft costs a person a click. A model that waves
  through a bad post or a budget change costs money and reputation, and cannot be undone.
- **Prompt injection.** Content the model reads is partly written by third parties (captions, comments, provider
  errors). If a model's answer could loosen a gate, injected text could too.

## Considered options

- **Let a confident model skip approval on low-risk HIGH actions.** Faster for the person, but it turns the tier into
  a function of model confidence, which the harness already uses only to tighten (`confidenceThreshold`).

## Consequences

- The rails take no input from a model. `enforce_dispatch` and `enforceAgentDispatch` read tiers from frozen tables,
  caps from the database or schema ceilings, and kill switches from flags; nothing a model returns reaches them.
- Decision points that touch publishing or money run in `shadow` or tighten-only `enforce` (see the decisions
  modules); "UX and ranking" points fail open to today's rule.
- Lowering a tier is a code change with a test change: `EXPECTED_RISK` in `agent/test/marketer-tools.test.ts`, the
  rails tables, and `tests/test_rails_core.py`.
