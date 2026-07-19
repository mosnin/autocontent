# OPERATOR GOAL — ads serving layer, money trust, and the Kimi K3 platform Operator

The binding goal document for the 5-team build operation (Opus leads, Sonnet
workers) and the audit operation that follows. A cycle is complete when every
team's cycle deliverables merge green (pytest + ruff + tsc + next build). The
GOAL is complete when all 30 steps below are DONE, comprehensively (no MVP
stubs, no fake data, fail-closed everywhere, tests for every behavior).

## Non-negotiable invariants (every team, every cycle)

- Every platform mutation flows through the existing safe-execute guard,
  approval threshold, and audit log (`ad_actions_exec.py`). No tool or agent
  ever calls `composio_client` spend ops directly.
- Every LLM call is metered into the spend ledger. The Operator's own
  inference is metered and capped like user spend.
- Fail-closed: missing key/config = clean refusal with a clear message,
  never a silent success or fake data.
- External providers are integration-tested against recorded fakes in this
  sandbox; live verification happens post-deploy with real keys (step 30).
- No em/en dashes in user-visible copy. The noun is "channel".
- Migrations are additive; reserved numbers below; rollback file for each.

## Team charters and file ownership (STRICT — never edit another team's files)

### Team 1 SERVING (steps 1-6) — make campaigns actually serve
Owns: `src/marketer/services/composio_client.py`, `src/marketer/services/ad_actions_exec.py`,
`src/marketer/repos/ads_structure.py` (new), `backend/routes/ad_structure.py` (stub registered
at /api/v1/ads/structure), `db/migrations/0026_ad_serving.sql` (+rollback),
`web/app/(app)/ads/campaigns/**`, `web/lib/ads-client.ts`,
`tests/test_ad_structure_*`, `tests/test_ads_composio_client.py`, `tests/test_ad_actions_exec.py`.
Deliverables: ad_sets wired (repos/routes/UI) with typed per-platform targeting;
`ads` table (0026) linking ad set + creative + final_url + external ids +
policy_status; Composio ops create_ad_set/create_ad/upload_creative_asset/
add_keywords (config-slugged, fail-closed); idempotency keys + reconcile-by-name
on ALL platform creates; Studio media -> ad creative bridge; campaign detail
becomes a structure builder UI. Definition of done: a draft campaign can be
fully structured (campaign -> ad set -> ads with creatives) locally and, when
keys exist, created on-platform through governance; timeout retries can never
double-create.

### Team 2 TRUST (steps 7-11) — money you can leave alone
Owns: `src/marketer/services/composio_read.py` (new; imports execute_tool from
composio_client, never edits it), `src/marketer/services/ad_workflows.py`,
`src/marketer/services/inngest_app.py`, `backend/routes/ads.py`,
`db/migrations/0027_ads_trust.sql` (+rollback), `web/app/(app)/ads/approvals/**`,
`web/app/(app)/ads/insights/**`, `web/lib/ads-trust-client.ts` (new),
`tests/test_ad_workflows.py`, `tests/test_ads_route.py`, `tests/test_ads_trust_*`.
Deliverables: status/policy read-back reconciled in the sync cron with
disapproval alerts (reuse performance_alerts); spend-vs-cap reconciliation that
auto-pauses via the governed path when synced platform spend breaches user
caps; conversion-action detection with honest "optimizing on CTR only"
degradation flag on campaigns; ad-level daily metrics table (0027) + sync so
experiments get real per-arm attribution; batch approve/reject endpoints + UI +
pending-approvals email digest (reuse the email service).

### Team 3 AGENT CORE (steps 12-19) — Kimi K3 Operator foundation
Owns: `src/marketer/services/llm_gateway.py` (new), `src/marketer/services/operator_runtime.py`
(stub exists — fill), `src/marketer/agents/operator.py` (new),
`src/marketer/agents/operator_tools.py` (new), `src/marketer/repos/agent_runs.py` (new),
`backend/routes/agent.py` (stub registered at /api/v1/agent),
`db/migrations/0028_agent_core.sql` (+rollback), `tests/test_operator_*`,
`tests/test_llm_gateway*`.
Config (pre-added, read-only): `openrouter_api_key`, `operator_model`
(default moonshotai/kimi-k3), `operator_enabled`, `operator_max_run_usd`,
`operator_daily_usd_cap`, `operator_max_turns`.
Deliverables: OpenAI-compatible OpenRouter gateway with usage extraction
metered into the spend ledger at OpenRouter pricing; an Agents-SDK model
provider so the Operator runs Kimi K3 (OpenAI-model fallback when OpenRouter
unset; disabled cleanly when neither); migration 0028 agent_runs + agent_events
+ agent_settings (autonomy level suggest/approve/act, budgets, kill switch);
the Operator agent with a written system contract, max-turns + dollar caps,
every step persisted; tool belt v1 (reads: channels, spend, metrics, alerts,
queue, articles, campaigns+structure, media, gsc) and v2 (governed writes:
propose_topics, enqueue plan-first video, studio image, draft campaign/ad
set/ad via Team 1's service layer import-only, propose budget, publish
article) with strict arg validation; an eval harness of golden tasks with
recorded tool transcripts runnable in CI with zero network.
API contract for Team 5 (BINDING, ship exactly this): 
`POST /api/v1/agent/runs {goal: str, autonomy?: "suggest"|"approve"|"act", budget_usd?: number}` -> AgentRun;
`GET /api/v1/agent/runs?limit&cursor` -> {items: AgentRun[], next_cursor};
`GET /api/v1/agent/runs/{id}` -> AgentRun; `GET /api/v1/agent/runs/{id}/events` -> AgentEvent[]
(poll-friendly, ordered, `seq` int); `POST /api/v1/agent/runs/{id}/cancel`;
`GET/PUT /api/v1/agent/settings`.
AgentRun: {id, user_id, goal, trigger: "manual"|"schedule"|"alert", status:
"running"|"done"|"failed"|"cancelled", autonomy, budget_usd, spent_usd,
result_summary, created_at, finished_at}. AgentEvent: {id, run_id, seq, kind:
"thought"|"tool_call"|"tool_result"|"proposal"|"error"|"summary", title,
payload jsonb, created_at}.

