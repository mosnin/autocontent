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

## The contract

Every decision is one HTTPS request to OpenRouter. The full contract, with a source for every point and what is
still unverified, is in [docs/decisions/openrouter-contract.md](../decisions/openrouter-contract.md). In short:

- **Request:** `POST https://openrouter.ai/api/alpha/decisions` with `{ model, state, questions }`. A yes/no question
  is `noul`. A choice sends its options, and a score its ordered levels, as `criteria`.
- **Response:** `{ model, answers, usage }`. Each answer carries its `type`. `noul` is the probability of yes.
  A choice has `choice`, `confidence` and `probabilities`. A score is the expected level, from 0 to N-1.
- **Cost:** `usage.cost`, in USD. A response without it is a failure.
- **Models:** `typesafe/jev-1.13-20260917` for every point (D1). `jaredpalmer/kev-4b-20260924` as the second tier
  for batch scoring (D0). Dated slugs only: a new model moves every tuned threshold.
- **Failure:** a timeout, an HTTP error, a refused question, a missing or malformed answer and a missing cost are
  all typed failures. A failure sends the caller to the point's fallback. It is never a "no".

Three clients speak it. The agent and the backend call the Decisions route directly and replay the same golden cases
(`docs/decisions/conformance/`), so they cannot drift apart. The onboarding route goes through the TypeSafe SDK to
OpenRouter's System One route, which returns the same envelope.

## Decision points

| # | Point | Runs in | Mode setting | Timeout | A failed call |
|---|---|---|---|---|---|
| 1 | `routing` | agent | `DECISION_MODE_ROUTING` | 800 ms | today's routing (open) |
| 3 | `what_to_post` | backend | `MARKETER_DECISION_WHAT_TO_POST_MODE` | 2 s, second tier | the judge's pick (open) |
| 4 | `hook_score` | backend | `MARKETER_DECISION_HOOK_SCORE_MODE` | 1.5 s | proceed (open) |
| 5 | `budget_shift` | backend | `MARKETER_DECISION_BUDGET_SHIFT_MODE` | 2 s | today's guarded, approval-gated rule (closed) |
| 6 | `approval_risk` | agent | `DECISION_MODE_APPROVAL_RISK` | 1 s | a person decides (closed) |
| 7 | `onboarding_preselect` | web | `DECISION_MODE_ONBOARDING_PRESELECT` | 1.5 s | the spec's `preselectWhen` rules (open) |
| 9 | `qa_video`, `qa_article` | backend | `MARKETER_DECISION_QA_VIDEO_MODE`, `…_QA_ARTICLE_MODE` | 3 s | today's QA, which still gates (closed) |
| 11 | `memory_gate` | agent | `DECISION_MODE_MEMORY_GATE` | 400 ms | today's rule (open) |
| 12 | `autopilot` | agent | `DECISION_MODE_AUTOPILOT` | 1.5 s | today's rule (open) |

Questions, thresholds, timeouts and versions live in one module per side: `agent/src/marketer/decisions/questions.ts`
and `src/marketer/decisions/questions.py`. Truth tables are next to them in `tables.ts` and `tables.py`.

## Modes

Each point is `off`, `shadow` or `enforce`.

| Mode | The model is called | What acts | Logged |
|---|---|---|---|
| `off` | no | today's rule | nothing |
| `shadow` | yes | today's rule | the answers, what the table would have done, and what was done |
| `enforce` | yes | the truth table, which can only tighten | the same |

With no `OPENROUTER_API_KEY`, every point is `off` and nothing is called, metered or logged. With a key, every point
starts in `shadow`, except onboarding pre-selection, which starts in `enforce` because it only changes which option
is pre-selected.

How a mode is resolved, first match wins:

| Side | Order |
|---|---|
| Agent | no key → `off`; `DECISION_MODE_<POINT>`; `DECISION_MODES` (for example `routing=enforce,*=shadow`); `shadow` |
| Backend | no key → `off`; `MARKETER_DECISIONS_MODE=off` (kill switch); `MARKETER_DECISION_<POINT>_MODE`; feature flag `decision.<point>.off`; feature flag `decision.<point>.enforce`; `MARKETER_DECISIONS_MODE`; `shadow` |
| Web | no key → `off`; `DECISION_MODE_ONBOARDING_PRESELECT`; `enforce` |

Other settings:

| Setting | Side | Default |
|---|---|---|
| `OPENROUTER_DECISIONS_URL` | agent, backend | `https://openrouter.ai/api/alpha/decisions` |
| `DECISION_MODEL` | agent, web | `typesafe/jev-1.13-20260917` |
| `MARKETER_DECISIONS_MODEL` | backend | `typesafe/jev-1.13-20260917` |
| `MARKETER_DECISIONS_MODEL_D0` | backend | `jaredpalmer/kev-4b-20260924` |
| `MARKETER_DECISIONS_KEYFRAMES` | backend | on. `off` drops the image check from video QA and keeps the text checks |

## Metering and the log

- **Backend.** Every call is metered into `spend_ledger` as `openrouter` / `decision:<model>` at the cost OpenRouter
  returned, behind the same pre-flight cap and credit check as any other spend. Calls inside a job use the job's
  spend context. Point 5 has no job and no niche: it writes a niche-less row attributed to the ad campaign, which
  needs migration 0028. On a database without it the row is refused, the client logs
  `decision metering skipped: spend_ledger needs a nullable niche_id` and the decision stands.
