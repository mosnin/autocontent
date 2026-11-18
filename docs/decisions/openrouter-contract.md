# The OpenRouter Decisions contract

What Marketer's decision clients send to OpenRouter and what they accept back. Every point is marked **verified**
(with how) or **unverified**. Checked on 2026-11-18 against the public docs, the installed SDK source and 19 small
live calls with the pinned models.

Three clients speak this contract:

| Client | Where | Route it calls |
|---|---|---|
| Agent Worker (TypeScript) | `agent/src/marketer/decisions/client.ts` | `POST /api/alpha/decisions` |
| Backend (Python) | `src/marketer/services/decisions.py` | `POST /api/alpha/decisions` |
| Onboarding route (TypeScript, TypeSafe SDK) | `web/app/api/onboarding/decisions/route.ts` through `.intent-onboarding/packages/decisions-jev` | `POST /api/v1/systemone` |

The golden cases in [`conformance/`](conformance/) pin the first two to each other (see [Conformance](#conformance)).
For how the modes work and how to turn a point on, see [decision-models.md](../rails/decision-models.md).

## What was wrong before this check

| Was | Is | Effect of the old value |
|---|---|---|
| Python sent choice options as `options` and score levels as `levels` | Both travel as `criteria` | The API answered `400` to every backend request with a choice or a score, so points 3, 4, 5 and the article grounding check always took the fallback |
| Python read a score above 1 as a level index and a score at or below 1 as already on a 0..1 scale | A score is always a level index from 0 to N-1 | A weak hook scored 0.9 on a five-level scale (really 0.23) read as 0.9 and passed the weak-hook bar |
| Python read tokens from `usage.total_tokens` | `usage.input_tokens + usage.output_tokens` | Every ledger row carried 1 unit |
| D0 model `kev-4b` | `jaredpalmer/kev-4b-20260924` | The bare slug does resolve today, but it is not pinned and not in the model list |
| Answers were read without their `type` | The `type` must match the question | A refused question (`type: "refusal"`) was a generic parse error in the direct clients, and reached the onboarding flow as `NaN` |

## Endpoints

| Point | Status | Source |
|---|---|---|
| `POST https://openrouter.ai/api/alpha/decisions` takes plain HTTP with `Authorization: Bearer <OpenRouter key>` and `Content-Type: application/json` | **verified** | [Decisions guide](https://openrouter.ai/docs/guides/features/decisions.md), [API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md), live |
| The path is alpha and "the shape may change" | **verified** | API reference. Kept configurable: `OPENROUTER_DECISIONS_URL` |
| `POST https://openrouter.ai/api/v1/systemone` is a second route with TypeSafe's request and response shapes, for the TypeSafe SDK with `baseURL: "https://openrouter.ai/api"` | **verified** | [TypeSafe SDK guide](https://openrouter.ai/docs/guides/community/typesafe-sdk.md); SDK source (`dist/index.mjs`: `POST /v1/systemone`); live |
| Both routes return the same envelope, `usage.cost` included | **verified** | Live, same request on both |
| The System One route accepts the zstd-compressed bodies the SDK sends for requests of 1 KiB or more | **verified** | Live, through `@typesafe-ai/sdk@0.7.0` on Node 22 |
| The Decisions route accepts a compressed body | **unverified** | Not tried. The two direct clients send plain JSON |
| The chat endpoint rejects decision models | **unverified** | Stated in `docs/research/EVALUATION.md`; not tried, nothing depends on it |

## Request

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "state": { "ticket": "I was charged twice." },
  "questions": {
    "refund":  { "type": "noul",   "instructions": "Is the customer asking for money back?" },
    "team":    { "type": "choice", "instructions": "Which team should handle this?",
                 "criteria": { "billing": "Charges and refunds", "technical": "Bugs and outages" } },
    "urgency": { "type": "score",  "instructions": "How urgent is this?",
                 "criteria": ["can wait", "this week", "right now"] }
  }
}
```

| Point | Status | Source |
|---|---|---|
| `model`, `state` and `questions` are required | **verified** | OpenAPI `DecisionsRequest` |
| `state` is a string, an object or an array | **verified** | OpenAPI; live with an object and with a string |
| A yes/no question is `type: "noul"`; `criteria: {true, false}` is optional | **verified** | OpenAPI `DecisionsNoulQuestion`; live |
| A choice is `type: "choice"` with `criteria` as a map of option to description (or `null`) | **verified** | OpenAPI; live. `options` is rejected with `400` (live) |
| A score is `type: "score"` with `criteria` as an ordered list of levels, lowest first | **verified** | OpenAPI; live. `levels` is rejected with `400` (live) |
| A fourth type, `box`, locates something in an image; Jev 1.14 only | **verified** by docs | [Jev guide](https://openrouter.ai/docs/guides/community/jev.md). Not used |
| Optional fields: `assets`, `provider`, `session_id`, `user`, `trace` | **verified** by docs | OpenAPI. Not sent |
| Nesting in `state`, `instructions` and `criteria` is limited to 64 levels | **verified** by docs | Decisions guide |

Our vocabulary maps one to one: `yesno` → `noul`, `choice.options` → `criteria`, `score.levels` → `criteria`.

## Response

```json
{
  "id": "gen-dec-…",
  "model": "typesafe/jev-1.13-20260917",
  "provider": "TypeSafe",
  "answers": {
    "refund":  { "type": "noul", "noul": 0.81 },
    "team":    { "type": "choice", "choice": "billing", "confidence": 1,
                 "probabilities": { "billing": 1, "technical": 0 } },
    "urgency": { "type": "score", "score": 1.18, "confidence": 0.66,
                 "legend": { "0": "can wait", "1": "this week", "2": "right now" },
                 "probabilities": { "0": 0.03, "1": 0.77, "2": 0.2 } }
  },
  "usage": { "input_tokens": 378, "output_tokens": 62, "cost": 0.000015876, "is_byok": false,
             "cost_details": { "upstream_inference_cost": 0.000015876 } }
}
```

| Point | Status | Source |
|---|---|---|
| Every answer carries `type`, one of `noul`, `choice`, `score`, `box`, `refusal` | **verified** | OpenAPI `DecisionsResponse`; live for the first three |
| `noul` is the probability of yes, 0 to 1 | **verified** | Docs; live |
| A noul answer from Jev and Kev has no `confidence` | **verified** | Live. The schema allows one and the guide's example shows one |
| `choice` is the winning option; `probabilities` covers every option; `confidence` says how concentrated the distribution is, not how likely the answer is right | **verified** | [Jev tutorial](https://openrouter.ai/docs/guides/community/jev-tutorial.md); live (0.95 probability came with 0.89 confidence) |
| `score` is the expected level on the 0-indexed scale, from 0 to N-1, and may fall between levels | **verified** | Decisions guide ("0–2 scale … 1.84"); live |
| `confidence` and `probabilities` are optional in the schema for choice and score | **verified** by docs | OpenAPI. Jev and Kev always sent both (live) |
| A refused question comes back as `{ "type": "refusal" }` while the others are answered | **verified** by docs | Decisions guide. Never seen live |
| `model` is the dated slug of the model that answered | **verified** | Live |
| No rate-limit headers on a successful response; `x-generation-id` is set | **verified** | Live; [limits](https://openrouter.ai/docs/api_reference/limits.md) |

### What the clients do with it

Every rule below is a golden case in `conformance/`.

- The answer's `type` must be the one the question asked for. A refusal fails the whole call as `refused`; a missing
  answer, another type, a number that is not a JSON number or is out of range fails it as `invalid`. A failure sends
  the caller to the point's fallback. It is never read as a "no".
- `noul` → `{ type: "yesno", probability }`.
- `choice` → `{ type: "choice", choice, confidence, probabilities }`. The choice must be one of the options sent.
  `confidence` is required: the tables read it. An option with no probability reads as 0; with no map at all the
  chosen option carries the confidence.
- `score` → the level index, 0 to N-1. `confidence` is required. The agent and onboarding contract keeps the level
  index as `score`. The backend keeps it as `level` and gives `score` on a 0..1 scale (`level / (N-1)`), which is
  what its tables read.
- Answers nobody asked for and unknown top-level fields are ignored.

## Cost

| Point | Status | Source |
|---|---|---|
| `usage.cost` is what OpenRouter charged for the request, in credits (USD) | **verified** | OpenAPI ("in credits"); guide ("always reports the exact credits charged"); live |
| `usage.cost` is optional in the schema | **verified** by docs | OpenAPI: only `input_tokens` and `output_tokens` are required. Every live response had it |
| Tokens are `usage.input_tokens` and `usage.output_tokens`; there is no `total_tokens` | **verified** | OpenAPI; live |
| Jev and Kev bill input tokens only, at 0.042 USD per million | **verified** | [Models API](https://openrouter.ai/api/v1/models?output_modalities=decisions); live (378 tokens → 0.000015876) |
| A text decision costs about 0.00002 USD; a video verify with three frames about 0.0002 USD | **verified** | Live |
| The TypeSafe SDK passes `usage.cost` through, though its `Usage` type does not declare it | **verified** | SDK guide; live through the SDK |

A response without a usable `usage.cost` is a failure (`no_cost`): a call we cannot price is a call we do not trust.
A cost of 0 is a cost (free variants).

## Models

`GET https://openrouter.ai/api/v1/models?output_modalities=decisions` listed 44 decision models on 2026-11-18. The
ones this code names:

| Role | Slug we send | Lists as | Input | Context | Status |
|---|---|---|---|---|---|
| D1, every point | `typesafe/jev-1.13-20260917` | `typesafe/jev-1.13` | text, images | 262,144 | **verified**: the dated slug is the model's canonical slug and is accepted as `model` (live) |
| D0, second tier for batch scoring | `jaredpalmer/kev-4b-20260924` | `jaredpalmer/kev-4b` | text only | 8,192 | **verified** the same way |

| Point | Status | Source |
|---|---|---|
| The bare slug `kev-4b` resolves to `jaredpalmer/kev-4b` | **verified** | Live. Not relied on |
| `typesafe/jev-1.14` and the alias `~typesafe/jev-latest` exist; 1.13 "is still available" | **verified** by docs | Jev guide; Models API. We stay on the dated 1.13 slug: a new model moves every tuned threshold |
| The System One route also takes bare TypeSafe ids (`jev-1.13` → `typesafe/jev-1.13`) and uses a prefixed id as it is | **verified** | SDK guide; live with the dated slug |
| How long OpenRouter keeps serving a dated slug | **unverified** | Not documented. Kept configurable: `DECISION_MODEL`, `MARKETER_DECISIONS_MODEL`, `MARKETER_DECISIONS_MODEL_D0` |
| Kev was slower than Jev: 0.5 to 1.3 s against 0.2 to 0.5 s | **verified**, small sample | Live, from one network location |
| Probabilities differ between models on the same question, so thresholds are per model | **verified** by docs | Jev guide; live (same ticket: refund 0.81 on Jev, 0.58 on Kev) |

Cheaper or larger candidates for D0, none of them tried: `perplexity/pplx-decider-flash-v1.2` (0.01 USD per million,
262,144 context), `liquid/d1.2`, `cloudflare/clef-flash`.

## Images

| Point | Status | Source |
|---|---|---|
| An image is a part `{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }` in `state` | **verified** | [Multimodal guide](https://openrouter.ai/docs/guides/community/multimodal-decisions.md); live |
| Jev reads image parts at any depth inside `state`; most other models only at the top level of a `state` array | **verified** for Jev | Guide; live with `state.keyframes[…]` |
| Jev takes PNG and JPEG only | **verified** by docs | Guide |
| Each side 256 to 1,568 px and 78,400 to 2,458,624 px in total. Smaller is a `400`, larger a `413` | **verified** | Guide; live (`256×256` → `400 Invalid image dimensions`, `320×320` → `200`) |
| Three 576×1024 JPEG frames add about 4,800 input tokens | **verified** | Live |
| Image input is an early feature whose format and limits can change | **verified** by docs | Guide. Kill switch: `MARKETER_DECISIONS_KEYFRAMES=off` |
| The SDK's `image()` helper works through OpenRouter | **unverified, expected not to** | The SDK sends images as multipart; OpenRouter documents that "the multipart `part` field is not accepted". Not used |
| D0 (Kev) reads text only | **verified** by docs | Models API. Images are only ever sent on D1 |

## Errors

```json
{ "error": { "code": 400, "message": "Model nobody/not-a-model does not exist", "metadata": { } }, "user_id": "…" }
```

| Point | Status | Source |
|---|---|---|
| Errors are `{ error: { code, message, metadata? } }` and the HTTP status equals `error.code` | **verified** | [Errors](https://openrouter.ai/docs/api_reference/errors-and-debugging.md); live for 400 and 401 |
| A `400` for a malformed question puts a JSON string listing the offending paths in `error.message` | **verified** | Live |
| A `400` body can carry the account's `user_id` | **verified** | Live. So error bodies are never logged or returned: the clients keep the status only |
| A provider's rejection is passed on in `error.message` (`"HTTP 400: {…}"`) | **verified** | Live, with an image below the size limit |
| `400` invalid request or unknown model, `401` bad key, `402` no credits, `403` forbidden or a spent budget, `413` too large, `429` rate limited, `502` provider failed, `503` no provider, `524` edge timeout, `529` provider overloaded | **verified** by docs | OpenAPI; 400 and 401 live |
| `429` and `503` may carry `Retry-After`; so may a `402` whose `error.metadata.limit_source` is `openrouter_in_flight_budget` | **verified** by docs | Errors page. Never seen live |

Client failure kinds: `no_key`, `timeout`, `network` (`transport` in Python), `http` (with the status), `invalid`,
`refused`, `no_cost`. The TypeScript client also has `aborted`, for a caller that cancels.

## Rate limits

| Point | Status | Source |
|---|---|---|
| A paid model has no platform request cap | **verified** by docs | [Limits](https://openrouter.ai/docs/api_reference/limits.md) ("the paid variant of the model … has no platform-level request cap") |
| Free variants (`:free`): 20 requests a minute, and 50 a day (1,000 a day once 10 credits were ever bought) | **verified** by docs | Limits. We pin paid models |
| A provider can still answer `429` when it is at capacity; OpenRouter tries other providers of the model first | **verified** by docs | Limits |
| Accounts with a low balance have an in-flight spending budget; over it is a `402` with `Retry-After` | **verified** by docs | Limits |
| A key can have its own credit limit; `GET /api/v1/key` shows what is left | **verified** | Limits; live (200) |
| The limit, if any, that Jev or Kev apply themselves | **unverified** | Not published. 19 calls in a few minutes met none |

No client retries on the hot path. A `429` is a failure like any other and the caller takes its fallback. The one
second try is the second tier for batch scoring (see decision-models.md).

## Conformance

`conformance/` holds one JSON file per case plus `contract.json`, which lists them and names the endpoint and the
two models. A case is:

```
questions, state, model   the request in our vocabulary
wire_request              the exact body the client must send
response                  status and body (or raw text), recorded live or taken from the docs
expect                    { ok: true, answers, cost, tokens, model }  or  { ok: false, kind }
```

Both suites load the same files:

- `agent/test/decisions.conformance.test.ts` (`cd agent && pnpm test`)
- `tests/test_decisions_conformance.py` (`.venv/bin/python -m pytest -q tests/test_decisions_conformance.py`)

To change the mapping, change a case first, then both clients. A case only one client can pass is a bug in the
case or in the other client.

The onboarding route does not replay the cases. It goes through the vendored adapter and the SDK, and applies the
same answer rules in `answerProblem` in the route.

## Checking it again

The endpoint is alpha. To check the contract still holds for a model, with a real key:

```bash
cd agent && OPENROUTER_API_KEY=... node --experimental-strip-types evals/decisions/contract-check.ts
# or name models: … contract-check.ts typesafe/jev-1.13-20260917 jaredpalmer/kev-4b-20260924
```

It sends one question of each type through the production client, prints the failure kind when the response no
longer parses, and exits non-zero. Each run costs well under a cent.