### Team 4 AUTONOMY (steps 20-26) — runbooks, schedules, wakes, brief
Owns: `src/marketer/agents/operator_runbooks.py` (new), `src/marketer/services/operator_heartbeat.py`
(stub exists — fill), `src/marketer/repos/operator_schedules.py` (new),
`db/migrations/0029_operator_schedules.sql` (+rollback), `tests/test_operator_heartbeat*`,
`tests/test_runbooks*`, `web/app/(app)/settings/operator/**` (schedules +
autonomy settings UI).
Deliverables: operator_schedules (cadence, standing goal, autonomy, budget per
wake, enabled); heartbeat scan (invoked hourly from the pre-wired
`operator_heartbeat` Modal function) that spawns due runs AND event-wakes:
unprocessed performance_alerts, freshly-decided approvals, newly-disapproved
campaigns each trigger a narrow-scope run (scan-based, via DB state; no
inngest edits — that file is Team 2's); runbooks as structured goal templates +
task-specific tool allowlists for: content-to-campaign (flagship: brand ->
copy + fal creatives -> draft campaign/ad set/ads -> budget proposal ->
approval), weekly content plan, underperformer rescue, stale-cadence nudge;
daily brief composed per user (what ran, what's proposed, what needs a
decision) sent via the email service + persisted. Interface with Team 3: call
`operator_runtime.start_run(user_id, goal, trigger, autonomy, budget_usd,
runbook=...)` — coordinate the exact signature with Team 3's lead through the
coordinator in cycle 1, then treat it as frozen.

### Team 5 SURFACE (steps 27-29) — the Operator console and chat
Owns: `web/app/(app)/agents/**` (new console: run list, run detail with live
event timeline polling /events, cost per run, inline proposal approve),
`web/components/operator-dock.tsx` (new chat dock), `web/components/site-shell.tsx`
(mount the dock), `web/lib/agent-client.ts` (new), `e2e/**` additions,
`tests/` none (web only).
Build against Team 3's BINDING API contract above from cycle 1; reconcile in
later cycles if the contract shifts (coordinator arbitrates). Console gets a
nav entry (pre-added by coordinator: Suite product, /agents). Comprehensive
means: live-feeling polling timeline, humane empty/error states, cancel,
settings surface for autonomy/budget/kill switch, dock available across the
app with run handoff into the console.

## Coordinator-owned (teams never touch)
`src/marketer/config.py`, `backend/main.py`, `modal_app.py` (operator function
stubs pre-wired), `web/lib/products.ts`, `web/components/command-palette.tsx`,
`pyproject.toml`, `.env.example`, `tests/conftest.py`, migrations 0001-0025,
this file, OPERATOR_CYCLE_LOG.md.

## The 30 steps (checklist)
Phase A (T1): 1 migration 0026 structure. 2 Composio serving ops. 3 ad-set/ad
repos+routes. 4 idempotent creates. 5 Studio creative bridge. 6 builder UI.
Phase B (T2): 7 status read-back + disapproval alerts. 8 spend-cap auto-pause.
9 conversion detection + honest degradation. 10 ad-level metrics. 11 batch
approvals + digest.
Phase C (T3): 12 config/keys. 13 llm_gateway. 14 SDK provider (Kimi K3).
15 migration 0028 runs/events/settings. 16 eval harness. 17 read tools.
18 governed write tools. 19 operator agent + persistence.
Phase D (T4): 20 content-to-campaign runbook. 21 content runbooks. 22 safety
model wired (autonomy levels, ceilings, kill switch). 23 schedules table+UI.
24 heartbeat cron. 25 event wakes. 26 daily brief.
Phase E (T5): 27 /agents console. 28 operator dock. 29 e2e + concurrency caps.
Post-goal: 30 live verification runbook doc (coordinator writes during audit).

## Audit phase (after all 30 steps DONE)
5 Opus-led audit teams, up to 3 cycles: (1) money-path adversarial audit,
(2) agent-safety audit (can the Operator be prompted past governance?),
(3) end-to-end product walkthroughs per product, (4) test-gap + failure-mode
audit, (5) claim-vs-reality audit (marketing/README/admin integrations).
Findings become fix cycles; done when a full cycle produces zero confirmed
findings.
