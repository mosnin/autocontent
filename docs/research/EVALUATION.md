# Marketer: evaluation of outside sources, and a plan

Read-only research, 2026-11-17. Sources were shallow-cloned into
`/tmp/claude-0/-home-user/a2f4b345-1c94-5492-9e45-7696f455e335/scratchpad/research/<owner>_<repo>` and read as data. No code from them was run.

## 0. What Marketer already has (so we don't re-buy it)

| Area | What exists today | Where |
|---|---|---|
| Web | Next.js 15 / React 19, Clerk, **SWR already a dependency (used in 8 files)**, `@tanstack/react-table`, `@flue/react` chat, sonner, motion/gsap | `web/` |
| Backend | FastAPI + asyncpg/Postgres, Modal, Inngest (durable ads workflows), OpenAI Agents SDK pipelines, admin feature-flag table | `backend/`, `src/marketer/`, `db/migrations/0001..0025` |
| OpenRouter | Already used, but only for the per-niche **scriptwriter** model, with a hand-curated price table | `src/marketer/services/openrouter.py` |
| Agent harness | Agent Starter on Workers + Flue: `Assistant` (Marketer) delegates to six dispatch-only departments; tools built with `readTool`/`writeTool` and risk tiers LOW/MEDIUM/HIGH/CRITICAL; reviewed table `EXPECTED_RISK`; approvals bound to the Clerk user; media buyer capped at `maxAutonomousTier: "LOW"`; persistent autopilot with a model reviewer on every tool call | `agent/src/agents/*`, `agent/src/marketer/tools/*`, `agent/test/marketer-tools.test.ts`, `agent/vendor/agent-starter/core/src/persistent/review.ts` |
| Money rails | One fail-closed choke point: guard → park for approval → append-only audit → platform call; approvals re-guarded and single use | `src/marketer/services/ad_actions_exec.py`, `ad_spend_guard.py` |
| Agent memory | Vector notes (`remember_note`/`search_notes`, user-scoped, PII-redacted, TTL); KV entity graph (entities, attributes with confidence and `updatedAt`, edges); provenance and trust for persistent-agent memory with snapshots; scratchpad; compaction | `agent/src/lib/platform.ts` (`vectorMemory`, `entityGraph`, `retriever`), `agent/vendor/agent-starter/core/src/memory/*`, `.../persistent/memory.ts` |
| Learning loop | Winners/losers from `post_metrics` fed to ideation as markdown | `src/marketer/agents/performance_context.py` |
| Evals | **promptfoo already wired** against the real agent runtime (`pnpm evals`), Marketer suite exists | `agent/promptfoo.config.yaml`, `agent/evals/marketer.yaml` |
| Decision models | Vendor-neutral `DecisionAdapter` + `decideWithin` (timeout, fallback) and a Jev adapter that can go **via OpenRouter**. **Not wired into the web app yet**: nothing in `web/` imports it | `.intent-onboarding/packages/core/src/decisions.ts`, `.intent-onboarding/packages/decisions-jev/src/*` |

Two facts shape the whole plan:

1. **Decision models already run on OpenRouter.** OpenRouter serves System One models on a separate endpoint,
   `POST https://openrouter.ai/api/alpha/decisions` (outside `/api/v1`; the chat endpoint rejects them with 400).
   Models seen in the sources: `typesafe/jev-1.13` (pin the dated slug, e.g. `typesafe/jev-1.13-20260917`, not
   `~typesafe/jev-latest`), `kev-4b`, `span-01` (noul only), `cloudflare/clef`, `openai/gpt-6-luna-decisions`,
   `perplexity/pplx-decider-flash-v1.2`. Input around $0.04 per million tokens, output free, 32k context, ~0.3 s.
   The path is `/alpha/` and "may move" (system-one-connector docs), so it must be a config value.
2. **Decision models judge; code decides.** Every serious source (TypeSafe skill, claude-x-jev, jev-kit) says the
   same thing: ask atomic, observable questions ("does the hook name a specific number?"), never "should we
   publish?". The truth table that turns answers into an action lives in code, where it is visible and tested.
   Arithmetic, dates, caps and policy never go to the model.

---

## 1. Source-by-source verdicts

Legend: **Adopt** = take the code or dependency. **Borrow** = take the idea, write our own. **Skip** = no fit.

### Decision models

