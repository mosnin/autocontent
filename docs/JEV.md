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
| Idea pick among templates | `judge_ideas` (hook / payoff / freshness composite) | `agents/ideation.py` |
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

OpenAI keys: pydantic settings use the `MARKETER_` prefix, so voice and
the Agents SDK read `MARKETER_OPENAI_API_KEY`. The `.env.example` line
`OPENAI_API_KEY=` is for the official SDK default; set **both** if you
want voice + DALL-E/TTS/Whisper through marketer settings. TypeSafe
accepts either `MARKETER_TYPESAFE_API_KEY` or `TYPESAFE_API_KEY`.

---

## 10. Debug sweep (install correctness)

Re-run on this tree (no TypeSafe/OpenRouter keys in the cloud agent):

```
python3 -c "from marketer.jev import ask, available, route_model, auto_mode, next_action, publish_gate, should_spawn_repurpose; from marketer.company_os import route_workspace, extract_constraints, capture_from_state, prompt_block; from marketer.symbolic import assess; from marketer.symbolic.jev_code import classify_request; from marketer.repos import company_knowledge; from backend.routes import jev, voice_mode; print('ok', available())"
```

Expected without keys: `ok False`. That is correct — the harness is
installed and dark.

Registered HTTP paths (from `create_app().openapi()`):
`/api/v1/jev/status`, `/ask`, `/route`, `/knowledge`, `/next-action`,
`/auto-mode`, `/screen`, `/curate`, `/ads/judge`, `/citations/verify`,
`/symbolic/foreman`, `/symbolic/code`, plus `/api/v1/voice/status` and
`/session`.

Wiring checklist (each pack has a production caller):

| Pack | Caller exists |
| --- | --- |
| `judge_ideas` | `agents/ideation.py` |
| `judge_video` | `orchestrator.py` |
| `judge_article` | `articles/llm.py` |
| `plan_video_run` | `pipeline.py` (one fan-out; scriptwriter model + skip hints) |
| `script_to_words` | `pipeline.py` caption stage (Whisper is fallback only) |
| `articles.fastpath` | topic / SERP / schema / interlink / hero |
| `default_generation_model` | `orchestrator.py` |
| `after_content_qa` + `repurpose_hint` | `pipeline.py` |
| `publish_gate` | `pipeline._schedule_stage`, `image_posts.schedule_image_post` |
| `campaign_tick_gate` | `campaign_runner.py`, `modal_app.nightly_batch` |
| `filter_research_pages` / `source_audit_notes` / `seo_metadata_notes` | `articles/pipeline.py` |
| `should_index_asset` | `media_archive.py` |
| `enrich_failure_rows` | `backend/routes/failures.py` |
| `judge_ad_action` | `ad_actions_exec.py` (after AdSpendGuard) |
| `prompt_block` | `_load_brand_voice`, article `_run_inner` |
| `capture_from_state` | `POST /jev/route` |
| `should_spawn_repurpose` | `pipeline.py` after QA |
| FastAPI router | `backend/main.py` prefix `/api/v1/jev` |
| Voice router | `/api/v1/voice` |
| Migration 0026 | `db/migrations/0026_company_knowledge.sql` |

Focused tests (fresh run on this revision):

- `tests/test_jev.py` — primitives, gates, packs, loops, knowledge, HTTP
- `tests/test_security_web_hardening.py` — 401s including Jev/voice
- `tests/test_mcp_server.py` — `jev_status` / `jev_route` / `jev_knowledge`
- `tests/test_preflight.py` — key reporting
- `tests/test_campaign_runner.py` — HOLD path

---

## 11. Security sweep

Reviewed every Jev/voice HTTP handler, the ads overlay, knowledge
persistence, and voice session minting.

**Tenant isolation**

- Knowledge list/insert always uses `ctx.user_id` / pipeline `user_id`.
- No cross-user query exists on `company_knowledge`.
- Repurpose spawn uses `job.user_id` + `niche.id` already loaded for
  that job.

**Auth**

- Every `/api/v1/jev/*` and `/api/v1/voice/*` handler takes
  `CurrentUser`. Unauthenticated → 401 (covered in
  `test_security_web_hardening`).

**Money**

- `POST /jev/ads/judge` only returns a verdict. It does not call Meta /
  Google / Composio.
- `judge_ad_action` runs *after* `AdSpendGuard`. `deny` raises
  `AdSpendDenied`. `approve` forces human review. `allow` cannot undo a
  deterministic deny. Overlay exceptions other than `AdSpendDenied`
  are swallowed so a Jev outage cannot open the money path.

**Abuse bounds (HTTP)**

- State JSON ≤ 24k characters on ask / route / next-action / screen /
  curate / ads / foreman / auto-mode.
- Ask fan-out ≤ 32 questions; next-action targets ≤ 32.
- Auto-mode `tool` ≤ 64 chars (was an unbounded raw `dict`).
- Citation claim/source length-capped.
- Symbolic `diff` / `log_text` ≤ 24k; comments ≤ 32; candidates ≤ 16.
- Knowledge span ≤ 800 chars; kind allow-list.

**Error leakage**

- Decision 502s return `"decision backend failed"` and log the real
  error. They no longer echo TypeSafe/OpenRouter exception text.
- Voice 502s return `"voice session failed"`. The OpenAI error body is
  not forwarded to the browser.

