# Autonomous /goal — marketer.sh Ads product + Workspace suite (30-phase loop)

Persisted so progress survives container restarts. Update ADS_CYCLE_LOG.md as
work lands. Autonomous mode: free reign to choose the best implementation.

## /GOAL (final deliverable)
A production-grade **Ads** product inside a Google-Workspace-style marketer.sh
suite. AI agents (OpenAI Agents SDK + Composio toolkits) can connect ad
accounts (Google Ads, Meta Ads) and **create, manage, and scale** paid
campaigns; durable optimization/scaling/reporting workflows run on **Inngest**;
**every dollar of ad spend** is governed by budget guardrails, human approvals,
pacing, a kill-switch, and an append-only audit trail. The four products —
**Studio** (video), **Press** (articles + SEO/GSC), **Ads** (paid), and shared
**Suite** tools — live as **separate product dashboards** under one suite shell
with an app switcher (not one mashed sidebar). Everything is config-gated
(inert without keys), fully tested (ruff, pytest incl. real-Postgres
integration, tsc, next build), and migration-clean.

## Non-negotiable safety posture (paid ads = real money)
- No spend-affecting external call executes without: (1) a connected account,
  (2) budget headroom under the campaign's daily/lifetime cap, (3) approval for
  ops above a threshold, (4) an audit-log entry. Fail-CLOSED on ads spend
  (opposite of our fail-open notifications): if governance can't verify, refuse.
- Composio/Inngest are OFF by default (feature flag + missing keys). Tests mock
  all external calls. No real campaign is ever created from CI or the sandbox.

## Architecture decisions
- **Composio v3** Python SDK with the OpenAI-Agents provider; per-user OAuth via
  connected accounts (entity/user_id = our user_id). Toolkits: GOOGLEADS,
  METAADS (+ LinkedIn ad intel where available).
- **Inngest** Python SDK served on the existing FastAPI app (`/api/inngest`),
  deployed via Modal; triggers = events + crons; durable `ctx.step` checkpoints.
- **Money contract for ads** mirrors SpendContext discipline but fail-CLOSED,
  with its own ledger + caps distinct from LLM/pipeline spend.
- **Workspace**: product-scoped nav (Studio/Press/Ads/Suite) + app switcher +
  `/home` launcher; existing routes keep working, grouped by product.

---

## Phases (deliverable + tasks each)

### Workstream A — Workspace suite shell (separate product dashboards)
**Phase 1 — Product model + app switcher.** Deliverable: a `products` config
(id, label, icon, accent, home route, nav groups) and an app-switcher control in
the sidebar header. Tasks: define product registry; derive active product from
pathname; switcher UI (grid/menu) with keyboard support; unit-safe pure helpers.

**Phase 2 — Product-scoped sidebar.** Deliverable: the sidebar renders ONLY the
active product's nav; Suite (Settings/Admin/Connect/Brand/Billing) moves out of
the product nav into a suite menu/footer. Tasks: refactor AppSidebar to consume
the registry; per-product nav groups; active-state logic; mobile + collapsed.

**Phase 3 — Suite home launcher.** Deliverable: `/home` Google-style launcher
with a product card per product (status, quick actions, deep links). Tasks:
page + cards; post-login lands on `/home`; middleware allows it; empty/loading.

**Phase 4 — Suite chrome + polish.** Deliverable: product-accented header,
breadcrumbs, a11y, reduced-motion, responsive. Tasks: breadcrumb from route;
per-product accent token; focus order; tsc/build green.

### Workstream B — Ads data model + spend governance
**Phase 5 — Migrations.** Deliverable: `ad_accounts`, `ad_campaigns`,
`ad_sets` (ad groups), `ad_creatives`, `ad_metrics_daily`, `ad_budgets`,
`ad_actions_log` (append-only), with rollbacks. Tasks: SQL + FKs + indexes;
apply/rollback/reapply verified on fresh DB.

**Phase 6 — Repos + models.** Deliverable: pydantic models + asyncpg repos for
each table, all user_id-scoped. Tasks: repos with `_COLS`; typed models; unit
tests with stub pools.

**Phase 7 — Ad budget governance.** Deliverable: `AdSpendGuard` — fail-CLOSED
daily/lifetime cap check, pacing (spend-so-far vs. elapsed day), global account
cap, kill-switch flag. Tasks: guard service; deny reasons; tests incl. race.

**Phase 8 — Approvals workflow.** Deliverable: spend-affecting ops above a
threshold create an `ad_approval` (pending) that a human must approve before the
action executes. Tasks: approvals repo/model; approve/reject; threshold config.

**Phase 9 — Ads audit log.** Deliverable: append-only `ad_actions_log` capturing
actor (user/agent), action, target, before/after, dollar delta, ip/ua. Tasks:
recorder; list; integration test (append-only, real PG).

### Workstream C — Composio integration
**Phase 10 — Composio client wrapper.** Deliverable: `services/composio_client.py`
(config-gated singleton, OpenAI-Agents provider) + auth-config registry per
toolkit. Tasks: config keys; safe import; disabled-mode no-op; tests.