| Source | What it is | Verdict | Why, for Marketer |
|---|---|---|---|
| **itsmostafa/system-one-connector** (MIT, Go) | One-binary MCP server `evaluate` that sends state + typed questions (noul/choice/score) to Jev or any System One model, incl. via OpenRouter; has `items` batch mode (500 records), `min_confidence` abstain, profiles per model | **Borrow** | Best reference for the OpenRouter decisions contract, model list and answer semantics (confidence = concentration, not correctness; score is 0-indexed). Don't ship the Go binary; we call the HTTP endpoint from TS and Python. Copy the `items` batching and the abstain rule. |
| **fazlerocks/jevmail** (MIT, Next.js) | Gmail triage: three Jev questions per email (tray choice, urgency score, is-personal noul), stores user corrections next to the model answer | **Borrow** | Clean template for **inbox and comment triage** and for the "store the correction beside the answer" calibration loop. Uses Vercel AI Gateway + AI SDK `experimental_evaluate`; we route through OpenRouter instead. |
| **jonathanavis96/jev-kit** (MIT, Python) | Claude Code hook kit: free code pre-filter lets ~93% of tool calls through, Jev judges the rest (~0.3 s), allow/warn/block/rewrite; shadow-then-enforce; tier guard that maps a task to the cheapest adequate sub-agent rung | **Borrow** | Two patterns to copy: (a) **code pre-filter → Jev only when a deny is reachable → act only above confidence and margin**; (b) **shadow mode with a report before enforce**, plus a kill switch. One inversion: jev-kit fails **open**. Marketer's money and publish paths must fail **closed** (escalate to a person). |
| **charlesdove977/claude-x-jev** (MIT) | Claude Code skill over OpenRouter's decisions endpoint: classify / route / gate / verify, JSON presets (`draft-verify`, `comment-triage`, `lead-qualify`), a `tune` command that finds the lowest threshold meeting a precision target | **Borrow** | The **cascade** (Jev on everything, LLM only on the unsure slice: 216 emails, 82% handled at ≥0.7 confidence with 95.5% agreement, $0.85 vs $4.73) and the **three threshold jobs** (route: confidence ≥ T; gate: approve ≥0.9 / block ≤0.1 / human between; verify: every check must pass, never average) map straight onto QA and approvals. `draft-verify` is almost exactly our article/caption QA. |
| **typesafe-ai/skills** (MIT) | The vendor's integration skill: design the state, write one-judgment questions, bundle questions sharing state, ask speculatively, pair a choice with a "does anything fit?" noul, keep all wording in one module, log payloads, never treat a failed call as "no" | **Adopt** (as a dev skill) | Vendor it into `.claude/skills/typesafe-ai/` so whoever writes Marketer's decision questions follows it. It is the house style for section 2. |
| Jev family, found by search (all MIT unless noted) | `AgriciDaniel/jev-seo` (site SEO audit: 52 rules + Jev questions per page, code ranks fixes), `tamaratran/fast-jev-compaction` (compaction by Jev keep/drop of tool results, never rewriting text), `kerpopule/hermes-jev-skills` (Jev for model routing, skill selection, search ranking, memory, with on/shadow/off), `jaredpalmer/kev` (open Jev-like models, on OpenRouter as Kev 4B), `JamesANZ/JevPromptShield` (injection detection) | **Borrow** | jev-seo is the blueprint for an in-app **/audit-site** skill and Press QA. fast-jev-compaction is a better compaction for long agent threads (drop stale tool output verbatim-safe instead of lossy summaries). hermes-jev-skills validates per-turn **model-tier routing** with Jev. Kev 4B is the cheap fallback decision model. |

### Memory and agents

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **getzep/graphiti** (Apache-2.0, Python, Neo4j/FalkorDB/Neptune) | Temporal context graph: facts with validity windows (invalidated, never deleted), episodes as provenance for every fact, prescribed (Pydantic) or learned ontology, incremental ingestion, hybrid semantic + BM25 + graph retrieval | **Borrow** | We run on Workers with a KV entity graph; a Python graph DB service would be a new stack. Take **bi-temporal facts**, **episode provenance** and a **prescribed marketing ontology** into our own `KvEntityGraphStore` layer (section 3). |
| **langchain-ai/langgraph** (MIT) | Graph orchestration with checkpointers, interrupts/resume, thread state vs a cross-thread namespaced Store; documents semantic / episodic / procedural memory | **Borrow** | Flue + Durable Objects already give durable runs and interrupts (approvals). Take the **memory taxonomy**, especially **procedural memory** (rules learned from feedback) and namespaced stores. Adopting LangGraph would duplicate the harness. |
| **promptfoo/promptfoo** (MIT) | Assertion-based eval and red-team runner | **Adopt (already adopted; extend)** | `agent/promptfoo.config.yaml` and `agent/evals/marketer.yaml` exist. Extend with marketing-quality, approval-tier, memory-recall and decision-model regression suites (section 6). |
| **garrytan/gbrain** (MIT, Bun) | "One brain" for agents: hot **facts** captured per turn vs cold **takes** (who believes what, with weight), nightly consolidation, compiled-truth-plus-timeline pages, recency decay, a contradictions probe, evidence delivery (return the whole page/section, not the chunk), a voice gate with LLM judge + template fallback | **Borrow** | The hot/cold split, consolidation pass, contradiction probe and `return_unit: auto` are exactly what our notes + entity graph lack. Running gbrain itself (Bun + Postgres/PGlite, MCP) next to Workers is another service for one feature; skip the runtime. |

### App functionality

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **bvaughn/react-virtualized** (MIT) | Classic windowing library; its author's successor is react-window | **Skip the lib, Adopt virtualization** | Legacy API and bundle. We already depend on `@tanstack/react-table`; use **`@tanstack/react-virtual`** for the media library, activity log, ads audit log and long chat threads. |
| **automerge/automerge** (MIT) | CRDT documents with sync and history | **Skip (for now)** | No multiplayer editing requirement; Postgres is the source of truth and the agent writes through the API. Revisit only if people and agents co-edit an article or brand kit live. |
| **jpn-okc/corpus-intelligence** (**no licence file**, so all rights reserved: reference only) | Writing-corpus intelligence over Chroma/Neo4j/SQLite/DuckDB; "gravity" tool activation: query fragments are embedded and pull on tool-identity vectors, with an adaptive gap cutoff | **Borrow (idea only)** | The gravity idea is a good **rule-based fallback for department routing**: embed each department's identity once (Workers AI embeddings we already have) and pick by similarity when the decision model times out. Do not copy code. |