**Voice**

- Session mint requires auth + OpenAI key.
- Response `raw` is `{id, object}` only. The ephemeral
  `client_secret` is the intended WebRTC credential.

**Prompt injection**

- Knowledge spans are the operator's own text, later injected into
  *their* writer prompts. Another tenant cannot write those rows.
- Jev never generates the span.

**Residual (accepted)**

- REST `/jev/ask` is not niche-metered (auth + size caps + **40/min**
  per IP + TypeSafe 429s). Pipeline calls *do* take a `SpendContext`.
- `/ads/judge` is **20/min**; `/voice/session` is **8/min** so a stolen
  token cannot mint unbounded Realtime sessions.
- Nightly HOLD fail-opens so a dark harness cannot freeze publishing.
- Knowledge insert is idempotent on `(user_id, lower(span))` in code
  (no unique index yet; a later migration can harden that).

---

## 12. File inventory (everything this work added)

| Path | Role |
| --- | --- |
| `src/marketer/jev/primitives.py` | Noul / Choice / Score types |
| `src/marketer/jev/client.py` | TypeSafe HTTP client |
| `src/marketer/jev/fallback.py` | Qwen System One wrapper |
| `src/marketer/jev/ask.py` | Jev-then-Qwen `ask()` |
| `src/marketer/jev/policy.py` | confidence gates, composite |
| `src/marketer/jev/harness.py` | model router, Auto Mode, next_action |
| `src/marketer/jev/router.py` | intent kind / skill / urgency |
| `src/marketer/jev/decisions.py` | domain packs |
| `src/marketer/jev/loops.py` | pipeline adapters |
| `src/marketer/jev/cache.py` | 5-minute LRU for identical `ask()` fan-outs |
| `src/marketer/jev/planner.py` | one-shot video plan (tier + skip hints + Cascade) |
| `src/marketer/jev/grounding.py` | compact state, fact lock, citation penalty |
| `src/marketer/articles/fastpath.py` | deterministic SERP / schema / interlink / topic / outline / metadata / hero / FAQ |
| `src/marketer/symbolic/foreman.py` | supervision policy |
| `src/marketer/symbolic/jev_code.py` | code triage workflows |
| `src/marketer/company_os/opencompany.py` | company surface routing |
| `src/marketer/company_os/knowledge.py` | extract / persist / inject |
| `src/marketer/repos/company_knowledge.py` | Postgres brain |
| `src/marketer/services/openai_realtime.py` | voice session mint |
| `backend/routes/jev.py` | HTTP judges |
| `backend/routes/voice_mode.py` | voice session |
| `web/app/(app)/decisions/*` | Decision harness UI |
| `web/app/(app)/voice/*` | Voice UI |
| `web/lib/jev-types.ts` | shared types |
| `db/migrations/0026_company_knowledge.sql` | brain table |
| `docs/JEV.md` | this document |
| `tests/test_jev.py` | harness unit + HTTP tests |

Call-site patches (existing files): `pipeline.py`, `articles/pipeline.py`,
`articles/llm.py`, `orchestrator.py`, `agents/ideation.py`,
`ad_actions_exec.py`, `campaign_runner.py`, `image_posts.py`,
`media_archive.py`, `modal_app.py`, `failures.py`, `sdk.py`, `cli.py`,
`mcp_server.py`, `preflight.py`, `config.py`, `.env.example`, `README.md`.

Nothing from `typesafe-sdk`, `thruwire/foreman`, `devagrawal09/jev-code`,
or `useopencompany/opencompany` is copied. Those repos supplied the
*contracts* (typed questions, Foreman evidence loop, company-OS
surfaces). Marketer owns the policy and the product wiring.

---

## 13. Speed — why Jev makes the product feel ~10× faster

People on X showing Jev agents jumping an order of magnitude are not
replacing the writer with Jev. **Jev cannot write.** They stopped
asking a chat model to *classify*, then they batched every remaining
decision into one speculative fan-out (70–500ms, TypeSafe's published
range) instead of N sequential LLM calls (2–8s each).

TypeSafe's own published workflow numbers are **193.6× faster** and
**444.6× cheaper** versus LLM classification on the same tasks. Treat
that as a ceiling, not a promise. marketer's ICP metric is
**time-to-first-publish**. The remaining waste after the decision
harness landed was still LLM/Whisper latency on stages Jev or code
could already finish.

### What we no longer wait for

| Old cost | New path | Why it's safe |
| --- | --- | --- |
| Visual Director LLM after scriptwriter | Skip when every scene has `visual_prompt ≥ 20` and `motion_prompt ≥ 12` | Scriptwriter already emits both; tests still hit VD via stub `vp0`/`mp0` |
| Whisper word-level transcript | `subtitle.script_to_words` from narration + scene durations; stretch to probed mix length | Script has the words and the timing math (~2.6 wps). Whisper is fallback only |
| `summarize_serp` LLM | `fastpath.serp_from_pages` | Exa already returned titles, domains, excerpts, word counts |
| `generate_schema_json` LLM | Deterministic Article + FAQPage `@graph` | Schema is structure, not prose |
| `interlink_suggest` LLM | Token-overlap ranking | Internal links are lexical relevance |
| `pick_topic` LLM | Template set + one Jev Choice | Jev picks; it does not invent the title |
| `generate_hero_prompt` LLM | Template from title + keyword | Hero is a still, not an argument |
| Sequential Foreman → screen → repurpose | `asyncio.gather` | Same policy, one wall-clock RTT |
| Intent route then a second `route_model` | Both heads in the same fan-out | Speculative questions are free |
| Jev HTTP 15s × 3 attempts | 8s × 2 | Fail over to Qwen / fail-open fast |
| Repeated identical `ask()` | 5-minute LRU (`jev/cache.py`) | Retries and resume must not re-pay |