**Phase 11 — Connected accounts (OAuth).** Deliverable: initiate/list/status/
disconnect connections per platform, stored in `ad_accounts`. Tasks: repo wiring;
initiate → redirect_url; status poll; webhook/callback handling; tests (mocked).

**Phase 12 — Ads connect UI.** Deliverable: `/ads/connect` per-platform cards
(connect, status, disconnect). Tasks: client lib; cards; states; tsc/build.

**Phase 13 — Tool catalog + typed wrappers.** Deliverable: curated safe wrappers
for core actions (list/create campaign, set/adjust budget, pause/enable, fetch
metrics) per platform, normalized to our models. Tasks: wrappers; normalization;
tests (mock tools.execute).

**Phase 14 — Ads agent.** Deliverable: an OpenAI-Agents-SDK campaign
strategist/operator that plans and drafts campaigns using Composio tools +
brand kit + existing content. Tasks: agent def; instructions; guardrail prompts;
tests (stub Runner).

**Phase 15 — Safe-execute layer.** Deliverable: `execute_ad_action()` that wraps
EVERY spend-affecting Composio call through AdSpendGuard → approval gate →
audit-log → execute → record. Fail-CLOSED. Tasks: wrapper; reversal hooks;
tests (deny/approve/audit paths).

### Workstream D — Inngest durable workflows
**Phase 16 — Inngest wiring.** Deliverable: `services/inngest_app.py` client +
`inngest.fast_api.serve` mounted on FastAPI, Modal-deployed, config/env gated.
Tasks: client; serve mount; env (signing/event key, dev flag); disabled no-op;
health.

**Phase 17 — Campaign launch workflow.** Deliverable: durable fn: validate →
guard → create campaign → set budget → activate → confirm, each a `ctx.step`.
Tasks: fn + event; idempotency; failure/rollback; test.

**Phase 18 — Metrics sync workflow.** Deliverable: cron fn pulling daily metrics
per connected account into `ad_metrics_daily`. Tasks: cron; per-account fan-out;
upsert; test.

**Phase 19 — Optimization workflow.** Deliverable: durable evaluate → propose →
approval-gate → apply loop (bid/budget/creative rotation) per campaign. Tasks:
fn; proposal model; approval integration; test.

**Phase 20 — Budget scaling workflow.** Deliverable: scale winners / cap losers
under pacing + account caps + kill-switch. Tasks: scaling policy; guard checks;
test.

**Phase 21 — Alerting/anomaly workflow.** Deliverable: detect spend spikes,
disapprovals, account errors → notifications + outbound webhooks. Tasks:
detectors; wire to email/webhook; test.

### Workstream E — Ads product UI
**Phase 22 — Ads dashboard.** Deliverable: `/ads` product home — spend, ROAS,
active campaigns, pacing, alerts, approvals inbox count. Tasks: page; KPIs; SWR;
empty/loading/error.

**Phase 23 — Campaigns list + detail.** Deliverable: `/ads/campaigns` + detail
(status, budget, metrics chart, action buttons gated by approvals). Tasks: list;
detail; actions; a11y.

**Phase 24 — Campaign create wizard.** Deliverable: `/ads/campaigns/new`
objective→budget→audience→creative, with agent-assisted draft. Tasks: wizard;
draft action; validation; guard preview.

**Phase 25 — Optimization + approvals inbox.** Deliverable: `/ads/insights` +
`/ads/approvals` (approve/reject proposed spend changes). Tasks: views; approve
flow; audit surfacing.

**Phase 26 — Creatives bridge.** Deliverable: turn existing video/image/article
content into ad creatives (`/ads/creatives`). Tasks: content picker; map to
creative; per-platform format notes.

### Workstream F — Cross-product surfaces
**Phase 27 — SDK + MCP + CLI for ads.** Deliverable: SDK methods + MCP tools +
CLI for connect/list/create/scale/metrics. Tasks: sdk; mcp tools with cost
warnings; cli; tests.

**Phase 28 — Calendar + brand + notifications integration.** Deliverable: ad
launches/reviews appear in the content calendar; brand kit steers ad copy;
terminal ad events email/webhook (respecting prefs). Tasks: calendar feed;
brand context; notify hooks; tests.

### Workstream G — Hardening + docs + final
**Phase 29 — Full test + a11y + migration verify.** Deliverable: unit + real-PG
integration (ads money/approvals/audit), Inngest fn tests, tsc, next build,
ruff, a11y pass, all migrations apply/rollback on fresh DB. Tasks: fill gaps;
green matrix.

**Phase 30 — Docs + final ruthless audit → /goal.** Deliverable: README Ads
section + ARCHITECTURE notes; commission a review; fix findings; end-to-end
debug. **On green: /goal reached.**

## Invariants (never break)
- Python: ruff clean + full pytest green (incl. real-PG integration) before each commit.
- Web: tsc clean + next build compiles before each commit.
- Ads spend path is fail-CLOSED, user_id-scoped, approval-gated, audited.
- External (Composio/Inngest/ad platforms) OFF without config; mocked in tests.
- Commit locally after each landable unit; single push only on explicit user OK.

## Progress: see ADS_CYCLE_LOG.md
