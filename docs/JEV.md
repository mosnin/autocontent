# Jev harness — theory, install, and what marketer actually does

This is the install + theory document for the TypeSafe Jev decision layer
in marketer.sh. It covers why Jev is not an LLM, how the LangChain harness
pattern is applied, every pack that landed, where it is wired, and how to
turn it on without breaking the existing fail-closed ads path.

Primary sources:

- [TypeSafe introduction](https://docs.typesafe.ai/introduction)
- [System One primitives](https://docs.typesafe.ai/primitives)
- [Confidence](https://docs.typesafe.ai/confidence)
- [Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev)
- [awesomejev.com](https://awesomejev.com) (Foreman, jev-code, jev-search, pagegrade, jev-curate, opencompany)

The product code lives under `src/marketer/jev/`, `src/marketer/symbolic/`,
and `src/marketer/company_os/`. Nothing from those GitHub repos is vendored.
We ported the *decision contracts* and wrote marketer-owned policy.

---

## 1. Theory — Jev is System One, not a writer

Marketing is a pile of decisions:

- which idea wins the tournament
- which Qwen tier should write
- whether a QA-passed video is actually on-brief
- whether a publish tool is safe to fire
- whether tonight's niche window should spend a render
- whether an ad budget change is overreach

Those used to be chat completions that returned prose. The operator then
had to parse English, or the pipeline trusted a free-form "yes". That is
the wrong tool.

**Jev (TypeSafe System One)** answers only three typed questions:

| Primitive | Question shape | Answer |
| --- | --- | --- |
| **Noul** | Is this true? | `P(yes)` in `[0, 1]` |
| **Choice** | Which closed option? | label + probabilities + confidence |
| **Score** | Where on an ordered rubric? | integer level + legend + confidence |

Jev does **not** generate scripts, captions, brand rules, or knowledge
sentences. Output tokens are free because there are almost none. Official
list price is **$0.042 / MTok input**; output is free. The alias
`jev-latest` currently resolves to `jev-1.13.0`.

**Qwen via OpenRouter** is the writer (`qwen3-8b` / `qwen3-32b` /
`qwen3-235b-a22b`). Jev picks the cheapest tier that can do the work.

**OpenAI** is voice mode (Realtime WebRTC) plus last-resort generation
and the existing TTS / DALL-E / Whisper stack. Voice is not a decision
backend.

The LangChain post names the loop:

```
decide  →  act  →  evaluate
  Jev       Qwen / tools     Jev again (Foreman, QA, Auto Mode)
```

Code owns policy. Jev answers. A high-confidence wrong *kind* of answer
is still constrained to the closed set the code defined.

### Confidence is a second axis

A Choice of `"ads"` at confidence `0.2` is not a decision — it is a
guess. `jev/policy.py` maps that onto three paths:

- `confidence < floor` → **escalate** (usually to a human)
- `floor ≤ confidence < act_at` → **confirm**
- `confidence ≥ act_at` → **act**

Thresholds scale with the cost of being wrong. Cosmetic routing acts at
`0.7`. Money / legal routing acts at `0.85` and still cannot relax
`AdSpendGuard`.

Noul has no separate confidence: the probability *is* the belief
(`≥ 0.7` yes, `≤ 0.3` no, otherwise uncertain).

### Speculative fan-out

One HTTP call can carry many atomic questions. Code composes them
(`weighted_composite` for idea tournaments, Python `if`s for Foreman).
Asking "is this a good video?" hides three judgments. Asking hook /
payoff / freshness separately and picking the max in Python is the
harness.

### Fail-open content vs fail-closed ads

| Surface | If Jev is dark or errors |
| --- | --- |
| Ideation, QA, Foreman, research rank, SEO notes, curate, failures overlay, nightly HOLD, knowledge write | **Fail-open** — pre-Jev LLM / previous behavior |
| Publish Auto Mode after a human already approved | **Fail-closed** — a high-confidence `block` refuses |
| Ads budget / spend-affecting actions | **Fail-closed** via `AdSpendGuard`. Jev overlay can only *deny* or *force-approve*. It never relaxes a deterministic deny. Missing Jev is a no-op on the overlay. |

`jev_enabled` defaults to `true`. Each helper still no-ops unless a
TypeSafe or OpenRouter key is actually present (`available()`).

---

## 2. Install

### 2.1 Keys

From `.env.example` / Modal secrets:

| Variable | Role |
| --- | --- |
| `MARKETER_TYPESAFE_API_KEY` | TypeSafe System One. Also accepted as `TYPESAFE_API_KEY`. |
| `MARKETER_JEV_MODEL` | Default `jev-latest`. Pin `jev-1.13.0` once thresholds are tuned. |
| `MARKETER_JEV_FALLBACK_MODEL` | OpenRouter model that answers the same primitives when Jev is down. Default `qwen/qwen3-32b`. |
| `MARKETER_JEV_ENABLED` | Master switch. Default `true`. |
| `MARKETER_OPENROUTER_API_KEY` | Qwen generation + Jev fallback. |
| `MARKETER_QWEN_DEFAULT_MODEL` | Default writer when the router is skipped. |
| `OPENAI_API_KEY` | Voice Realtime + existing OpenAI providers. |

Empty TypeSafe key is not a boot failure. `ask()` tries Jev, then the
Qwen System One wrapper, then raises `DecisionUnavailable` only if both
are missing or both fail. Pipeline judges catch that and keep the
pre-Jev path.

### 2.2 Database

```bash
marketer-migrate up
# or: modal run modal_app.py::apply_migrations
```

Jev itself is stateless. The only new table is **`company_knowledge`**
(migration `0026_company_knowledge.sql`): verbatim spans the brain
extracted, keyed by `user_id`. Writes and reads **fail-open** if
`MARKETER_DATABASE_URL` is unset or the migration is pending.

### 2.3 Deploy

```bash
modal deploy modal_app.py
```

No extra Modal function is required for Jev. The cron `nightly_batch`
and `campaign_tick` call the same in-process helpers. Image-post
approval resume (`finish_image_post`) now passes `human_approved=True`
into the publish gate.

### 2.4 Preflight

`marketer` preflight (and the settings UI) reports:

- TypeSafe configured + model id
- OpenRouter fallback configured
- neither key → "decision harness dark"
- OpenAI voice ready

### 2.5 Verify the install

```bash
python3 -c "from marketer.jev import ask, available, route_model, auto_mode; from marketer.company_os import route_workspace, extract_constraints; from marketer.symbolic import assess; print('ok')"
python3 -m pytest tests/test_jev.py tests/test_security_web_hardening.py tests/test_mcp_server.py tests/test_preflight.py -q
```

Without keys, `GET /api/v1/jev/status` still returns 200 (auth required)
with `available: false`. Decision POSTs return **409**.

---

## 3. Package map

```
src/marketer/jev/
  primitives.py   Noul / Choice / Score + parse
  client.py       httpx POST https://api.typesafe.ai/v1/systemone
  fallback.py     Qwen structured-output wrapper (same primitives)
  ask.py          public ask() — Jev then Qwen, optional SpendContext
  policy.py       confidence gates + weighted_composite
  harness.py      route_model, auto_mode, next_action
  router.py       content-kind / skill / urgency
  decisions.py    domain packs (ideas, QA, ads, SEO, citations, knowledge)
  loops.py        product-loop adapters (fail-open except noted)
  __init__.py     public surface

src/marketer/symbolic/
  foreman.py      thruwire/foreman supervision policy
  jev_code.py     classify / find / check_changes / triage

src/marketer/company_os/
  opencompany.py  surface + durable-task + knowledge_write flag
  knowledge.py    extract verbatim spans, persist, prompt_block

src/marketer/repos/company_knowledge.py
db/migrations/0026_company_knowledge.sql
```

We speak the HTTP API directly. There is no `typesafe-sdk` dependency
(Python 3.11, same httpx stack as every other provider).

---

## 4. The decide → act → evaluate loop in this repo

### 4.1 Decide (Jev)

| Decision | Pack | Wired in |
| --- | --- | --- |
| Idea tournament | `judge_ideas` (hook / payoff / freshness composite) | `agents/ideation.py` |
| Video QA | `judge_video` | `orchestrator.run_qa` |
| Article QA | `judge_article` | `articles/llm.score_article` |
| Scriptwriter model | `route_model` / `default_generation_model` | `orchestrator.py` |
| Intent + company surface | `route_intent` + `route_workspace` | `POST /jev/route` |
| Knowledge write? | Noul on `route_workspace` | persist via `capture_from_state` |
| Span cluster | `classify_knowledge_spans` | knowledge brain |
| Ads overlay | `judge_ad_action` | `ad_actions_exec` after `AdSpendGuard` |
| Publish tool | `auto_mode` | video `_schedule_stage`, image `schedule_image_post` |
| Campaign / nightly next | `next_action` | `campaign_runner`, `nightly_batch` |
| Research rank | `rank_passages` | article pipeline after Exa |
| Citation audit | `audit_sources` | article QA |
| SEO metadata | `grade_seo_metadata` | article metadata stage |
| Library keep? | `curate_asset` | `media_archive` finals |
| Failure class | `triage_failures` | failures inbox |
| Foreman | `symbolic.foreman.assess` | after content QA |
| Repurpose target | `suggest_repurpose` | after video QA; spawn if article ≥ 0.7 |

### 4.2 Act (Qwen / tools / Modal)

Generation, render, Ayrshare, Modal spawn. Jev never does these.

High-confidence article remix (`should_spawn_repurpose`): create an
`articles` row and `run_article_pipeline.spawn`. Modal/DB failure is
logged; the video job still completes. The hint stays on `job.harness`.

### 4.3 Evaluate (Jev again)

Foreman watches QA evidence (`stop` / `retry` / `steer` / `verify`).
`stop` fails the job **only when Jev actually answered**. Foreman
exceptions fail-open.

Publish Auto Mode:

- autonomous path: `block` / `confirm` → park `awaiting_approval`
- human-approved path: `block` → **fail** (operator already said go;
  a high-confidence risk refuses rather than posting)

---

## 5. Company knowledge brain

Jev cannot write brand rules. The brain is extract-then-cluster:

1. Code flattens the route/pipeline state and splits on sentence
   boundaries (`candidate_spans`). Spans are verbatim, 12–400 chars,
   max 8 per turn.
2. Jev Choice-clusters each span:
   `brand_rule` / `constraint` / `decision` / `audience` / `noise`.
3. Noise and `confidence < 0.55` are dropped.
4. Surviving spans are inserted into `company_knowledge` (user-scoped).
5. `prompt_block(user_id)` injects the latest 12 rows into
   `_load_brand_voice` (video) and article tone.

`POST /jev/route` persists only when `company.knowledge_write` is true.
A missing table or pool error returns an empty write list and does not
409 the route.

---

## 6. HTTP / CLI / MCP / UI surfaces

All `/api/v1/jev/*` and `/api/v1/voice/*` routes require
`CurrentUser` (Clerk JWT or `mkt_` PAT). Unauthenticated calls are 401.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/jev/status` | keys + models, no spend |
| POST | `/api/v1/jev/ask` | raw primitives; ≤32 questions; state ≤24k chars |
| POST | `/api/v1/jev/route` | intent + model + company; optional knowledge write |
| GET | `/api/v1/jev/knowledge` | this user's spans + prompt block |
| POST | `/api/v1/jev/next-action` | ultrafast op + target |
| POST | `/api/v1/jev/auto-mode` | tool allow / confirm / block |
| POST | `/api/v1/jev/screen` | outbound content screen |
| POST | `/api/v1/jev/curate` | keep / discard |
| POST | `/api/v1/jev/ads/judge` | **judges only** — does not move money |
| POST | `/api/v1/jev/citations/verify` | one claim vs one source |
| POST | `/api/v1/jev/symbolic/foreman` | supervision verdict |
| POST | `/api/v1/jev/symbolic/code` | jev-code workflows |
| GET | `/api/v1/voice/status` | Realtime ready? |
| POST | `/api/v1/voice/session` | ephemeral `client_secret`; raw payload stripped to `id` / `object` |

CLI: `marketer jev status|route|knowledge`  
SDK: `MarketerClient.jev_status|jev_route|jev_knowledge|jev_ask`  
MCP: `jev_status`, `jev_route`, `jev_knowledge`  
Web: `/decisions` (route + backends + written spans), `/voice`

Decision POSTs return **409** when neither backend is configured, **502**
on a live backend error.

---

## 7. Security model

What this harness is allowed to do:

- **Judge.** Classify, score, park, skip a tick, refuse a publish,
  deny or force-approve an ad change that already passed `AdSpendGuard`.
- **Write verbatim knowledge** the authenticated user just submitted,
  scoped to `ctx.user_id`.
- **Spawn** a Press article from a finished video the same user owns,
  only at `confidence ≥ 0.7` and `target == article`.

What it is not allowed to do:

- Relax `AdSpendGuard`, kill-switch, or caps.
- Generate or rewrite knowledge / brand rules.
- Post to social without Auto Mode (and the existing niche
  `approve_before_post` ramp still applies).
- Read another user's `company_knowledge` or jobs.

Hardening on the HTTP surface:

- Auth on every Jev and voice route (see `tests/test_security_web_hardening.py`).
- State payloads capped at 24k serialized characters.
- Ask fan-out capped at 32 questions; next-action targets capped at 32.
- Knowledge spans capped at 800 chars; kinds must be in the allow-list.
- Voice session response does not echo the full OpenAI payload.
- Ads `/jev/ads/judge` never calls the platform. Execution stays in
  `ad_actions_exec`.
- Content loops catch Jev exceptions and continue. Ads overlay
  re-raises only `AdSpendDenied`.

Residual risk (accepted, documented):

- HTTP `/jev/ask` is an authenticated decision oracle. It is metered
  only when a pipeline `SpendContext` is passed; the REST judge itself
  does not open a niche spend context. Abuse is bounded by auth + size
  caps + TypeSafe rate limits.
- Knowledge spans are operator-authored text later injected into writer
  prompts. A user can prompt-inject *their own* generation. They cannot
  inject another tenant.
- Nightly HOLD is fail-open: if Jev is down, the cron still spawns.
  That is deliberate — a dark harness must not freeze publishing.

---

## 8. What was implemented (this branch)

Three landings on `cursor/jev-qwen-voice-harness-bce5`:

1. **Harness core** — client, fallback, ask, policy, primitives,
   router, Auto Mode, next_action, Foreman, jev-code, company route,
   OpenAI Realtime, `/decisions` + `/voice`, SDK/CLI/MCP, ideation/QA
   judges, ads overlay, Qwen-first scriptwriter, preflight.
2. **Product-loop wiring** — Foreman after QA, publish gate on video,
   campaign tick HOLD, Exa rank + citation + SEO notes, jev-curate,
   failures overlay, `Job.harness`.
3. **New surfaces** — `company_knowledge` brain, nightly window gate,
   image-post Auto Mode, high-confidence article remix spawn, knowledge
   injection into brand voice and article tone, HTTP size caps.

Tests: `tests/test_jev.py` (primitives, gates, packs, loops, knowledge,
image-post park, knowledge GET). Existing
`test_security_web_hardening` covers 401s. Campaign runner fixtures
mock `pending_work_count` so they do not need live Postgres.

---

## 9. Operator checklist

1. Set `MARKETER_TYPESAFE_API_KEY` (and OpenRouter if you want a
   fallback / Qwen writer).
2. `marketer-migrate up` through **0026**.
3. `modal deploy modal_app.py`.
4. Open `/decisions`, paste a brief, confirm backends show ready.
5. Confirm ads still fail-closed with Jev off
   (`MARKETER_JEV_ENABLED=false`) — `AdSpendGuard` is independent.
6. Optional: `marketer jev knowledge` after a route that produced a
   durable rule; the next video/article run should see the prompt block.