Section prose still uses a writer (Qwen). Outline, SEO title/meta,
ideation candidates, FAQ blocks, and fact-lock cleanup are now
decisions or deterministic extracts.

### The planner

`plan_video_run` is one Jev call at the start of a video job:

- generation tier → `qwen3-8b` / `32b` / `235b-a22b`
- skip-visual-director hint
- caption source (`script` vs `whisper`)

An operator-pinned `niche.script_model` wins. A dark harness returns
Qwen-standard + script captions + skip-VD preferred; **code still
checks the script** before skipping Visual Director, so a shy noul
cannot drop a job that has empty prompts.

### What the operator should feel

A fresh short-form job that used to do ideation → script → visual
director → Whisper now does ideation → script → images. Caption burn
is free. QA is already Jev-first. Foreman, the outbound screen, and
the repurpose hint share one wall-clock beat. Article research /
schema / interlink / topic / outline / metadata / hero / FAQ /
checklist / definition / how-to / mistakes / stakes / SERP headings no longer enqueue extra
chat completions before (or instead of) the writer.

---

## 14. Speed + hallucination wave — Cascade, compact state, fact lock

TypeSafe's remaining unused patterns after the first speed pass:

| Pattern | Where it landed | Why it is faster *and* more accurate |
| --- | --- | --- |
| **The Cascade** | `plan_video_run` + article rewrite | Cheap tier first. A failed QA pass cannot pick `qwen3-8b` again; the rewrite tries the stronger writer first. |
| **Compact state** | `ask()` always runs `compact_state` (4k cap, 1.2k/field) | TypeSafe jaggedness: pad the state and accuracy falls. Smaller payload is also a shorter RTT. |
| **Keep-alive HTTP** | module-level `httpx.AsyncClient` + `warm()` during research | A new client per ask paid ~200ms of TLS. That ate the 70–500ms claim. OpenRouter / Qwen fallback clients are reused the same way. |
| **Template ideation** | `idea_candidates` + `judge_ideas` when TypeSafe is live | Code builds the hook set; Jev Choice picks. Dark harness / judge miss → `templates[0]`. No writer tournament. n==1 with an operator lens still buys one Qwen hop. |
| **Deterministic outline + metadata** | `outline_from_research`, `metadata_from_article` | SERP headings already *are* the outline. Title/slug/meta are extracts, not prose. |
| **Deterministic FAQ** | `faq_section_from_research` | Searcher questions + highlights become the FAQ H2. One less writer call. |
| **Deterministic checklist + definition** | `checklist_section_from_research`, `definition_section_from_research` | Playbook H2s that are already lists/definitions stitch SERP highlights. |
| **Deterministic how-to + mistakes + stakes + in-practice + SERP H2s** | `how_to_section_from_research`, `mistakes_section_from_research`, `stakes_section_from_research`, `practice_section_from_research`, `serp_heading_section_from_research` | Playbook H2s plus leftover SERP headings stitch token-overlapping highlights. Writer stays on thin overlap. |
| **Retrieve-then-judge** | `judge_article` / `audit_sources` send *claims*, not the 8k article | Jev has no world knowledge. Dumping a transcript makes it judge padding. |
| **Citation-verifier as a QA gate** | `source_audit_penalty` *before* the rewrite threshold | Notes-only audit never forced a rewrite. Each flag now drops `overall` (0.08, cap 0.35). |
| **Fact lock** | `allowed_facts` + `strip_ungrounded_claims` | Invented `%` / `$` / years / "research shows" sentences are stripped in milliseconds. No second LLM pass required to un-hallucinate. |
| **Skip empty work** | no claims → skip citation Jev; publishable title/meta → skip pagegrade | A clean writer should not pay another 70–500ms to be told it is clean. |
| **Parallel QA** | `asyncio.gather(score_article, source_audit_penalty)` | Same policy, one wall-clock beat. |

### Fact lock (the hallucination backstop)

Jev cannot generate knowledge sentences, and it also cannot *delete*
them. Code owns the lock:

1. Research highlights become the only allowed number/year/money tokens.
2. The writer prompt lists those tokens and forbids anything else.
3. After the write, `strip_ungrounded_claims` removes sentences that
   introduce a token the sources do not have, or that say
   "research shows" with no sourced number.
4. If nothing checkable remains, citation-verifier is skipped.

The writer is still an LLM. The lock is what makes a hallucinated
stat unpublishable without waiting for another model to notice.

### Cascade

```
first pass  →  cheapest tier Jev will allow
QA fail     →  bump fast → standard; rewrite with the stronger writer
```

`prior_qa_failed` is set when the video pipeline is already on its
bounded regenerate. A dark harness also refuses the cheap tier on
retry so we do not loop 8B → fail → 8B.

### What the operator should feel now

