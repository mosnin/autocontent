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
