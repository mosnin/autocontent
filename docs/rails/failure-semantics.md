# Outcomes and failure semantics

Every HIGH or CRITICAL dispatch ends in exactly one outcome. What we do next depends on which.

| Outcome | Meaning | Next |
|---|---|---|
| `succeeded` | The upstream answered yes | done |
| `failed` | We can prove nothing happened: the request never left, or the upstream answered no | may be tried again (the idempotency claim is released) |
| `indeterminate` | It was sent and no answer came back | **never retried**; target blocked; a person is asked |
| `denied` | The enforcement point refused before sending | fix the cause (switch, cap, approval), then try again |

## Telling failed from indeterminate

`src/marketer/rails/outcomes.py::classify`:

| Error | Outcome | Why |
|---|---|---|
| `httpx.ConnectError`, `ConnectTimeout`, `PoolTimeout` | failed | the request never left |
| HTTP 4xx (`HTTPStatusError`) | failed | a complete answer: rejected |
| A caller's domain error raised before sending, or from a complete answer (`AyrshareError`, `AdSpendDenied`) | failed | passed as `definite=` |
| `ReadTimeout`, `WriteTimeout`, other transport errors, `RemoteProtocolError` | indeterminate | it may have landed |
| HTTP 5xx | indeterminate | it may have landed before the error |
| `TimeoutError`, `ConnectionError`, anything else | indeterminate | unproven means unknown |
| A dispatch still open after 15 minutes (`STALE_DISPATCH_MINUTES`) | indeterminate | its process died mid-send |

The rule is asymmetric on purpose. Calling an ambiguous error "failed" invites a retry and a double post or double
spend. Calling a definite failure "indeterminate" costs a person a look. We accept the second error to avoid the first.

Agent side (`agent/src/marketer/rails/enforce.ts::isDefiniteRejection`): any 4xx except 408 and typed non-retryable
errors are definite; timeouts, network errors and 5xx (including the backend's 502 `outcome_unknown`) become
`IndeterminateOutcomeError`, whose message tells the model not to call the tool again and to send the person to the
inbox. It is deliberately not an `AgentError`, so the harness's idempotency ledger marks a non-idempotent call UNKNOWN
and a replay returns `UNKNOWN_OUTCOME` instead of executing.

## Where indeterminate can happen today

| Dispatch | Side effect | What "unknown" looks like |
|---|---|---|
| `content.post.send` (`pipeline.py::_schedule_stage`, `services/image_posts.py::schedule_image_post`) | POST to the social scheduler | job or carousel marked failed with `OutcomeUnknown: …`; Required Action "We can't confirm the post went out" |
| `content.video.approve`, `content.carousel.approve` | spawning the Modal scheduling function | 502 `outcome_unknown`; the row stays in `scheduling` until the reaper fails it |
| `ads.budget.change`, `ads.approval.execute` | the platform call (`apply_fn`) | 502; the stored budget is **not** changed (we never record a fake success) |
| `ads.campaign.activate` (via an approval) | the platform call | 502; campaign not marked active |

## Never retried, concretely

- HIGH/CRITICAL agent tools: `retry: { maxAttempts: 1 }` and `OUTCOME_UNKNOWN`.
- The backend refuses new dispatches on the target (409 `outcome_unknown`) except those that reduce exposure.
- `POST /jobs/{id}/retry` and `POST /image-posts/{id}/retry` refuse (409) while the post outcome of that video or
  carousel (`video_post`, `carousel_post` targets) is unresolved, before spending credits on a re-render.
- The ads optimizer (Inngest) may retry its step; the retry is refused by the unknown-outcome check and returns
  `denied`.

## Fail closed, fail open

| Path | On missing or failing dependency | Why |
|---|---|---|
| Money and publishing (everything in the rails) | closed: refuse, 503 or 402 | cannot be undone (ADR 0003) |
| Reading Required Actions for the inbox | open: inbox loads without them, logged | a read must not take the inbox down |
| Recording an outcome after the side effect | logged at ERROR, never raises | the side effect already happened or not; raising would hide its result |
| Recording a denial | best effort | the refusal stands without its record |
| Modal spawn dedupe store (`services/idempotency.py`) | open (unchanged) | spend re-checks are the backstop there |
| Decision models on UX and ranking points | open to today's rule | see the decisions modules |

## The agent's side

The agent's API client (`agent/src/marketer/api.ts`) applies the same rules before a request leaves the Worker. Full audit: `docs/security/agent-audit.md`.

- **Writes are sent once.** Every write tool has `maxAttempts: 1` and refuses to send without an idempotency key. Only GETs are retried: at most three attempts, with jitter, inside a 20 second deadline.
- **A write with no clear answer is unknown, not failed.** A timeout or any 5xx on a write reaches the model as `OUTCOME_UNKNOWN`, so it does not try again.
- **A breaker per API origin.** After five failures in a row it opens for 30 seconds. Writes are only sent while it is closed, so a write refused by the breaker was never sent.
- **Typed errors.** Tool errors start with one of `DENIED`, `NEEDS_APPROVAL`, `OUTCOME_UNKNOWN`, `TEMPORARILY_UNAVAILABLE`, `NOT_FOUND`, `CONFLICT`, `INVALID_INPUT`, `NOT_CONFIGURED`. Backend error text is wrapped as untrusted content.
- **Department quota.** Each department may make 10 calls per tool and 40 in total per run. Outside a delegated task (a bus message or a room turn), nothing above LOW risk runs without the owner.