Time-to-first-publish is ideation + one script/article write +
images. Everything that used to be "ask a chat model to classify /
outline / title / caption / FAQ / fact-check" is either Jev (one
fan-out) or Python (zero RTT). Hallucinated numbers do not survive
the fact lock even when Jev is dark.

---

## 15. Loop — remaining sequential hops and abuse bounds

A later pass removed leftover sequential Jev RTTs and closed the
obvious abuse windows on the HTTP judges:

| Change | Why it is guaranteed better |
| --- | --- |
| `POST /jev/route` uses `intent.model` | The second `route_model()` call was a duplicate 70–500ms hop |
| Intent + company OS `asyncio.gather` | Independent questions, one wall-clock beat |
| Video `warm()` before `plan_video_run` | First ask of a job skips TLS |
| API lifespan `warm()` | First `/decisions` click is not a cold TLS handshake |
| Voice Realtime keep-alive client | Session mint no longer pays a new TLS client |
| Knowledge span dedup | Same rule cannot bloat writer prompts forever |
| `rank_passages` one noul per page (cap 8) | Half the questions, same retrieve-then-judge |
| Qwen-only ideation uses templates + `ask()` | OpenRouter-only installs never buy a 3-way writer tournament |
| HTTP limits: 40/min judges, 20/min ads, 8/min voice | Stolen token / noisy UI cannot melt TypeSafe or OpenAI |
| `apply_jev_ads_overlay` tests | Deny / force-approve / fail-open cannot relax AdSpendGuard |

---

## 16. Loop — Qwen writes articles, keep-alive research/publish

| Change | Why it is guaranteed better |
| --- | --- |
| Article writer resolves to Qwen when OpenRouter is on and the operator did not pin a different model | Matches the harness contract and is cheaper than `gpt-5.4-mini` |
| OpenRouter `chat_client()` reused | Article sections and Agents-SDK writers share one TLS pool |
| Exa keep-alive client | SERP research no longer opens a new client per article |
| Ayrshare keep-alive + parallel carousel uploads | Publish path skips TLS and waits for slides concurrently |
| Template carousel plans when Jev is live | Image posts skip a planner LLM; gpt-image-1 still renders |
| Slim video QA state (hook + narration + 1.5k transcript) | Jev judges the checkable parts, not a full script dump |
| Scriptwriter fact lock | Narration cannot invent studies / % / $ / years |

---

## 17. Loop — more TLS reuse, unique knowledge, heuristic QA

| Change | Why it is guaranteed better |
| --- | --- |
| Ayrshare profiles + analytics keep-alive | Connect and metrics polls skip a TLS handshake each call |
| ElevenLabs TTS + music keep-alive | Voiceover and generated tracks reuse one client |
| Parallel outbound webhook fan-out | N endpoints wait one RTT, not N; still fail-open |
| Unique index on `(user_id, lower(span))` | Concurrent extracts cannot duplicate a brand rule and bloat every prompt |
| `heuristic_quality` when Jev is dark | Article QA is classification. A dark harness no longer spends 2–8s on an editorial LLM that invents scores |

Dark-path article QA uses word count, keyword density, sentence length, and dash counts — the same numbers the old LLM was given. Jev still scores when the key is live. Citation-verifier and the fact lock stay in front of publish either way.

---

## 18. Loop — dark-path video QA, extracted social, metered `/ask`

| Change | Why it is guaranteed better |
| --- | --- |
| `heuristic_qa_report` when Jev is dark | Video QA hard floors (generic hook, duration drift, empty captions, niche tokens) are classification. A dark harness no longer spends a chat completion inventing rubric numbers |
| Social snippets extracted from the article | Jev cannot write captions. An LLM here invented hooks. Templates cannot hallucinate a stat the article does not have |
| Dead article helpers (`summarize_serp`, outline/metadata/schema/interlink/hero) delegate to fastpath | A leftover caller cannot re-introduce a 2–8s classification LLM |
| `POST /jev/ask` logs spend (fail-open, `niche_id` null) | Stolen token / noisy UI pays the ledger and prepaid credits, not just the 40/min cap |
| Article `/social` 20/min | Extracted snippets are cheap; the bound still stops a tight loop |

Jev still judges video when the key is live. Social copy is now an extract — worse poetry, zero invented facts, zero writer spend.

---

## 19. Loop — dark-path writers gone, every HTTP judge metered

| Change | Why it is guaranteed better |
| --- | --- |
| Dark-path ideation returns `templates[0]` | Classification is not worth a writer. `n==1` without a lens is the same template. A lone operator hook lens still buys one Qwen hop |
| Image-post `_plan` is always `template_carousel_plan` | gpt-image-1 still renders. A dark harness no longer spends a planner completion inventing slide copy |
| Every `/jev/*` POST meters spend (fail-open, `niche_id` null) | Stolen token / noisy UI pays the ledger, not just the 40/min cap |
| Enqueue + retry 10/min (jobs, articles, image posts); niche draft 8/min | Modal + writer spend cannot be melted by a tight loop |
| Pixabay / Resend / x402 / outbound webhook keep-alive | Music search, mail, facilitator verify, and signed fan-out skip a TLS handshake per call |

Jev still picks among templates when the key is live. Ads overlay is unchanged: deny / force-approve only; `AdSpendGuard` never relaxes.

---

## 20. Loop — video TLS reuse, spawn + money POSTs bounded

