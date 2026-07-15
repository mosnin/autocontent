# Cycle Log (of 60)

- Cycle 0: env re-established after container restart; synced to origin;
  goal persisted. Starting Workstream A (admin/SOC2) + B (app audit).
- Cycles 1-3 (Workstream A): admin RBAC + SOC2 audit foundation.
  - 0011 migration: users.role, suspension, append-only admin_audit_log,
    feature_flags. users repo now selects role/suspension/credit_balance
    (fixes prior audit M14: balance always 0).
  - backend/auth.py: require_admin (DB role check, never trusts token
    claim) + AdminCtx (ip/ua for audit); suspended accounts refused in the
    auth path (defense in depth).
  - repos/admin_audit.py (append-only), repos/admin.py (overview, user
    list+detail, set_role, suspend, grant_credit w/ ledger).
  - routes/admin.py: overview, users, suspension, role, credits, audit-log
    — every route RBAC-gated and audited. 8 admin tests; 369 total green.
- Cycles 4-6 (Workstream A+D+E): backend features.
  - GET /articles/{id}/hero-image (unblocks article-detail hero render).
  - GDPR: GET /users/me/export (full data bundle, PAT prefixes only),
    DELETE /users/me (right to erasure via FK cascade). repos/privacy.py.
  - Admin: feature flags (GET/PUT /admin/flags), GET /admin/health
    (db_ok + stuck/failed job signals), both audited. repos/feature_flags.
  - sitemap.xml + robots.txt; /admin protected in middleware.
  - 371 tests green (privacy + admin flags/health covered), ruff clean.
- Cycles 7-8 (Workstream C): content calendar endpoint (video+article feed).
- IN FLIGHT (agents): admin dashboard UI; P0 app fixes (niches index,
  queue/[id] live polling, retry revalidation, billing/connect guarding,
  connect model); P1 a11y/states (status humanize, table roles, edit-form
  labels, loading skeletons, hero image render, extra metrics, cmd palette).
- NEXT after agents land: integrate + verify (tsc/build/tests), wire
  account settings UI for GDPR export/erasure, calendar UI, then continue
  ICP features (brand kit/voice presets, team seats, outbound webhooks,
  approval notifications) and Apple-polish sweeps. ~52 cycles remain.
- Cycles 9-14: authed-app upgrade + admin dashboard UI integrated.
  - Admin UI (dashboard aesthetic): overview KPIs, users list+detail with
    audited styled-dialog actions (suspend/role/credits), audit-log viewer
    (keyset paging, humanized actions), SOC2 security page. Server guard
    renders "Not authorized" on 403, leaks nothing. Split admin-api
    (client-safe) from admin-server (RSC/Clerk) to fix a client-bundle
    build break.
  - P0: /niches index route, live-polling /queue/[id], retry revalidation,
    billing/connect 5xx guards, corrected /connect model + dashboard banner
    copy.
  - P1: humanized status labels, keyboard/roles on all tables, edit-form
    label association, loading skeletons, extra metrics, hero image now
    rendered via the new endpoint, command palette entries.
  - Verified: tsc clean, next build compiles all admin routes, 374 pytest
    green, ruff clean.
- Cycles 15-20: ICP features — calendar, GDPR UI, outbound webhooks.
  - Content calendar UI (/calendar, agenda layout, range switcher) wiring
    the calendar endpoint; sidebar Calendar entry.
  - Data & privacy settings page: GDPR export download + styled delete-
    account flow (type email/DELETE to confirm, Clerk sign-out); settings
    AREAS card.
  - Outbound webhooks (agent/agency ICP): 0012 migration, webhook_endpoints
    repo, HMAC-SHA256 signed delivery service (fail-open per-endpoint),
    management routes (register w/ one-time secret, list, delete, send-test),
    and emit wired into job (done/failed/awaiting_approval) + article
    (done/failed) pipeline terminal states.
  - 381 pytest green, ruff clean, web build compiles all routes.
- Cycles 21-24 (Workstream C): content repurposing (article -> social).
  - articles/llm.generate_social_snippets: one metered LLM call produces
    platform-native posts (twitter/linkedin/instagram/facebook/newsletter).
  - POST /api/v1/articles/{id}/social (metered to niche cap, 402 on cap,
    409 if not done). SDK.repurpose_article + MCP repurpose_article tool.
  - NOTE: holding all pushes per user (Vercel build cost) — local commits
    only until final debug + single push.
