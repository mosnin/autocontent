---
status: accepted
---

# Decision models judge and code decides

A decision model answers small, observable questions about a state ("does the hook name a specific number?", "is
this caption about the playbook's topic?") with probabilities. Code turns those answers into an action with a truth
table: a pure function, versioned with its questions, with a unit test for every row. A model is never asked "should
we publish?" or "is this budget fine?".

## Why

- **The action is visible and testable.** A truth table in code can be read, reviewed and diffed. A prompt that
  returns "publish" or "hold" hides the policy inside a model nobody can unit-test.
- **Questions are measurable.** An atomic question has a ground truth we can label and score in promptfoo; a
  holistic verdict does not.
- **Thresholds move without retraining.** When a point is too strict we change a threshold in one versioned module,
  not a prompt.
- **Arithmetic, dates, caps and policy are not judgments.** They are computed in code, where they are exact.
  Word counts and spend never go to a model.

## Considered options

- **One "should we act?" prompt per point.** Simple to write, impossible to audit, and every wrong answer is a
  policy bug we cannot localise.
- **Rules only, no model.** Today's behaviour and the fallback for every point; it misses judgments a rule cannot
  express (relevance, tone).

## Consequences

- Questions, options, thresholds and model slugs live in one versioned module per language
  (`src/marketer/decisions/questions.py`, `agent/src/marketer/decisions/questions.ts`); truth tables in
  `tables.py` / `tables.ts`, tested row by row.
- Every decision is logged with the questions version, so a change in behaviour can be traced to a change in
  questions or thresholds.
- The execution rails follow the same split: `src/marketer/rails/policy.py` and
  `agent/src/marketer/rails/enforce.ts` (`evaluateAgentDispatch`) are pure truth tables over facts gathered by code.