| Change | Why it is guaranteed better |
| --- | --- |
| Fal + Grok Imagine keep-alive (`_client` does not close the pool) | Every scene used to open TLS, poll, download, then tear down. A 4-scene video paid that 4 times; now it is one handshake |
| Failures replay 10/min | The inbox is a second door onto the same Modal spawn as retry |
| Template remix 10/min | gpt-image-1 + Modal cannot be melted from `/templates/{id}/remix` |
| Job / image-post approve 10/min | Approve spawns `finish_scheduling` (Ayrshare upload). Same bound as enqueue |
| Ads connect / budget / status / decide 20/min | Money mutations already fail-closed; a stolen token still cannot spray the guard |

Ads overlay is unchanged. Jev still does not generate video or move money.

---

## 21. Loop — one-RTT publish QA, bound checkout / webhooks / campaigns

| Change | Why it is guaranteed better |
| --- | --- |
| Video pipeline `gather(run_qa, after_content_qa, repurpose_hint)` | After render, QA then Foreman was a second 70–500ms RTT. Overlay uses the instant heuristic; the gather result is live Jev when the key is on. Tests still patch `pipeline.run_qa` |
| `qa_payload` / `resolve_video_qa` extracted | Pipeline and HTTP judges share one slim state. Dark path stays heuristic; SpendCapExceeded still re-raises |
| Article metadata `gather(seo_metadata_notes, interlink_candidates)` | Pagegrade and the DB lookup are independent. One wall-clock beat |
| Billing checkout 5/min | Stripe session create is money. A stolen token cannot spray hosted checkouts |
| x402 `/credits` 10/min | Facilitator verify + ledger credit cannot be melted |
| Webhook endpoint create + test 10/min | SSRF-guarded outbound POSTs cannot be sprayed from a stolen token |
| Campaign start / pause 10/min | Lifecycle mutations spawn the runner. Same class of bound as enqueue |
| Ads account refresh 20/min | Hits Composio. Same bound as connect / budget / decide |

Foreman still fail-closes when it answered. Ads overlay is unchanged: deny / force-approve only; `AdSpendGuard` never relaxes. Extra overlay Jev on a failing QA is accepted — one cheap call vs a sequential RTT on every success path.

---

## 22. Loop — delivery facts beat Jev, bound ads governance

| Change | Why it is guaranteed better |
| --- | --- |
| `is_hard_rerender` short-circuits video QA | Duration >20% and empty captions are facts. Jev has no clock and used to be able to *publish* a broken render. Code now fails immediately and skips Foreman + repurpose |
| `resolve_video_qa` returns the heuristic on hard rerender | HTTP / other callers cannot pay TypeSafe to override a delivery floor |
| Ads create campaign + governance 20/min | Draft create and kill-switch / cap writes are money-adjacent. Same bound as connect / budget / decide |

Jev still judges hook / niche / clarity when the render is deliverable. Soft fails (`regenerate_script`) still gather so Jev can confirm. `AdSpendGuard` is unchanged.

---

## 23. Loop — overlap setup I/O, bound job reject

| Change | Why it is guaranteed better |
| --- | --- |
| Video ideation `gather(perf_ctx, brand_voice, recent_topics)` | Three independent DB/knowledge reads were sequential on every job. Same inputs, one wall-clock beat before the writer |
| Article tone `gather(brand_kit, knowledge, writing_kit)` | Same pattern on Press. Knowledge and kits already fail-open |
| Job reject 10/min | The veto door matches approve / enqueue. A stolen token cannot spray-reject the approval queue |

Setup I/O is not Jev, but it sits on the time-to-first-publish path in front of the writer. Ads overlay and delivery-fact floors are unchanged.

---

## 24. Loop — parallel archive, overlap Auto Mode, bound remix spawn

| Change | Why it is guaranteed better |
| --- | --- |
| `archive_job_media` gathers clip / keyframe / VO / music + jev-curate | A 4-scene job used to upload 8+ artifacts one after another. One failed upload no longer aborts the rest. Curate runs in the same beat as the scene uploads |
| Autonomous path `gather(publish_gate, archive)` | Wasabi/volume I/O no longer sits in front of Auto Mode. Approval-gated jobs still archive then park (no Auto Mode until the operator approves) |
| Article setup gather includes `recent_titles` | Topic pick no longer waits for brand/knowledge/kit to finish first |
| Library `POST /compositions` 10/min | Remix spawns Modal `render_composition`. Same class of bound as enqueue |

Ads overlay and delivery-fact floors are unchanged. Jev still cannot generate video or move money.

---

## 25. Loop — overlap VO + music, script fact lock, bound creates

| Change | Why it is guaranteed better |
| --- | --- |
| Voiceover and music start together | TTS and Pixabay/generated score do not depend on each other. A 2–8s sequential wait becomes one wall-clock beat. Music is cancelled if VO hits the spend cap |
| `_signal_terminal` gathers email + webhook | Every fail / park / done used to wait for Resend then the fan-out. Independent, fail-open |
| `_lock_script_facts` after scriptwriter | Same fact lock as articles: invented `%` / `$` / study-year sentences are stripped from narration using the niche brief as the allowed set. One-line scenes that would empty stay (fail-open) |
| Campaign create 10/min; niche create 8/min | Spray-create is the front door onto the runner / writer. Same class of bound as start / draft |