- **Every side** writes one line per call that ran: point, mode, model, questions version, a hash of the state (never
  the state), the answers, whether the fallback was used and why, latency, cost and the action taken. The backend
  and the agent write to `decision_log` (read it with `GET /api/v1/decisions?point=<point>`). The onboarding route
  writes a structured `decision` line to the server log, with `cost`, `tokens` and `failure`.

Known gap: `spend_ledger.cost_usd` keeps four decimals and a text decision costs about 0.00002 USD, so the ledger row
rounds to 0. The exact cost is in `decision_log.cost_usd`, which keeps eight. Fixing the ledger needs a migration.

## The second tier

One point, `what_to_post`, gets a second try on the D0 model when its model is down: a timeout, a network error, or
HTTP 408, 429 or 5xx. It is batch scoring next to the ideation judge, off the hot path, and it fails open.

No other point switches model by itself. Thresholds are tuned per model, so a point that gates money or publishing
answers on the model it was tuned on or falls back to its rule. A bad request, a bad key, no credits, a refusal and
a malformed answer never trigger the second tier: another model would not fix them, or must not paper over them.
The answer is logged and metered under the model that gave it.

D0 reads text only and has an 8,192-token context. A batch that does not fit is a `400`, which fails open to the
judge's pick.

## Video QA keyframes

Point 9 can look at the rendered video. `verify_video(..., video_path=...)` samples three frames with ffmpeg, scales
them into the model's size window, sends them in the state, and asks one more check, `garbled_text`: does any frame
show garbled, misspelled or unreadable on-screen text? It bounces when that is more likely than not
(`VIDEO_GARBLED_MIN`, 0.5), a looser bar than the text checks until it has been tuned on shadow data.

No frames (no path, an unreadable file, no ffmpeg, the kill switch) means today's text-only verify. Three frames add
about 0.0002 USD and 4,800 input tokens to the call.

The pipeline does not pass the video path yet, so the check is not asked in production. To wire it, forward the
rendered file's path from `verify_report` in `src/marketer/agents/qa.py` and its caller in `src/marketer/pipeline.py`.

## Turning a point on: off → shadow → enforce

**Before anything**

1. Set a spend limit on the OpenRouter key, and use a key that is only for decisions.
2. Check the contract still holds for the pinned model:
   `cd agent && OPENROUTER_API_KEY=... node --experimental-strip-types evals/decisions/contract-check.ts`.
   It must print `ok`. The endpoint is alpha.
3. Backend only: confirm migrations are applied through 0028 (`python scripts/migrate.py up`).

**Off → shadow**

4. Set `OPENROUTER_API_KEY` on the side that runs the point (Worker secret, backend env, web env). That moves every
   point on that side to shadow. To start with one point, switch the others off in the same deploy:
   - agent: `DECISION_MODES=*=off` and `DECISION_MODE_<POINT>=shadow`;
   - backend: `MARKETER_DECISION_<OTHER_POINT>_MODE=off` for each other point. Do not use `MARKETER_DECISIONS_MODE=off`
     for this: it is the kill switch and beats every per-point setting.
5. Make one real request through the point and find its row: `mode = shadow`, `fallback_used = false`,
   `cost_usd` set, `action_taken` equal to `rule_action`. If `fallback_used` is true, read `reason`:
   `http: 401` is the key, `http: 402` credits, `http: 400` the model slug or the request, `timeout` the budget.
6. Leave it in shadow until there is enough to judge: at least a week and a few hundred rows for the point.

**Shadow → enforce: all of these must hold**

7. Failure rate. The share of rows with `fallback_used = true` and a `reason` is low and stable. A point that times
   out often is not ready: in enforce a fail-closed point sends every one of those to a person.
8. Agreement. Compare `table_action` with `rule_action` on the shadow rows, and read a sample of the rows where they
   differ. Every difference must be a tightening you agree with. For points 1 and 6, also run the labelled suites
   (`cd agent && pnpm evals:decisions`) and meet the precision bar you set for the point.
9. Thresholds. They are tuned for the pinned model and the current questions version. If you change either, the
   shadow data starts again.
10. Cost. Sum `decision_log.cost_usd` for the point over the shadow period and decide it is worth it.
11. For `budget_shift` and `approval_risk`, confirm who gets the alert or the approval when the table tightens, and
    that they know it is coming.

**Enforce**

12. Set the point's mode to `enforce` (the env var, or the backend feature flag `decision.<point>.enforce`).
    One point at a time.
13. Watch the first day: the rate of tightening actions (holds, bounces, escalations) should match what shadow
    predicted. If it does not, go back to shadow.

**Going back**

- One point: set its mode to `shadow` or `off` (backend: the flag `decision.<point>.off` beats `enforce`).
- Everything on the backend: `MARKETER_DECISIONS_MODE=off`.
- Everything on a side: remove `OPENROUTER_API_KEY`.

Going back is always safe: `off` is exactly today's behaviour.

## Adding a point

1. Write the questions in the side's questions module: atomic and observable, one judgment each. Arithmetic, dates,
   caps and counts stay in code and reach the model as stated facts.
2. Write the truth table as a pure function and test it row by row. It may only tighten.
3. Give the point a timeout, a fail mode (open for ranking and UX, closed for money and publishing) and a version.
   It starts in shadow.
4. Add the glue that builds the state, calls `decide` and logs the rule's action, the table's action and what was
   done. Test four cases: no key, shadow, enforce, and a failed call.
5. If the point needs a new wire shape (a new question type, a new input), add a golden case to
   `docs/decisions/conformance/` first and make both clients pass it.
6. Add its row to the table above.

ADRs 0001, 0002 and 0008 record the principles.
