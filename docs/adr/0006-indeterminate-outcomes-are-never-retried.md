---
status: accepted
---

# Indeterminate outcomes are never retried

When a side effect was sent and no answer came back, the outcome is `indeterminate`. We record it, never retry it
automatically, block new dispatches on the same target, and ask a person what happened through a Required Action.

## Why

The publish step used to turn any exception from the social scheduler into a failed job. A read timeout after the
POST is not a failure: the post may be live. A failed job is retryable, and `retry_video` is a MEDIUM tool the content
producer may call on its own. The likely result was the same video posted twice. The same holds for a budget change
whose platform call timed out, and for an approval whose scheduler spawn timed out.

Retrying is only safe when the upstream dedupes; ours do not promise to. Asking a person costs a minute; a double post
or a double spend costs trust.

## Decision

- **Classify by proof, not by hope** (`src/marketer/rails/outcomes.py`): never connected, no pooled connection, a 4xx
  answer, or a domain error raised before sending is `failed`; everything else (read timeouts, dropped connections,
  5xx, unknown exceptions) is `indeterminate`. A dispatch still open after 15 minutes lost its process and counts as
  indeterminate too.
- **Record and raise.** `Dispatch.run` records the outcome; an indeterminate one raises `OutcomeUnknown`, which routes
  answer as 502 `outcome_unknown: ...`.
- **Never retry.** HIGH/CRITICAL agent tools run with `retry: { maxAttempts: 1 }`; the agent turns an unknown outcome
  into `OUTCOME_UNKNOWN` ("do not call it again"); the harness ledger marks non-idempotent calls UNKNOWN so a replay
  returns `UNKNOWN_OUTCOME`; the backend refuses new dispatches on the target (`outcome_unknown`, 409) and refuses
  `retry_job` / `retry_image_post` while a post outcome is unresolved.
- **Ask a person.** The record appears in `GET /workspace/inbox` as a Required Action; only a person resolves it
  (`confirmed_succeeded` / `confirmed_failed`), which unblocks the target.

## Considered options

- **Retry with backoff.** Correct only with upstream idempotency, which the scheduler and ad platforms do not
  guarantee for us.
- **Poll the platform to find out.** The right long-term move per provider; not available uniformly today. A person
  checking is the fallback that always works.

## Consequences

- Some definite failures are misfiled as indeterminate (an upload timeout before the post call, a Modal error type we
  do not recognise). Each costs a person one look. We accept that cost over the opposite error.
- Code: `rails/outcomes.py`, `rails/enforce.py` (`Dispatch.run`, `assert_no_unresolved`), `rails/store.py`
  (`STALE_DISPATCH_MINUTES`), `backend/routes/workspace.py` (inbox, resolve),
  `agent/src/marketer/rails/enforce.ts` (`IndeterminateOutcomeError`). Tests: `tests/test_rails_core.py`,
  `tests/test_rails_routes.py`, `agent/test/marketer-rails.test.ts`.
