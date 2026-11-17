"""Decision layer for the backend pipelines.

A decision model answers typed questions (yes/no, choice, score) about some
state with probabilities. Code turns those answers into an action through a
truth table. Three modules:

- ``questions``: every question, option, threshold, timeout and model slug,
  versioned per decision point. The only place they live.
- ``tables``: pure functions from answers (plus facts computed in code) to an
  action. Unit-tested row by row.
- ``points``: per-point glue that builds the state, calls
  ``services.decisions.decide`` and applies the table under the point's mode.

The HTTP client, mode resolution, metering and the decision log live in
``marketer.services.decisions``. A model is an optimization, never a
dependency: with no key every point is ``off`` and behaves exactly as before.
"""
