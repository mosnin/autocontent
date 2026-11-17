# Decision models and the rails

Decision models (a separate workstream: `src/marketer/decisions/`, `agent/src/marketer/decisions/`,
`src/marketer/services/decisions.py`) answer atomic questions with probabilities; code turns answers into actions with
truth tables. This page is only about where they meet the rails.

## The rule

A decision model can tighten, never loosen (ADR 0002):

| A model may | A model may never |
|---|---|
| raise a risk tier, add a review, hold a draft | lower a tier, skip an approval, approve CRITICAL work |
| fail open to today's rule on UX and ranking points | move money or publish on its own judgment |

## How the rails keep that true

- The rails read **no** model output. Tiers come from frozen tables (`rails/actions.py`, `rails/registry.ts`), caps
  from the database and schema ceilings, kill switches from flags and env. There is no parameter through which a
  model's answer could reach `enforce_dispatch` or `enforceAgentDispatch`.
- A decision point that wants to tighten acts **before** the rails (holding a draft, asking for review), so the rails
  still see the same action with the same tier.
- A failed decision call on a money or publishing point sends the action to a person (fail closed); it never reaches
  the rails as an allowed action it would not otherwise have been.

## Modes and adding a point

Per-point modes (`off | shadow | enforce`), thresholds, question versions and how to add a point are documented with
the decisions code itself. ADRs 0001, 0002 and 0008 record the principles.
