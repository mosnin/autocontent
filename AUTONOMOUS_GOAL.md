# Autonomous /goal — marketer.sh (60-cycle loop)

Persisted so progress survives container restarts. Update CYCLE_LOG as work lands.

## North star
Take the whole product to Apple-level UX. Keep the established UI style
(cool canvas, glass panels, warm accent, vignette cards, motion/react
reveals) and elevate every surface. Audit ruthlessly; ship real features
the ICP needs; nothing half-built.

## Hard requirements
1. **Admin dashboard** — same aesthetic as the user dashboard, SOC2-level
   secure: RBAC (admin role, least privilege), full audit log of every
   admin action (actor, action, target, IP, UA, timestamp), defense-in-depth
   auth guard, no cross-tenant data leak, session/access controls, safe
   support-impersonation with mandatory audit, data export/erasure (GDPR).
2. **ICP features** — build valuable capabilities for creators, ecommerce,
   SaaS growth, agencies, and AI-agent operators. Do not hold back.
3. **Apple-level UX** across every authed + marketing surface.

## Workstreams (each = several cycles)
- A. Admin dashboard: RBAC migration, audit-log table+service, admin auth
  guard, admin API routes (users, jobs/articles overview, spend/revenue,
  system health, abuse monitor, feature flags, impersonation w/ audit),
  admin UI pages in dashboard aesthetic, SOC2 controls page.
- B. App-surface audit + tighten: drive every authed page (dashboard,
  queue, articles, niches, settings, connect, billing, tokens, onboarding),
  fix bugs, empty/loading/error states, a11y, mobile, Apple polish.
- C. ICP features: content calendar, brand kit/voice presets, team seats +
  roles, approval workflow + notifications (email/Slack), analytics
  deep-dive, content repurposing (video↔article↔social), export center,
  scheduled reports, webhooks, API-usage dashboard, competitor tracking.
- D. Backend for C: routes, repos, migrations, tests (keep 100% green).
- E. Hardening from prior audit: sitemap/robots, stage-resume, DB-side cap
  guard, real-Postgres integration tests, alerting.

## Invariants (never break)
- Python: ruff clean, full pytest green before every push.
- Web: tsc clean + next build compiles before every push.
- Every new authed route scoped by user_id; every admin route RBAC+audited.
- Commit + push after each landable unit. Keep origin green.

## Progress: see CYCLE_LOG.md