- Cycles 25-30: management UIs + repurpose UI.
  - Webhooks management UI (/settings/webhooks): list, add-endpoint dialog
    with one-time secret reveal + signing-formula help, per-endpoint send-
    test + delete, last-delivery status. Settings card wired.
  - Admin Feature Flags (/admin/flags): toggle table + add-flag dialog,
    optimistic + audited. Admin System Health (/admin/health): DB/stuck/
    failed cards with auto+manual refresh. Sidebar admin entries wired.
  - Article detail RepurposeCard: pick platforms → generate social posts
    (metered) → per-post copy. Wires POST /articles/{id}/social.
  - tsc clean, next build compiles all new routes.
- Cycles 31-34 (Workstream E, hardening): real-Postgres integration tests.
  - Stood up a local Postgres 16; verified ALL 12 migrations apply, and the
    4 new ones roll back + re-apply cleanly (schema validated end to end).
  - tests/integration/test_pg_money_admin.py: 7 tests against a real DB for
    the audit's #1 gap (money/admin never hit Postgres) — credit-purchase
    idempotency (partial unique index), atomic debit+ledger mirror, spend-cap
    summation over real rows, append-only admin audit, admin overview counts,
    grant-credit balance, erasure FK-cascade. Skips cleanly with no DB; runs
    automatically in CI (which already sets MARKETER_DATABASE_URL).
  - 384 passed + 7 integration (real DB) / 7 skipped (no DB); ruff clean.
- Cycles 35-38 (Workstream C): brand kit — reusable brand identity.
  - 0013 migration (brand_kits, one per user); repo + as_prompt_context.
  - GET/PUT /api/v1/brand-kit (validates #rrggbb, normalizes hashtags).
  - Wired into POST /niches/draft: the onboarding drafter now steers to the
    user's brand identity (name, tone, banned words, hashtags).
  - Unit + real-DB integration tests. 395 passed WITH DB (all integration
    active), ruff clean.
- Cycles 39-44 (Workstream B polish + C): new-surfaces punch-list + webhook
  pause/resume.
  - Applied a ruthless review of the newly-built admin/calendar/webhooks
    surfaces. a11y: audit-log expand is a real disclosure button (keyboard +
    AT); users table dropped <tr role=button> for a focusable email control;
    fixed off-by-one pagination (probe-row fetch PAGE_SIZE+1); per-route
    admin loading skeletons; removed nested <main>; overview fetch deduped
    with React.cache.
  - Semantic color: warn/attention now use the warning token (amber),
    critical uses destructive; DB-down tile red not orange; humanized audit
    labels no longer mono-lowercase. Brand accent reserved for identity.
  - Webhook enable/disable: repo set_enabled + PATCH route + client helper +
    Pause/Resume UI (disabled cards dim, Send-test gated); keeps signing
    secret + history across a pause. Buttons use isLoading (spinner+aria).
  - Calendar: range-switch Updating… affordance; summary copy drops zero
    kinds. Repurpose: empty-result state + plural-correct toast.
  - Verified: ruff clean, 397 unit + 9 real-Postgres integration green,
    tsc --noEmit clean, next build compiles all routes. Still NO push
    (holding for the single final push per Vercel build-cost constraint).
- Cycles 45-48 (Workstream E, ruthless core-surface debug): commissioned a
  read-only correctness review of the CORE surfaces (video/article pipelines,
  money/DB repos, auth, dashboard/queue/articles/niches/settings) and fixed
  every substantiated finding.
  - P1 money: prepaid credit could be overspent by intra-stage fan-out — the
    credit gate was pre-flight only and log() never re-checked it. log() now
    re-reads the debit's returned balance and trips abort_event (scope=
    credits) on non-positive, symmetric with the cap post-log re-reads;
    abort reason tracked via abort_scope so pre-flight reports the true cause.
  - P1 auth: JWT issuer now derived from the JWKS URL and enforced by default
    (Clerk iss == {jwks_base}), rejecting tokens from another instance's key
    without any config change; audience stays opt-in.
  - P2: niche daily_spend_cap_usd now Field(gt=0) (create+update) — a zero
    cap used to fail every run; niche 'Avg cost / video' now divides by jobs
    completed in the same 30d window and marks itself approximate when the
    job page is saturated (was dividing by a truncated 20-job count).
  - Review confirmed sound: cross-tenant scoping, Stripe idempotency, atomic
    claim-for-scheduling, reap_stale triggers, no missing awaits, UI states.
  - Verified: ruff clean, 404 pytest (9 real-Postgres integration) green,
    tsc clean, next build compiles. Still holding the single final push.