Jev still does not write narration. Ads overlay and delivery-fact floors are unchanged.

## 26. Loop — article signals, image archive overlap, Composio cache

| Change | Why it is guaranteed better |
| --- | --- |
| Article `_signal_terminal` gathers email + webhook | Same leftover as video: fail / done waited for Resend then the fan-out. Independent, fail-open |
| Image-slide archive fans out | Wasabi uploads no longer wait on each other. One failed slide does not abort the rest |
| Archive overlaps park / publish_gate | Autonomous image posts start Auto Mode while slides upload. Approval parks in the same beat as archive |
| Image-post fact lock | Caption / heading / body drop invented `%` / `$` / study-year sentences against the niche brief. Empty leftovers stay (fail-open) |
| Composio client cached per API key | Connect / status / execute reused a new SDK client each call. Rotating the key still rebuilds |
| Campaign tick + detail gather four/three independent reads | `spent_usd` + items + counts + pending were sequential RTTs on every hourly tick and every GET |
| Campaign items 10/min; kits create 10/min; template create 10/min; ads disconnect 20/min | Lane attach and kit spray are spawn front doors. Disconnect is the same abuse class as connect |

Jev still does not write captions. Ads overlay never relaxes AdSpendGuard.

## 27. Loop — overlap character sheet, gather probes, bound admin

| Change | Why it is guaranteed better |
| --- | --- |
| Character sheet starts before ideation | The sheet only needs niche look, not the script. gpt-image-1 latency hides behind ideation + scriptwriter. `cast_mode=none` still skips |
| Design kit joins the ideation gather | Brand / perf / recent / kit were three reads then a fourth. One beat |
| `/healthz/deep` gathers DB + JWKS + migrations | Probe wall-clock is max(latency), not the sum. Migrations run in a worker thread |
| Billing balance + ledger gather | Two independent reads on every settings page |
| Admin mutations 10/min; account erase 5/min; niche update 8/min; brand-kit PUT 10/min | Privilege spray and self-wipe are the remaining unbounded mutation doors |

Jev still does not write scripts. Ads overlay never relaxes AdSpendGuard.

## 28. Loop — hero overlap, n==1 templates, shared OpenAI

| Change | Why it is guaranteed better |
| --- | --- |
| Article hero starts during metadata | gpt-image-1 overlaps SEO notes + interlink. Imaging stage still awaits so spend-cap fails the article and degrade still publishes |
| n==1 ideation without an operator lens uses `templates[0]` | Last leftover writer hop when the creator did not pick a hook mechanism. A brief lens still buys one shot |
| One OpenAI client for images / TTS / Whisper / article fallback | Four TLS pools for the same key. Tests still inject per-module `_client` |
| Stripe `api_key` set once per secret | Checkout and webhook no longer reconfigure the SDK on every call |
| User settings PATCH 10/min; niche archive 8/min; kit update 10/min | Spend-cap edits and archive spray were the remaining unbounded doors |

Jev still does not write hooks unless the operator set a lens. Ads overlay never relaxes AdSpendGuard.

## 29. Loop — template scripts, bound leftover deletes

| Change | Why it is guaranteed better |
| --- | --- |
| Default `run_scriptwriter` is `template_script` | Last 5–20s writer hop on a stock niche. Operator-pinned `script_model` and a narrative brief still buy the LLM. Pipeline no longer substitutes `plan.model_id` (that forced a writer on every job) |
| Template scenes emit usable visual + motion prompts | Visual Director stays skipped. Fact lock stays a no-op — no invented % / $ / years |
| Campaign item PATCH/DELETE, webhook PATCH/DELETE, kit DELETE, token revoke, admin template PUT/DELETE at 10/min | Last unbounded mutation doors (lane flips, webhook kill, kit wipe, token revoke, global template edits) |

Jev still does not write scripts. Ads overlay never relaxes AdSpendGuard.

## 30. Loop — overlap VO with images, gather dashboards

| Change | Why it is guaranteed better |
| --- | --- |
| Voiceover + music start during image fan-out | TTS and Pixabay/ElevenLabs only need the script. They hide behind gpt-image-1 + i2v (the long pole). Avatar mode still synthesizes per-scene VO inside the fan-out. Failed fan-out cancels leftover audio tasks |
| Ads overview + campaign detail gather | Dashboard wall-clock is max(reads), not the sum. Spend-on/between per account fan-out |
| Job metrics gather job + latest + history | Three independent reads on every analytics drawer |
| Niche performance gathers spend + latest metrics | N sequential `latest_for_job` calls became one beat after the ownership check |
| GDPR export 5/min | A full-account dump was the last unbounded read of private data |

Jev still does not write scripts. Ads overlay never relaxes AdSpendGuard.

## 31. Loop — hero overlaps research, bound voice preview

| Change | Why it is guaranteed better |
| --- | --- |
| Article hero starts after topic pick | gpt-image-1 only needs topic + keyword. It hides behind Exa + write + QA. Imaging stage still awaits; spend-cap fails the article; other failures degrade |
| Admin `/health` gathers stuck + failed-24h counts | Two independent job aggregates on every ops refresh |
| Voice preview GET 8/min | First hit synthesizes paid TTS. Was unbounded |

Jev still does not write scripts. Ads overlay never relaxes AdSpendGuard.

