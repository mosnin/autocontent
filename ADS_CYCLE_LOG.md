# Ads + Workspace — cycle log

Progress tracker for the 30-phase ADS_GOAL. Newest at the bottom.

- Phase 0: research + plan. Composio (GOOGLEADS/METAADS toolkits, OpenAI-Agents
  provider, per-user OAuth connected accounts) + Inngest (Python SDK, durable
  `ctx.step`, `inngest.fast_api.serve` on FastAPI/Modal, event+cron triggers)
  confirmed as the integration path. Both key-gated/off-by-default; all external
  calls mocked in tests. Wrote ADS_GOAL.md (30 phases, fail-CLOSED ad-spend
  posture). Starting Phase 1.

- Phases 1-4 (workspace shell): product registry + app switcher + product-
  scoped sidebar (no more mashed nav) + /home launcher + product breadcrumb +
  post-login lands on /home. Studio/Press/Ads/Suite are separate dashboards.
- Phases 5-9 (data + governance): migration 0015 (7 ad_ tables), repos
  (ads/ad_actions/ad_approvals), fail-CLOSED AdSpendGuard, config gating
  (ads_enabled off by default). 13 guard unit + 6 real-PG integration tests.
- Phases 10-12 (Composio): config-gated lazy adapter (AdsDisabled, never
  ImportError), connections service, /api/v1/ads routes, /ads/connect UI, live
  /ads overview. 7 adapter + 6 route tests.
- Phase 15 (safe-execute): ad_actions_exec — the sole spend path (guard ->
  approval-gate -> audit -> apply via injectable apply_fn). 5 real-PG tests
  (approval blocks apply, kill-switch/cap deny, single-use approved exec).
- Phases 16-19 (Inngest): ad_workflows (metrics sync + ROAS optimization that
  only PROPOSES) + config-gated inngest_app (no-op mount when off) served at
  /api/inngest. 7 tests. Running total: 455 pytest green.
- Phases 22/25 (governance UI): /ads/approvals inbox (one-click approve/reject,
  20s poll) + /ads/activity append-only audit view. Live nav items.
- Phase 30 (docs, partial): README rewritten as a suite (Studio/Press/Ads/
  Suite) with a dedicated Ads product section documenting the fail-CLOSED
  money contract, Composio/Inngest integration, and off-by-default posture.
- Final gate: 15 migrations apply on a fresh DB; 455 pytest green; ruff clean;
  tsc clean; next build compiles all routes.
