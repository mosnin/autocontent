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