## 32. Loop — carousel slide fan-out, grounded playbook sections, bound media GETs

| Change | Why it is guaranteed better |
| --- | --- |
| Image-post slides 1..n gather after slide 0 | Later slides already share `slide_0.png` as the aesthetic reference. A 5-slide carousel was 5 sequential gpt-image-1 calls; now it is 1 + the rest in one beat |
| Checklist + definition H2s stitch SERP highlights | Playbook headings that are already lists/definitions do not buy a writer. Empty or thin SERP still hits the writer. FAQ stays the same contract |
| Job video, article markdown/hero, character sheet, library media 30/min | Last unbounded file-serve GETs. Bandwidth + disk + presign spray without changing the happy-path UX |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 33. Loop — fail-closed EL before planner, overlap plan with setup, grounded how-to/mistakes

| Change | Why it is guaranteed better |
| --- | --- |
| ElevenLabs misconfig fails before planner Jev or character-sheet spend | A missing key used to pay a 70–500ms planner hop (and used to sit *after* that hop). Config errors now fail with zero model spend |
| Character sheet starts before planner | gpt-image-1 hides behind warm + Jev, not only ideation |
| Planner overlaps ideation setup reads | `plan_video_run` does not feed ideation. Four independent DB reads hid the planner RTT. Resume still awaits the plan for harness |
| How-to + mistakes H2s stitch SERP highlights | Playbook steps/failure-modes that are already lists skip the writer. Thin SERP still buys prose |
| Template reference + Jev knowledge GET 30/min | Last file-serve door on remix previews, plus the knowledge dump of verbatim brand spans |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 34. Loop — VO during Visual Director, overlap approval archive, bound failures inbox

| Change | Why it is guaranteed better |
| --- | --- |
| Fact-lock then start VO + music before Visual Director | VD does not change narration. On jobs that still need VD, TTS / Pixabay hide behind that hop as well as images. Stage markers stay after the fan-out. Failed VD cancels leftover audio |
| Video approval parks persist + archive + notify in one gather | Wasabi/volume I/O no longer sits in front of `awaiting_approval`. Archive still completes before return |
| Failures inbox GET 30/min + gathered source reads | Unbounded poll could hit 1500 rows and a Jev triage hop every refresh. Replay stays 10/min |
| Topic-known articles start Exa during kit/brand gather | Keyword is already known. Research no longer waits on four sequential setup reads |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 35. Loop — template why-matters H2s, prefetch campaign niches, bound admin/ops/dashboard reads

| Change | Why it is guaranteed better |
| --- | --- |
| `stakes_section_from_research` stitches "Why X matters now" | Default playbook H2. Highlights ≥2 become the section; thin SERP still buys the writer. No invented stakes |
| Campaign tick prefetches unique due-lane niches | One gather instead of a sequential `niches_repo.get` per due lane. Spawn stays sequential because projected budget increments |
| Admin overview / users / user / flags / health / audit-log 30/min | Last unbounded privileged dumps. Mutations stay 10/min |
| Ops `/metrics` + `/config-health` 30/min | Live ledger + stuck-work aggregates. Same spray class as admin health |
| Calendar + spend/today + metrics/summary 30/min | Dashboard polls that were unbounded |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 36. Loop — grounded SERP H2s, skip tiny rank hops, bound dashboard lists

| Change | Why it is guaranteed better |
| --- | --- |
| `serp_heading_section_from_research` stitches leftover SERP H2s | `commonHeadings` land first in the outline. Two token-overlapping highlights skip a writer hop. Playbook templates still win. Thin overlap still buys prose |
| Skip Jev `rank_passages` when Exa returns fewer than 4 pages | Ranking 2–3 URLs cannot drop much without emptying the set (already falls back). Saves a 70–500ms RTT |
| Jobs / articles / niches / image-posts lists + job metrics 30/min | Last unbounded operator list polls. Enqueue stays 10/min |
| Ads accounts / campaigns / approvals / actions / overview 30/min | Privileged spend-adjacent dumps. Mutations stay 20/min |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 37. Loop — overlap setup I/O on every run, skip redundant cap user-fetch

| Change | Why it is guaranteed better |
| --- | --- |
| Video `obtain_job` gathers `default_context` | Job row + user cap snapshot are independent. Fresh create and resume both hide the users.get behind obtain |
| Article get/create gathers `default_context` | Same user snapshot no longer waits on the article row |
| Image-post niche get gathers `default_context` | After the post exists, niche + user cap overlap. Cap is applied on the snapshot |
| `_ensure_cap` reuses `spend.global_cap_usd` | Pre-stage checks ran a second users.get 2–3 times per video. The spend context already has the snapshot |
| Library / templates / campaigns / kits lists + performance + billing balance + brand-kit GET 30/min | Last unbounded dashboard dumps. Mutations stay 10/min |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 38. Loop — template niche drafts, skip social spend, grounded in-practice H2s, bound leftover dumps