### UI / product

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **14islands/component-loader-js** (MIT, 2016) | Instantiates JS classes from `data-component` attributes in server-rendered HTML | **Skip** | React/Next already owns component mounting, including the marketing site. |
| **Vercel AI SDK** (ai-sdk.dev, Apache-2.0) | Model-agnostic TS SDK, UI hooks, `experimental_evaluate` for decision models | **Skip for chat; optional for server utilities** | Chat runs on Flue (`@flue/react`); a second chat stack is duplication. If a Next route needs a one-off generation, use AI SDK with the OpenRouter provider. Its `evaluate` shape is a useful reference for our decision client's types. |
| **Vercel Workflow SDK** (Apache-2.0) | Durable TS functions with steps, retries, suspend, local observability UI | **Skip** | We already have two durable engines (Inngest in the backend, Durable Objects + Queues in the agent). A third fragments ops. Borrow its **step-level run view** for our activity page. |
| **Vercel Flags SDK** (MIT) | Feature flags for App Router with adapters (PostHog, Statsig, Edge Config, custom), precompute, toolbar overrides | **Adopt** | Each decision point needs `off / shadow / enforce` and staged rollout per tenant; the onboarding framework already instruments PostHog. Write a custom adapter over the backend's `feature_flags` table (`src/marketer/repos/feature_flags.py`) or use the PostHog adapter. |
| **agent-browser** (agent-browser.dev, Apache-2.0, Rust CLI) | Accessibility-tree browser control for agents | **Adopt (dev/QA only)** | Use for a scripted Marketer web walkthrough in CI and for exploratory QA (the skill is already installed in this environment). In-product browsing stays on Firecrawl/Jina, which the agent already has. |
| **Turborepo** (MIT) | Monorepo task runner with caching | **Skip** | Three toolchains (npm in `web/`, pnpm in `agent/`, uv for Python) and three deploy targets. Turborepo only pays off after consolidating JS into one pnpm workspace; low value now. |
| **SWR** (MIT) | Stale-while-revalidate data hooks | **Adopt (already a dependency; standardise)** | See section 6. |
| **Vercel deepsec** (`vercel-labs/deepsec`, Apache-2.0) | Agent-powered vulnerability scanner; resumable; costs can run to thousands of dollars | **Adopt once, capped** | Run it once before turning on paid ads in production, with `--max-cost-usd`, over `backend/`, `src/marketer/services/ad_*` and `agent/src`. Not a per-PR job. |
| **Nitro** (`nitrojs/nitro`, MIT) | Universal server toolkit (Nuxt's engine) | **Skip** | Would be a fourth server runtime next to Next.js, Workers and FastAPI. |
| **Svelte** (MIT) | UI framework | **Skip** | The app is React 19; no reason to split. |

### Skills structure

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **garrytan/gstack** (MIT) | ~40 role-named slash-command skills (CEO review, eng review, designer, QA, CSO, release engineer, retro, learn), each a `SKILL.md` with frontmatter (description with triggers, allowed tools, context queries into memory), a HARD GATE line, and artifacts that downstream skills read (office-hours writes the design doc everyone else uses). Sprint order: think → plan → build → review → test → ship → reflect | **Borrow** | The structure fits Marketer's plan → make → distribute → measure loop. Section 5 lists the marketing set. Copy the conventions: role persona, triggers, hard gate, produced artifact, memory context queries, and a `/learn` + `/retro` pair that feeds memory. |

### Harness

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **Parcha-ai/build** (**Build Source Available License: no commercial use**) | Desktop IDE over many coding harnesses; "Auto Build" routes plan/build/verify/refine to different models | **Skip (reference only)** | Licence forbids commercial use. The only idea, stage-specific model routing, we get from the decision-model plan anyway. |
| **LangChain** (MIT) | Generic LLM framework | **Skip** | Duplicates Flue/Agent Starter and the OpenAI Agents SDK already in the backend. |
| **pmndre/pine** (MIT; `pmndrs/pine` resolves to the same repo) | Event-driven agent harness: agents subscribe to event sources; "goal mode" re-runs the agent until a judge says the objective is met, and only the owner sets goals; a BM25 "manual" tool for self-discovery | **Borrow** | (a) **Goal judge** for the autopilot: "is the objective met / blocked / continue" is a decision-model choice question; only the owner sets it. (b) **BM25 manual**: let agents search Marketer's skills and API docs instead of loading them all. (c) Its event subscriptions match our signed-webhook background worker; nothing to adopt. |
| **omnigent-ai/omnigent** (Apache-2.0) | Meta-harness over coding agents with declarative policies: ALLOW / DENY / ASK, three levels (server, agent spec, session), first DENY wins, cost-budget policy with ask thresholds | **Borrow** | The **three-level policy stack** and **"ask at $X, deny at $Y"** budget policy map onto tenant caps (server), department limits (agent spec) and a per-conversation "spend up to $20 without asking" setting (session). |
| **Vercel eve** (`vercel/eve`, Apache-2.0) | Filesystem-first durable agents: `instructions.md`, `tools/`, `skills/` loaded on demand, `channels/`, `schedules/`; rule: memoise every fetch in per-call dynamic config | **Borrow** | Agent Starter already has this layout (`src/skills/*/SKILL.md`, schedules via heartbeat). Take the **memoise rule** for any per-model-call context loading (brand kit, tenant config), which today can repeat per call. |

### Execution rails

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **withcoral/coral** (Apache-2.0, Rust + TS UI) | "Execution rails for agents": a gateway where agents run short TS programs in a V8 isolate with no network or credentials; every tool call passes one Policy Enforcement Point (Allow / Ask / Block), gets credentials injected, and is recorded in an append-only Run Ledger; approvals are bound to exact arguments; working programs are saved as private or shared custom tools; a 1,000-line GLOSSARY with "Avoid:" terms and 32 ADRs carrying measured evidence | **Borrow (deeply)** | Our tool firewall, risk tiers and approval flow are a subset of coral's model. Section 4 maps every concept. We don't run coral itself: it would sit between our Workers agent and our own API, which is one hop too many, and its value for us is the rules and the docs discipline. |

### Performance

| Source | What it is | Verdict | Why |
|---|---|---|---|
| **addyosmani/web-quality-skills** (MIT) | Measurement-first skills: performance, core-web-vitals, accessibility, seo, best-practices, web-quality-audit; field + lab, traces, "no measurement = hypothesis" | **Adopt** (dev skills) **+ Borrow** (product) | Install into `.claude/skills/` for work on `web/` and the marketing site (gsap/motion heavy). Its SEO and CWV rules also feed the in-app **/audit-site** skill for customers' sites. Pair with Vercel's `react-best-practices` (waterfalls, bundle size) from `vercel-labs/agent-skills` (licence: check before vendoring; repo had no top-level LICENSE file in the clone). |

---

## 2. Decision-model plan

### 2.1 One decision layer, two languages

All decision calls go to `POST {OPENROUTER_DECISIONS_URL}` (default `https://openrouter.ai/api/alpha/decisions`)
with `OPENROUTER_API_KEY`, server-side only. The contract mirrors
`.intent-onboarding/packages/core/src/decisions.ts` so onboarding, agent and backend share one vocabulary.

**TypeScript (agent Worker and Next.js)** — new `agent/src/marketer/decisions/`:

| File | Job |
|---|---|
| `client.ts` | `fetch` to OpenRouter decisions with `AbortSignal` timeout, no retries on the hot path, reads `usage.cost` (reject a response without cost, per claude-x-jev), returns `{answers, ms, model, cost}` or a typed failure. Implements `DecisionAdapter`. Env from `ctx.services.env`, like `src/marketer/api.ts`. |
| `questions.ts` | **Every question, option, criterion and threshold in one module** (TypeSafe guidance). Versioned: `HOOK_QUESTIONS_V1`. |
| `tables.ts` | The truth tables: answers → action. Pure functions with unit tests. |
| `run.ts` | `decide(point, state)`: reads the point's mode (`off/shadow/enforce`) and timeout, calls `decideWithin`, applies the table, falls back to the rule, logs. |
| `log.ts` | Writes `{point, model, questionsVersion, stateHash, answers, fallbackUsed, latencyMs, cost, actionTaken}` to telemetry and to the backend `decision_log`. |

**Python (backend pipelines)** — new `src/marketer/services/decisions.py` (httpx, same timeout/fallback/log
contract) and `src/marketer/decisions/questions.py`. Meter every call into `spend_ledger` through the existing
`agents/metered.py` path, using OpenRouter's `usage.cost` as the SKU price.

**Backend schema** — migration `0026_decision_log.sql`: `decision_log` (append-only) plus a nullable
`outcome`/`correction` column filled later (a person's override, post engagement, QA result). This is the
jevmail "correction next to the answer" loop and the data `tune` needs.

**Rollout per point** — `off → shadow (log only, act on the rule) → enforce`, set per tenant with the Flags SDK in
the web app and the `feature_flags` table in the backend. Promote a point to enforce only after a labelled run shows
the chosen threshold meets its precision bar (claude-x-jev `tune`). Pin dated model slugs so a model release can't
move a tuned threshold.

**Model tiers on OpenRouter**

| Tier | Endpoint | Use |
|---|---|---|
| D1 decision, default | `/api/alpha/decisions`, `typesafe/jev-1.13-<date>` | Every judgment below |
| D0 decision, cheap fallback | same endpoint, `kev-4b` (or `perplexity/pplx-decider-flash-v1.2`) | Second try when D1 is down; batch scoring of large candidate sets |
| G-fast generation | `/api/v1/chat/completions`, a cheap model (the backend's curated list already has DeepSeek V3.1 and Llama 4 Maverick) | Cascade: reads only the unsure slice; rewrites |
| G-strong generation | `/api/v1/chat/completions`, the configured frontier (today `openai/gpt-6.1-terra` in `agent/agent-starter.config.ts`) | Writing, planning, the hard cases |

### 2.2 Failure rule: tighten, never loosen

- A decision model may **raise** a risk tier, add a review, or hold a draft. It may **never** lower a tier, approve
  CRITICAL work, or move money. This keeps `EXPECTED_RISK` and the backend's fail-closed guard authoritative.
- **Money and publishing fail closed**: timeout, error or abstain → the action goes to a person (or no proposal).
- **UX and ranking fail open to the rule**: timeout → today's rule-based behaviour, silently.
- A failed call is an error, never a "no" (TypeSafe skill).

### 2.3 Decision points

| # | Decision point | State (inputs) | Questions → output | Tier | Timeout | Rule-based fallback | Where in our code | Inspired by |
|---|---|---|---|---|---|---|---|---|
| 1 | **Route a request to a department** | The person's message, last 3 turns, open work items (names, not ids) | `choice` department (strategist / content-producer / seo-editor / media-buyer / distribution-manager / analyst) + `noul` "Does the message ask for more than one department's work?" + `noul` "Does it involve spending ad money?" → if multi or low confidence, the frontier model plans as today; if ad money, force the `paid-media-safety` skill | D1 | 800 ms | Embedding similarity to department identity strings (gravity idea) then today's path: the frontier model chooses via `delegate_task` | `agent/src/agents/assistant.ts`, `agent/src/multi-agent/roster.ts` (`DELEGATION_ROSTER`), new `agent/src/marketer/decisions/` | system-one-connector department example, corpus-intelligence gravity, hermes-jev-skills |
| 2 | **Model tier per turn** | Message, whether tools will be needed, conversation length | `score` complexity (4 situational levels) → G-fast vs G-strong in the router | D1 | 500 ms | Agent Starter's first-line LLM classifier (`ModelRouter` `firstLineProfile`) | `agent/src/lib/platform.ts` `modelOptions()`, `vendor/agent-starter/core/src/models/router.ts` | hermes-jev-skills, jev-kit tier guard |
| 3 | **What to post next** | Niche, brand kit summary, 10–30 candidate topics (each its own question, per TypeSafe), last 30 days' winners/losers | Per candidate `score` "How likely is `candidate` to interest `audience`?" + `noul` "Does `candidate` repeat a topic in `recent_posts`?" + `noul` "Is it on-niche?" → code ranks: drop repeats and off-niche, sort by score, tie-break on freshness | D1 (D0 for >30 candidates) | 2 s | Today's ideation prompt with `performance_context` and recent-topic dedupe | `src/marketer/agents/ideation.py`, `agents/performance_context.py`, `services/campaign_runner.py` (`run_campaign_tick`) | jevmail ranking, claude-x-jev `score` |
| 4 | **Score a hook or creative before spending** (before DALL-E/Grok/TTS cost, and before an ad creative goes live) | Hook text, script scene 0, niche, audience, brand rules | Atomic `noul`s: "Does the hook make a specific promise?", "Does it open with a greeting or filler?", "Does it name a number or concrete outcome?", "Does scene 0 open a loop the video pays off?", "Does it make a claim that `brand_rules` forbid?"; `score` "Would the target viewer stop scrolling?" (5 levels). Word count stays in code. → table: any forbidden-claim ≥ 0.5 → hold; hook-weak → regenerate hook once with G-fast; else proceed | D1 | 1.5 s | `src/marketer/evals/script_checks.py` deterministic checks, then proceed (render QA still runs later) | `src/marketer/agents/scriptwriter.py` (after script, before `visual_director.py`), `src/marketer/pipeline.py`; ads: `agent/src/marketer/tools/ads.ts` creative drafts + `services/ad_actions_exec.py` | claude-x-jev cascade, jev-kit pre-filter |
| 5 | **Budget shifts** (judgment inputs only; the number stays in code) | Campaign 7-day metrics (spend, CTR, CVR, ROAS by day), recent changes log, creative ages | `noul` "Did conversions drop to near zero on the same day spend continued?" (tracking break), `noul` "Do the last 3 days show the same creative's CTR falling steadily?" (fatigue), `choice` cause of change (tracking / fatigue / seasonality / auction / real performance). → table: tracking-break → **no budget change, alert person**; fatigue → propose creative refresh, not budget; real performance → current `recommend_daily_budget` rule | D1 | 2 s | Fail **closed**: run today's ROAS rule unchanged (still guarded and approval-gated) | `src/marketer/services/ad_workflows.py` (`recommend_daily_budget`, `optimize_campaign`) | TypeSafe "judgments from Jev, decisions in code" |
| 6 | **Approval risk scoring** (tighten only) | Tool name, risk tier, redacted args, the content to be published, brand rules, account governance | For content: `noul` per brand rule ("Does `caption` break `rules[3]`?"), `noul` "Does it make a health, finance or legal claim?", `noul` "Does it name a competitor?"; for agent tool calls: jev-kit style pre-filter, then a `choice` approve/escalate/block. → table: any rule broken or regulated claim → force human approval even in auto-post mode; otherwise the existing tier decides. Never auto-approves CRITICAL | D1 | 1 s | Fail **closed**: escalate (today's `review.ts` already escalates on failure) | `agent/vendor/agent-starter/core/src/persistent/review.ts` (put a Jev pre-filter in front of the LLM reviewer via a Marketer wrapper, not a vendor edit), inbox priority in `backend/routes/workspace.py`, `web/components/app/inbox/decide.ts` | jev-kit airlock, claude-x-jev gate thresholds (approve ≥0.9 / block ≤0.1) |
| 7 | **Onboarding pre-selection** | Email domain, website text, detected tech, ICP segment | Already designed: `decisionEnricher`, `classifyItems`, `rankItems` | D1 via OpenRouter | 1.5 s (engine default) | The spec's `preselectWhen` rules (already in `onboarding/spec.ts`) | **Wire it**: new `web/app/api/onboarding/decisions/route.ts` using `handleDecisionsRequest(jevDecisions({ via: 'openrouter' }))`; browser uses `httpDecisions('/api/onboarding/decisions')` in `web/components/app/onboarding/flow.tsx` | `.intent-onboarding/packages/decisions-jev` (exists, unwired) |
| 8 | **Best time to post** | Mostly not a model problem | Code: engagement by hour/weekday from `post_metrics` per channel with a minimum sample; a model is used only at **cold start**: `choice` audience type (B2B professionals / consumers / students / creators…) mapped to prior windows | D1 (cold start only) | 1 s | Playbook posting windows, then platform defaults | `src/marketer/services/scheduler.py`, `services/campaign_runner.py` (`_due`), `src/marketer/repos/calendar.py`, `repos/post_metrics.py` | Honest call: TypeSafe "arithmetic and dates belong in code" |
| 9 | **QA of a video or article** | Article: draft, SERP brief, brand rules; video: script, transcript, real duration (from ffprobe), keyframes (images supported) | Verify pattern (claude-x-jev `draft-verify`): `choice` grounded (supported / unsupported / declined), `noul` per brand rule, `noul` "Does the transcript match the script's takeaway?", image `noul` "Does `keyframe` contain garbled text?" → ship only if grounded = supported ≥0.8 AND every check ≥0.9; one failure bounces, never average | D1, unsure slice to G-strong | 3 s | Today's LLM `QAReport` (`agents/qa.py`) and article QA scoring, then the deterministic ffprobe gate | `src/marketer/agents/qa.py`, `src/marketer/services/video_qa.py`, `src/marketer/articles/pipeline.py` | claude-x-jev verify, jev-seo |
| 10 | **Comment and inbox triage** | Comment text, post it replies to, author history | `choice` kind (question / praise / complaint / lead / spam / troll), `score` reply value, `noul` "Does a person need to answer this?" → tray + draft only for the unsure slice | D1 | 1 s | Show untriaged, newest first | Distribution department; backend comments ingestion (new); `web/components/app/inbox/*` | jevmail, claude-x-jev `comment-triage` preset |
| 11 | **Memory write gate** | The last user message | `noul` "Does this message state a lasting fact or preference about the brand, audience or offer?" → only then run the LLM extraction into the entity graph | D1 | 400 ms | Explicit `remember_note` only (today) | `agent/src/agents/assistant.ts`, new `agent/src/marketer/memory/` | gbrain facts hook |
| 12 | **Autopilot: anything worth proposing? / goal met?** | Overview, inbox, spend today, the owner's objective | `noul` "Is there an item in `inbox` waiting more than a day?", `noul` "Is spend today above the pace for `daily_cap`?" (computed in code and stated as a fact), `choice` goal status (met / continue / blocked) | D1 | 1.5 s | Today's heartbeat prompt | `agent/src/marketer/heartbeat.ts`, `agent/src/agents/persistent.ts` | pine goal judge |
| 13 | **Context compaction** | Conversation with tool results replaced by size notes | Per old tool call `noul` "Is the result of `t12` still needed for the current task?" → drop or truncate, never rewrite | D1 | 2 s | Agent Starter's summarising compaction (`models.compaction`) | Compaction hook config in `agent/src/lib/platform.ts` | fast-jev-compaction |

Points 1, 4, 9, 10 and 7 carry most of the value and least risk; start there.

### 2.4 "All models go through OpenRouter": what moves, what is an exception

- **Agent chat/generation**: point the Flue OpenAI provider at OpenRouter (`flue/src/models.ts` already accepts a
  `baseUrl`; or add a `ChatCompletionsProvider` from `core/src/models/providers/openai-compatible.ts`, whose
  docstring lists OpenRouter). Keep Cloudflare AI Gateway in front if you want its caching and analytics; it can
  proxy OpenRouter. Model ids in `agent/agent-starter.config.ts` become OpenRouter slugs.
- **Backend LLM calls** (ideation, scripts, QA, articles, niche drafts): one `AsyncOpenAI(base_url=openrouter)` client,
  extending what `services/openrouter.py` already does for the scriptwriter. Replace the curated price table with
  OpenRouter's returned `usage.cost` for metering: less drift.
- **Exceptions to decide on explicitly** (not LLM text calls): Workers AI embeddings and reranker
  (`@cf/baai/bge-*`, local and free, and the Vectorize index is 768-dim), the Workers AI first-line/compaction models,
  OpenAI TTS and Whisper, DALL-E/gpt-image, Grok Imagine video, ElevenLabs and fal. Check OpenRouter's current
  image and embeddings coverage before moving those; moving embeddings means re-indexing.

---

## 3. Memory plan

### 3.1 What we have and what's missing

| Existing piece | Gap |
|---|---|
| `VectorMemory` notes, user-scoped, redacted, TTL (`platform.ts` `vectorMemory`) | Only written when the person says "remember"; nothing captured automatically |
| `KvEntityGraphStore` (`core/src/memory/entity-graph-store.ts`): attributes `{value, confidence, updatedAt}`, edges | **Overwrites**: a changed brand voice loses its history; no link from a fact to where it came from; no marketing types |
| Provenance + trust for persistent memory (`core/src/persistent/memory.ts`) | Only for the autopilot; chat memory has no trusted/untrusted split |
| `performance_context.py` winners/losers | Lives only in the backend prompt; departments and chat never see "what worked" |
| Compaction via Workers AI summary | Lossy for ids, numbers and constraints |

### 3.2 What to build (in order)

1. **Marketing ontology (graphiti "prescribed ontology")** — `agent/src/marketer/memory/ontology.ts`: entity types
   `Brand`, `Offer`, `Audience`, `Competitor`, `Channel`, `Campaign`, `Creative`, `Claim` (approved / forbidden),
   `Preference`; edge types `targets`, `competes_with`, `runs_on`, `forbids`, `prefers`. Pass the types into the
   extraction schema (today `ExtractionSchema` accepts any 40-char type string).
2. **Temporal facts with provenance (graphiti)** — a Marketer wrapper over `EntityGraphStore` (don't fork the vendor;
   upstream to Agent Starter later) storing each attribute/edge as `{value, confidence, validFrom, invalidAt?,
   supersededBy?, episode: {kind: message|job|metric|approval, id, at}}`. A new value **invalidates** the old one,
   never deletes it. Recall returns current facts by default; "what was our positioning in March?" reads history.
3. **Hot facts → cold learnings (gbrain)** —
   - *Hot*: per turn, decision point 11 gates a cheap extraction into the graph as **untrusted** until the owner
     confirms it (reuse `provenanceFor`, `renderRecalledMemory`).
   - *Cold*: a nightly pass (`agent/src/lib/cron.ts`, or the autopilot heartbeat) consolidates hot facts, runs a
     **contradiction probe** ("brand rules say no emoji; last week's approved posts use emoji") and puts each
     contradiction in the person's inbox as a question instead of guessing.
4. **Outcome memory: Learnings (gbrain "takes", gstack `/learn`)** — backend table `learnings`
   (`claim`, `kind: fact|take|bet`, `evidence: {metric, n, lift, window}`, `confidence`, `status: active|retired`,
   `source`). The analyst writes them from `post_metrics` and `ad_metrics_daily`; ideation, scriptwriter, strategist
   and the media buyer read them. `performance_context.py` becomes one producer of learnings rather than a one-off
   prompt block. Mirror active learnings into vector memory for recall.
5. **Procedural memory (langgraph)** — when the person rejects or edits drafts, propose a style rule
   ("never start with a question") as a brand-kit change; it becomes **trusted only after approval** (HIGH tier
   `update_brand_kit` already exists).
6. **Evidence delivery (gbrain `return_unit: auto`)** — recall returns the whole brand-kit section or whole learning
   with its evidence, inside a token budget, instead of an 800-char chunk.
7. **Memory page in the app** — under Brand/Settings: every fact with its source, valid-from, trust, and
   Edit / Forget; learnings with their evidence. People trust memory they can see and correct.
8. **Compaction** — try decision point 13 behind a flag; keep the summary as fallback.

Skipped: LangGraph checkpointers (Durable Objects already persist runs), running graphiti or gbrain as services.

Evals: add `agent/evals/memory.yaml` (promptfoo): tell → recall across conversations; changed fact → new value wins
and history is queryable; untrusted fact never overrides a brand-kit rule.

---

## 4. Execution rails modeled on coral

### 4.1 Concept map

| Coral concept | What it means there | Marketer today | Change |
|---|---|---|---|
| **Tool Hints** (read-only, destructive, idempotent, open-world), declared never inferred | Only a declared read-only hint loosens policy | `defineAgentTool` `risk`, `sideEffect`, `idempotent`; `readTool` = LOW | Add `destructive` and `spendsMoney` hints to `writeTool` and show them as labels in approval cards. Keep the rule: undeclared = not read-only. |
| **Tool Access State** (`enabled` / `approval_required` / `disabled`), exact rules, safe default | Owner sets per tool; default Ask for anything not read-only | Risk tiers + tenant `authorizedTools` globs + department grants | An "Agent permissions" page: per-tool exact state per tenant, stored in tenant config. Users can tighten anything; loosening is capped by the tier (CRITICAL is always `approval_required`). |
| **Policy Enforcement Point** | One authoritative check at dispatch against **current** facts; a cached decision never authorizes | Firewall + approvals in the agent; `ad_actions_exec.py` re-guards at execution | Write it down as a rule and enforce it on **every** HIGH/CRITICAL backend endpoint, not just ads: re-read kill switch, caps, approval binding, account state at dispatch. |
| **Invocation Approval** bound to exact args, principal, account version; single-use; first decision wins; agent never approves | — | Signed approval links bound to the recipient; ad approvals single-use | Bind the approval token to `sha256(tool, args, accountGovernanceVersion)`; reject if any changed (e.g. budget cap edited after the request). Record approver, time, comment. |
| **Required Action** | One shape for anything a person must decide (approval, account connection, later questions), each with a deadline and one link | Approvals, `ask_person` questions, OAuth connect for ads, and inbox items are separate flows | Unify into one `required_actions` model and one Inbox lane in the web app; the agent passes the link on and has no path to decide. |
| **Run Deadline** | One clock; waits for people never extend it; late decisions do nothing | Approvals have their own expiry | A department task's deadline bounds its approvals; expired → `approval_expired`, visible. |
| **Tool Invocation states** and **`indeterminate`** outcome | `pending → dispatching → ended`; ended = upstream outcome / failure / run terminated / **indeterminate** (dispatched, result unknown) | Idempotency ledger marks an interrupted call UNKNOWN and never re-runs it (`define.ts`) | Surface **indeterminate** to the person for publish and ad calls ("We can't confirm the post went out. Check TikTok before retrying") and never auto-retry. |
| **Run Ledger** (append-only, one order, first commit wins) + **Run Status Page** | Every event of a run, durable | `ad_actions_log` (append-only) for ads; agent telemetry | Per department task: an append-only ledger of decisions, invocations, approvals and outcomes, rendered in `web/app/(app)/activity`. Include decision-model answers (section 2 log). |
| **Fan-out Limit**, **Run Output Budget**, **Context Impact** | Cap concurrent dispatches; byte-exact output budget; measure bytes saved | `maxCallsPerTool`, `maxTotalCalls`, `maxOutputChars`, cost ceiling | Add a per-run concurrent-dispatch cap for credit-spending makers (e.g. ≤3 videos in flight) and report context impact on recipes. |
| **Programs + Private/Shared Tools** ("save what worked as a custom tool") | Agent writes TS that calls tools in an isolate; saves it; owner can share; each saved tool has its own Allow/Ask/Block and every inner call still hits the PEP | Skills (instructions) only | **Recipes**: when a multi-step task succeeds, the agent proposes saving it as a named recipe = a declarative list of existing guarded tool calls with fixed parameters and a narrower rule (e.g. `boost_winner`: raise budget ≤10% only for campaigns at or above target ROAS for 7 days). Recipes get their own access state; inner calls still go through tiers and approvals. Start declarative (JSON steps, no code). Code-mode programs (Workers dynamic isolates) only later, if recipes prove too rigid. |
| **Task** with declared intent and terminal outcome | Groups attempts; completion feedback | Plans (`plan_goals`) and delegated tasks | Link every run to a Marketing Task with a declared goal and outcome, so retros and learnings can count what worked. |
| **Attribution** | Every run attributed to the Principal (user vs agent) | Approver = Clerk user; autopilot has its own identity | Show who started each action (person, Marketer, autopilot, webhook) everywhere in Activity. |

### 4.2 Docs to write (coral's discipline)

Coral keeps a `GLOSSARY.md` where each term has one meaning and an **"Avoid:"** list of words not to use for it,
and ADRs (`docs/adr/NNNN-<decision-as-a-sentence>.md`, `status:` front matter) that record the decision, the
reason and, where possible, a measured comparison. Proposed for Marketer, in a new root `docs/`:

- `GLOSSARY.md` — Tenant, Principal, Department, Tool, Risk Tier, Access State, Approval, Required Action, Run, Run
  Ledger, Invocation, Indeterminate, Recipe, Decision Point, Decision Model, Learning, Fact, Brand Rule. Each with
  "Avoid:" terms (e.g. Approval — *Avoid*: confirmation, permission, consent).
- `docs/rails/README.md` — the rails in one page: tiers → access state → enforcement point → approval → ledger.
- `docs/rails/risk-tiers.md` — the `EXPECTED_RISK` table explained, how to change a tier on purpose.
- `docs/rails/enforcement-point.md`, `approvals.md`, `required-actions.md`, `run-ledger.md`,
  `failure-semantics.md` (money fails closed, content fails open, indeterminate never retried), `recipes.md`,
  `decision-models.md` (the tighten-only rule, modes, thresholds, how to add a point).
- ADRs to seed:
  `0001-decision-models-judge-and-code-decides`, `0002-a-decision-model-can-tighten-never-loosen-a-tier`,
  `0003-money-paths-fail-closed`, `0004-approvals-are-bound-to-exact-arguments-and-single-use`,
  `0005-one-enforcement-point-reads-current-facts-at-dispatch`, `0006-indeterminate-outcomes-are-never-retried`,
  `0007-recipes-compose-guarded-tools`, `0008-all-model-calls-go-through-openrouter` (with the exception list),
  `0009-facts-are-invalidated-never-deleted`, `0010-learnings-carry-their-evidence`.
- Link them from `agent/AGENTS.md` and root `AGENTS.md` so coding agents read them first.

---

## 5. In-app skills, gstack style (marketing)

Runtime skills live in `agent/src/skills/<name>/SKILL.md` and are registered through `customSkills` in
`agent/agent-starter.config.ts` (see `src/skills/custom.generated.ts`). Each one copies gstack's shape: a role,
`description` with trigger phrases, the department whose tools it may use, a **HARD GATE** line, the artifact it
writes, and memory context queries (brand kit, learnings, last brief). Exposed in chat as slash commands.

| Skill | Role | Purpose (one line) |
|---|---|---|
| `/brief` | Head of marketing (office-hours) | Six forcing questions on offer, audience, wedge and proof; writes the **Marketing Brief** every other skill reads. Gate: no content made. |
| `/positioning-review` | CMO (plan-ceo-review) | Rethink positioning against competitors; modes expand / hold / narrow; edits the brief. |
| `/plan-campaign` | Strategist (autoplan) | Turn a goal into a cross-department plan with cost in USD and every approval it needs; asks once. |
| `/brand-voice` | Brand designer (design-consultation) | Build or refresh the brand kit from samples the person likes and dislikes; proposes rules as approvals. |
| `/hook-lab` | Creative director (design-shotgun) | Generate 10–20 hooks, score them with decision point 4, show the top 3 with why; remembers picks. |
| `/content-batch` | Content producer | A week of short videos and carousels from one pillar, inside the credit budget; checks work in flight first. |
| `/seo-brief` | SEO editor | SERP research → outline → article brief for one keyword, with intent and gaps. |
| `/repurpose` | SEO editor | One article into posts per channel, each verified against the article (decision point 9). |
| `/calendar-fill` | Distribution manager | Place approved pieces into posting windows from data (decision point 8); flags gaps. |
| `/creative-review` | Design reviewer (design-review) | Score drafts against the brand kit and learnings, fix what fails, bounce what can't be fixed. |
| `/ad-test-plan` | Media buyer (eval-plan) | Pre-register an ad test before any spend: hypothesis, budget cap, stop rules, success metric. Gate: no activation. |
| `/scale-winner` | Media buyer | Propose budget changes inside the kit's scaling rules; always CRITICAL approval. |
| `/budget-guard` | Spend warden (careful / guard) | Tighten caps, set the kill switch, freeze spend now; reports what changed. |
| `/launch` | Launch manager (ship) | Pre-launch checklist: assets approved, channels connected, tracking live, approvals clear, then schedule. |
| `/comment-triage` | Community manager | Sort comments and DMs, draft replies only for the ones that need a person (decision point 10). |
| `/competitor-watch` | Analyst (browse / scrape) | Read competitors' pages and public ad libraries; record changes as facts with sources. |
| `/audit-site` | SEO auditor (jev-seo, web-quality) | Crawl the customer's site against SEO and Core Web Vitals rules; ranked fix list. |
| `/retro` | Analyst (retro) | Weekly: what moved, why, what to do more and less of; writes Learnings with evidence. |
| `/learn` | Memory keeper (learn) | Review, search, retire or correct what Marketer has learned and remembered. |
| `/report` | Reporter (document-release, make-pdf) | Stakeholder report for a period, numbers with sources, as a shareable page or PDF. |

---

## 6. Smaller wins

- **SWR (already installed)**: standardise every client read on `useSWR` through `web/lib/client-fetcher.ts`;
  conditional `refreshInterval` only while a job is in flight (render progress, article writing); optimistic
  `mutate` for approve/reject in the inbox; dedupe the shared workspace overview across pages; remove hand-rolled
  polling.
- **Virtualization**: `@tanstack/react-virtual` for `web/components/app/library/library-view.tsx`,
  `web/components/app/activity/activity-view.tsx`, the ads activity log and long chat threads. Not
  react-virtualized.
- **Flags SDK**: one flag per decision point (`off/shadow/enforce`) and per new feature (recipes, memory page),
  custom adapter over the backend `feature_flags` table, or PostHog.
- **promptfoo suites** (extend `agent/evals/`): `hooks.yaml` (hook quality vs rubric), `brand-rules.yaml`
  (drafts respect forbidden claims), `approvals.yaml` (no HIGH/CRITICAL tool ever runs without approval, including
  via recipes), `memory.yaml`, and `decisions.yaml` (a labelled set per decision point with precision/coverage
  bars, pinned model slug). Use promptfoo's Python provider for backend pipeline checks next to
  `src/marketer/evals/script_checks.py`.
- **Performance skills**: vendor `web-quality-skills` (performance, core-web-vitals, seo, accessibility) and
  Vercel `react-best-practices` into `.claude/skills/`; measure the marketing site first (heavy gsap/motion, React
  bits) and report field + lab numbers, not guesses.
- **Memoise per-call context** (eve rule): brand kit and tenant config loaded once per turn, not per model call.
- **BM25 manual** (pine): let agents search skills and API docs on demand instead of loading every SKILL.md.
- **agent-browser walkthrough**: a scripted sign-up → onboarding → make a video → approve → schedule path in CI,
  ending with console errors (should be empty).
- **deepsec**: one capped scan before paid ads go live in production.
- **Per-session spend policy** (omnigent): "spend up to $X in this conversation without asking", always under the
  tenant cap.

---

## 7. Suggested implementation order

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | Decision client (TS + Python), question registry, truth-table module, `decision_log` migration, per-point modes via flags | M (3–4 days) | — |
| 2 | Wire onboarding decisions route (code exists in `.intent-onboarding`) | S (half a day) | 1 (key) |
| 3 | Move LLM text calls to OpenRouter (agent config + backend client), meter on `usage.cost`; write the exceptions ADR | M (2–3 days) | — |
| 4 | Shadow-mode points 1, 4, 9, 10 + labelled eval sets in promptfoo | M (1 week) | 1 |
| 5 | Rails docs: GLOSSARY + 10 ADRs + `docs/rails/*` | S–M (2–3 days) | — (can run in parallel) |
| 6 | Rails code: args-bound approvals, indeterminate outcomes surfaced, unified Required Actions inbox, enforcement point on all HIGH/CRITICAL endpoints | L (2 weeks) | 5 |
| 7 | Memory: ontology + temporal facts wrapper + learnings table + memory page | L (2 weeks) | 1 (write gate) |
| 8 | Enforce points 4, 9, 10 where precision bars pass; shadow 5, 6, 12 | M (1 week) | 4 + data |
| 9 | Skills pack: start with `/brief`, `/plan-campaign`, `/hook-lab`, `/ad-test-plan`, `/retro`, `/learn`; then the rest | M per batch of 5 | 4, 7 |
| 10 | Recipes (declarative saved compositions with their own access state) | L (2 weeks) | 6 |
| 11 | Smaller wins: SWR standardisation, virtualization, perf skills, walkthrough, deepsec | S each, run alongside | — |

Licence notes: AGPL sources: none in this set. **Parcha `build` (BSA, no commercial use)** and
**`corpus-intelligence` (no licence)** are reference only. Everything else is MIT or Apache-2.0; copy with
attribution in a NOTICE file if code is taken (none of the plan above requires copying code).