| Change | Why it is guaranteed better |
| --- | --- |
| `template_niche_drafts` + Jev Choice on the onboarding front door | Last 5–20s writer hop a new user paid before they could review a spec. Code builds 4 reviewable drafts from the one-liner + brand-kit lines. Jev picks. Dark harness / judge miss → templates[0]. No invented stats. Review screen still edits |
| Article social skips niche + spend | Snippets are already a template extract. Two sequential DB reads (and a dead 402 path) sat in front of zero model spend |
| `practice_section_from_research` stitches `{focus} in practice N` | Outline pads thin SERP with those filler H2s. Highlights ≥2 skip the writer. `_playbook_heading` keeps SERP stitch from stealing the shape |
| Webhook list + Jev/voice status + providers + style-presets GET 30/min | Last unbounded catalog / status dumps. Mutations stay 10/min (webhooks) and 8/min (voice session) |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 39. Loop — template Visual Director, bound remaining poll GETs

| Change | Why it is guaranteed better |
| --- | --- |
| `template_visual_director` when prompts are thin and no design kit / visual brief | Last 5–20s writer hop on operator-pinned or stub scripts. Code stamps style, 9:16, no-text, and a motion line. Narration is untouched. A filled design kit or `visual_director_brief()` still buys the LLM |
| Job / article / niche / image-post / kit / composition detail GET 30/min | UI polls these. Lists were already bounded; the single-row poll doors were not |
| users/me + x402 config + connect status GET 30/min | Remaining unbounded identity / payment-discovery dumps. Mutations stay 5–10/min |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 40. Loop — grounded leftover article H2s, skip auth upsert on every request

| Change | Why it is guaranteed better |
| --- | --- |
| `question_section_from_research` for SERP `questionsAnswered` H2s (outline strips `?`) | Leftover writer hop on searcher questions. Stitches overlapping highlights, else the first two. Playbook headings stay on their templates |
| `grounded_section_from_research` last-resort leftover H2 | Common headings without 2-token overlap still hit the writer. ≥2 highlights stitch verbatim; thin SERP still buys prose. No invented facts |
| `users.ensure` get-first; Clerk JWT + `GET /me` stop writing every request | Returning users were an `INSERT … ON CONFLICT` on every authenticated call. First login and email rotation still upsert. PAT path was already a SELECT |
| `_validate_kit_refs` gathers both kit lookups | Niche create/update waited two sequential kit gets. One RTT when both ids are set |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 41. Wrap-up — production-ready last hop

| Change | Why it is guaranteed better |
| --- | --- |
| Campaign item DELETE scoped to URL `campaign_id` | PATCH already scoped in SQL. `DELETE /campaigns/{A}/items/{id}` could remove an item that belonged to campaign B |
| `GET /spend/history` 30/min | Last unbounded authenticated ledger dump. `/today` was already bounded |
| `_load_brand_voice` gathers brand kit + knowledge | Independent reads on every video job were sequential |
| Visual Director LLM path is Qwen-first when OpenRouter is on | Templates still skip the writer. A filled design kit / visual brief bought stock `agent_model` instead of the same Qwen hop as scriptwriter |
| `pick_topic` never falls through to `llm.pick_topic` | `unused_topic_candidates` always returns the stock set. Classification LLM hop cannot regress in |
| Ads `DecideBody.decision` is `Literal["approved", "rejected"]` | Invalid decisions 422 at the validator, not a hand-rolled string check |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 42. Loop — one OpenRouter hop for every leftover writer

| Change | Why it is guaranteed better |
| --- | --- |
| `openrouter.generation_metered` shared by scriptwriter, Visual Director, and ideation | Three copies of Qwen-first routing could drift. One helper, same fail-open (off / unknown / stock model → no change) |
| n==1 ideation writer (operator hook lens) is Qwen-first | Last stock-`agent_model` writer on the operator-lens path. Templates still win n≥2 and n==1 without a lens |
| Dead 3-way LLM tournament deleted | Unreachable on the stock template set (`limit=max(n,4)`). A future empty-candidate change cannot buy N chat completions + a judge |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 43. Wrap-up — tournament docs + None-safe Qwen hop

| Change | Why it is guaranteed better |
| --- | --- |
| `generation_metered(None)` is empty, not a TypeError | A missing niche dropdown must not fail a paid leftover writer |
| JEV.md no longer claims a dark-path writer tournament | Install/theory matched the deleted 3-way hop. Operators reading §14/§19 would re-introduce it |
| n≥2 ideation never calls `run_metered` (regression test) | Tournament cannot regress in behind templates + Jev |
| Pin ruff `select` to `E4,E7,E9,F`; drop leftover `settings` imports | Ruff 0.16 treats omitted select as every rule. CI died on 560 style nits and never reached pytest |
| Pin `mcp[cli]>=1.2,<2` | mcp 2.x removed `FastMCP`. Collection of `test_mcp_server.py` aborted the whole CI pytest run |
| Ads PG route tests pass a dummy `Request` | `@limiter.limit` requires Starlette Request. Direct handler calls 500'd after the ads mutation bound |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.

## 44. Loop — fact lock keeps loaded knowledge, leftover topic pick is templates

| Change | Why it is guaranteed better |
| --- | --- |
| `_lock_script_facts(..., extra=)` includes already-loaded brand / knowledge | Writer was given those spans. Re-locking against niche brief only stripped grounded numbers on resume and fresh path |
| Resume gathers planner + brand voice | Independent reads. Resume no longer re-locks blind |
| `llm.pick_topic` delegates to fastpath | Last classification OpenAI `_parse_call` in article writer module. Leftover caller cannot buy a topic LLM |

Jev still does not write scripts or knowledge sentences. Ads overlay never relaxes AdSpendGuard.
