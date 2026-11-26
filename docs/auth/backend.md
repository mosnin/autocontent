# Backend auth and permissions

How the FastAPI backend authenticates callers and enforces workspace roles. The contract it implements is
[`README.md`](./README.md); the catalog is [`permissions.json`](./permissions.json); the decision is
[ADR 0011](../adr/0011-better-auth-and-workspace-roles.md).

| File | What it does |
|---|---|
| `backend/auth.py` | Resolves the caller into an `AuthCtx` (session JWT, personal token or agent delegation) and the platform admin into an `AdminCtx`. |
| `backend/permissions.py` | Typed copy of the catalog: role → permissions, agent intersection, grant ceiling. `tests/test_permissions_catalog.py` asserts it equals the JSON. |
| `backend/policy.py` | The route table and the one enforcement point (`enforce_policy`, mounted app-wide in `create_app`). |
| `backend/audit.py` | Best-effort, bounded writes to `security_audit_log`. |
| `backend/routes/audit_log.py` | `GET /api/v1/audit-log` for `audit:read`. |
| `src/marketer/repos/auth_identity.py` | The read-only queries against the `auth` schema. |
| `src/marketer/repos/security_audit.py` | Insert and list-for-org; nothing else. |
| `db/migrations/0031_rbac.sql` | `security_audit_log` (append-only) and the token `role` / `created_by` columns. |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_AUTH_ISSUER` | none | The web origin (`BETTER_AUTH_URL`). Unset: every JWT is refused with 503, never accepted unverified. |
| `MARKETER_AUTH_JWKS_URL` | `{issuer}/api/auth/jwks` | Fetched with a 5 s timeout, no redirects, cached 10 minutes; an unknown `kid` refetches at most every 30 s. |
| `MARKETER_AUTH_AUDIENCE` | `marketer-api` | Required `aud`. |
| `MARKETER_AUTH_DATABASE_URL` | the main database | Its own pool for reading `auth`. Give it a role with `SELECT` on `auth` only. |
| `MARKETER_AGENT_SERVICE_TOKEN` | empty (off) | Agent delegation, unchanged. |

All `MARKETER_CLERK_*` settings are gone. `/healthz/deep` checks `auth_jwks` (a GET of the JWKS URL) instead of
`clerk_jwks`. The Modal app reads these from the `marketer-auth` secret (was `marketer-clerk`).

## The context

`AuthCtx.user_id` is still the tenant (`auth.organization."tenantId"`), so no product query changed. New fields:

| Field | Meaning |
|---|---|
| `actor_id`, `actor_email` | The person (session JWT), the token's creator (token), or the verified `x-actor-id` (agent; empty when not verified). |
| `org_id` | The workspace id, when known. |
| `role` | The workspace role; `"agent"` for delegated calls; the token's role for tokens. |
| `permissions` | Effective `frozenset` of `"resource:action"`. Defaults to empty, so a context built by hand can do nothing. |
| `actor_type` | `user`, `token` or `agent`. |
| `delegated` | Unchanged: true for the agent harness. |
| `ip`, `user_agent` | Request metadata for audit rows. |

`require_user` caches the context on `request.state`, so the policy dependency and a route's own `CurrentUser`
(or `user_rate_limit`) resolve auth once per request.

## Session JWT

1. **Verify.** The header must say `RS256` (so `none`, `HS*` and anything else is refused before a key is looked up).
   The key comes only from JWKS entries that are RSA public signing keys for RS256; an `oct` key, a key for another
   algorithm, or an entry carrying a private part is ignored, so a JWKS cannot hand us a key for algorithm confusion.
   `iss`, `aud` and `exp` are checked (10 s leeway) and `sub`, `sid`, `org` must be non-empty strings. Any failure:
   401 `invalid token` and one hit on the per-IP auth-failure bucket (20 a minute). JWKS unreachable: 503.
2. **Identity.** One query joins `auth.session` (id, owner, unexpired), `auth."user"`, `auth.organization` and
   `auth.member`. Cached 15 s per `(sid, org, sub)` (the `sub` keeps a cached answer from being reused for another
   person). Any database error or a 5 s timeout: 503 `auth_unavailable`.
3. **Decide.** No live session: 401 `session_expired`. Banned (respecting `banExpires`): 403 `banned`. Email not
   verified: 403 `email_unverified`. Not a member, or no such workspace: 403 `not_a_member`. The workspace requires
   two-factor and the person has not enabled it: 403 `mfa_required` on everything except `GET /api/v1/users/me`.
4. **Tenant row.** On a cache miss, `users_repo.ensure(tenantId, email)` inserts the `public.users` row if missing. It
   never replaces a stored address with the caller's (a workspace has many people); `GET /users/me` uses it too.
   A suspended tenant (`users.suspended_at`) gets 403 as before.

An unknown role (for example Better Auth's default `member`) maps to no permissions. A comma-separated role value
gets the union of its known roles.

## Personal access tokens

- Created with `api_token:create` and person-only (the agent is refused). The body takes an optional `role`
  (default: the creator's role). The role must be assignable and rank at most the creator's; only an owner makes an
  owner token. A refused role is audited as `api_token.create` / `denied`; creation and revocation are audited as
  `api_token.created` and `api_token.revoked` (never the secret).
- `created_by` is the person (`ctx.actor_id`). On use, the backend looks up the creator's membership in the
  workspace whose `tenantId` is the token's tenant. Not a member: 401. Banned: 403. Database error: 503. A member:
  the token's permissions are its role's **intersected with the creator's current role**, so a demoted creator's
  tokens shrink with them.
- Legacy: migration 0031 made every existing token `admin` with the tenant as creator. When the creator is the tenant
  itself and is not a member, the token keeps its migrated `admin` role. For a Clerk-migrated workspace the tenant id
  is the owner's person id, so that owner's current role still caps it.
- Tokens never reach platform-admin routes.

## Agent delegation

Service token (constant-time) plus `x-tenant-id`, as before: the tenant row must exist (never minted) and not be
suspended. New: `x-actor-id`. When that person is a member of the tenant's workspace, the agent gets `agent ∩ their
role` and the actor is recorded (`actor_id`, `org_id`, audit rows). Otherwise (no header, or not a member there) the
agent gets `agent` minus `spend:approve` and `campaign:launch`. A banned actor gets 403; an actor whose workspace
requires two-factor they have not enabled gets 403 `mfa_required`; a database error is 503.

The old guards stay: `require_person` refuses delegated contexts on token routes, account erase and export (on top of
the catalog, which gives the agent none of those permissions), `require_admin` refuses the service token, and the
rails' agent checks (never loosen a cap, never remove the approval gate, never resolve an unknown outcome) are
unchanged.

## Platform admin

`require_admin` accepts only a session JWT whose person has `auth."user".role = 'admin'`, is not banned, and has
two-factor enabled (403 `admin_requires_two_factor` otherwise). It does not need a workspace membership and grants
nothing inside a workspace. `AdminCtx.user_id` is now the person, so admin audit rows name the staff member.

## Enforcement

`enforce_policy` is an app-level dependency, so it runs on every route before the route's own dependencies. It finds
the request's entry through an index built by `policy.install(app)` (keyed by route object, so it does not depend on
path re-derivation), then:

- `PUBLIC`: nothing.
- `PLATFORM_ADMIN`: `require_admin`.
- `AUTHENTICATED`: `require_user`.
- `"resource:action"`: `require_user`, then the permission must be in `ctx.permissions`.
- `InRoute(any_of)`: `require_user`, then at least one of `any_of`; the route calls `require_permission(ctx, …)`
  for the exact one once it knows what the request does.
- Not in the table: 403 (fail closed).

A deny is 403 `{"detail": "forbidden", "permission": "<resource>:<action>"}` plus a `permission.denied` row
(`target_id` is `"<METHOD> <path>"`, `metadata` has the permission and role). The audit write is bounded to 1 s and
its failure is logged and dropped: it can neither turn a deny into an allow nor hold the response.

`tests/test_policy_coverage.py` enumerates every route FastAPI registered and fails on an unclassified route and on a
table entry that no longer matches a route. Starlette's own `/openapi.json`, `/docs`, `/docs/oauth2-redirect` and
`/redoc` are listed as public (open finding L8). Anything Inngest mounts under `/api/inngest` is public (Inngest
signs its calls).

The rails are unchanged: a permission says who may ask; the rails still decide whether a money or publishing action
runs and still park large changes for approval.

## Security audit log

`public.security_audit_log` (0031) has exactly the README's columns, with checks on `actor_type`, `outcome`, a dotted
lowercase `action` and `user_agent` ≤ 512. A trigger refuses `UPDATE`, `DELETE` and `TRUNCATE`. No foreign keys:
rows outlive the people and tenants they mention, including account erasure. The repo exposes `insert` and
`list_for_org` only.

`GET /api/v1/audit-log?limit=50&before=<id>` (`audit:read`) returns the caller's workspace rows, newest first:
rows whose `org_id` is the caller's workspace or whose `tenant_id` is the caller's tenant (backend rows for an agent
without a verified person know only the tenant). `limit` is 1 to 200; `next_before` pages backwards.

## Route permissions

Every route and why. "Also person-only" means the route additionally refuses the agent itself.

| Method | Path | Requires | Why |
|---|---|---|---|
| GET | `/healthz` | PUBLIC | Liveness probe for monitors. |
| GET | `/healthz/deep` | PUBLIC | Readiness probe; returns exception classes only (M5). |
| POST | `/api/v1/billing/webhook` | PUBLIC | Stripe signs it; the signature is the auth. |
| POST | `/api/v1/webhooks/ayrshare` | PUBLIC | HMAC over the body is the auth. |
| GET | `/api/v1/users/me` | AUTHENTICATED | Every member reads the workspace's settings row; the one route open while two-factor is pending. |
| GET | `/api/v1/users/me/export` | `workspace:delete` | A full account dump: workspace-owner level. Also person-only (agent refused). |
| DELETE | `/api/v1/users/me` | `workspace:delete` | Irreversible erasure of the workspace's data: workspace-owner level. Also person-only. |
| PATCH | `/api/v1/users/me` | in route: `spend:set_limits` or `workspace:update` | Global daily cap is a spend limit (spend:set_limits); email notifications are a workspace setting (workspace:update). Checked per field. |
| POST | `/api/v1/niches/draft` | `playbook:create` | Drafts a new playbook with a model call (creates, costs money). |
| GET | `/api/v1/niches` | `playbook:read` | Reads playbook data. |
| POST | `/api/v1/niches` | `playbook:create` | Creates playbook data. |
| GET | `/api/v1/niches/{niche_id}` | `playbook:read` | Reads playbook data. |
| PUT | `/api/v1/niches/{niche_id}` | in route: `playbook:update` | Editing a playbook; changing its daily cap also needs spend:set_limits, changing approve-before-post also needs content:approve. |
| DELETE | `/api/v1/niches/{niche_id}` | `playbook:delete` | Deletes playbook data. |
| GET | `/api/v1/niches/{niche_id}/character-sheet` | `playbook:read` | Reads playbook data. |
| GET | `/api/v1/niches/{niche_id}/performance` | `analytics:read` | Performance numbers are analytics. |
| GET | `/api/v1/jobs` | `content:read` | Reads content data. |
| GET | `/api/v1/jobs/{job_id}` | `content:read` | Reads content data. |
| POST | `/api/v1/jobs` | `content:create` | Starts a paid video render. |
| GET | `/api/v1/jobs/{job_id}/video` | `content:read` | Reads content data. |
| GET | `/api/v1/jobs/{job_id}/metrics` | `analytics:read` | Post metrics are analytics. |
| POST | `/api/v1/jobs/{job_id}/approve` | `content:approve` | Approving content for posting. |
| POST | `/api/v1/jobs/{job_id}/reject` | `content:approve` | Rejecting is the same decision as approving. |
| POST | `/api/v1/jobs/{job_id}/retry` | `content:publish` | Re-renders and posts again: a publish. |
| GET | `/api/v1/articles` | `content:read` | Reads content data. |
| GET | `/api/v1/articles/{article_id}` | `content:read` | Reads content data. |
| GET | `/api/v1/articles/{article_id}/markdown` | `content:read` | Reads content data. |
| POST | `/api/v1/articles` | `content:create` | Creates content data. |
| POST | `/api/v1/articles/{article_id}/social` | `content:create` | Makes new social snippets from an article. |
| GET | `/api/v1/articles/{article_id}/hero-image` | `content:read` | Reads content data. |
| POST | `/api/v1/articles/{article_id}/retry` | `content:create` | Re-runs article generation; articles are not posted by the backend. |
| GET | `/api/v1/admin/overview` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/users` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/users/{user_id}` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| POST | `/api/v1/admin/users/{user_id}/suspension` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| POST | `/api/v1/admin/users/{user_id}/role` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| POST | `/api/v1/admin/users/{user_id}/credits` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/flags` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| PUT | `/api/v1/admin/flags/{key}` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/health` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/audit-log` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/admin/access-codes` | PLATFORM_ADMIN | Invite and pilot codes (no hashes). |
| POST | `/api/v1/admin/access-codes` | PLATFORM_ADMIN | Creates a code; returns it once. |
| POST | `/api/v1/admin/access-codes/{code_id}/disable` | PLATFORM_ADMIN | Stops a code working. |
| GET | `/api/v1/ads/accounts` | `integration:read` | Ad accounts are connected integrations. |
| POST | `/api/v1/ads/accounts/connect` | `integration:connect` | Starts the OAuth connection to an ad platform. |
| POST | `/api/v1/ads/accounts/{account_id}/refresh` | `integration:connect` | Re-syncs a connection's state; part of keeping it connected. |
| DELETE | `/api/v1/ads/accounts/{account_id}` | `integration:disconnect` | Disconnecting an ad platform. |
| PATCH | `/api/v1/ads/accounts/{account_id}/governance` | `spend:set_limits` | Account caps and kill switch are spend limits. |
| GET | `/api/v1/ads/campaigns` | `campaign:read` | Reads campaign data. |
| POST | `/api/v1/ads/campaigns` | `campaign:create` | Creates campaign data. |
| POST | `/api/v1/ads/campaigns/{campaign_id}/budget` | `campaign:update` | Editing a campaign's budget. Not a cap; the account caps and the rails approval threshold still bound it (CRITICAL action). |
| POST | `/api/v1/ads/campaigns/{campaign_id}/status` | in route: `campaign:launch` or `campaign:pause` | Activating moves money (campaign:launch); pausing or ending only stops spend (campaign:pause). |
| GET | `/api/v1/ads/campaigns/{campaign_id}` | `campaign:read` | Reads campaign data. |
| GET | `/api/v1/ads/approvals` | `spend:read` | Pending spend approvals are spend information. |
| POST | `/api/v1/ads/approvals/{approval_id}/decide` | `spend:approve` | Approving or rejecting a parked spend change. |
| GET | `/api/v1/ads/actions` | `campaign:read` | Reads campaign data. |
| GET | `/api/v1/ads/overview` | `analytics:read` | Spend and performance KPIs. |
| GET | `/api/v1/calendar` | `content:read` | Reads content data. |
| GET | `/api/v1/brand-kit` | `brand:read` | Reads brand data. |
| PUT | `/api/v1/brand-kit` | `brand:update` | Changes brand data. |
| GET | `/api/v1/webhook-endpoints` | `webhook:read` | Reads webhook data. |
| POST | `/api/v1/webhook-endpoints` | `webhook:manage` | Manages webhook data. |
| PATCH | `/api/v1/webhook-endpoints/{endpoint_id}` | `webhook:manage` | Manages webhook data. |
| DELETE | `/api/v1/webhook-endpoints/{endpoint_id}` | `webhook:manage` | Manages webhook data. |
| POST | `/api/v1/webhook-endpoints/{endpoint_id}/test` | `webhook:manage` | Manages webhook data. |
| GET | `/api/v1/spend/today` | `spend:read` | Reads spend data. |
| GET | `/api/v1/spend/history` | `spend:read` | Reads spend data. |
| POST | `/api/v1/connect/ayrshare` | `integration:connect` | Connects social accounts for posting. |
| GET | `/api/v1/connect/ayrshare/status` | `integration:read` | Reads integration data. |
| GET | `/api/v1/tokens` | `api_token:read` | Lists the workspace's tokens. Also person-only. |
| POST | `/api/v1/tokens` | `api_token:create` | Mints a credential; the role is capped at the creator's. Also person-only. |
| DELETE | `/api/v1/tokens/{token_id}` | `api_token:revoke` | Revokes a credential. Also person-only. |
| GET | `/api/v1/voices/{voice}/preview` | `playbook:read` | Choosing a playbook's voice. |
| GET | `/api/v1/billing/balance` | `billing:read` | Credit balance. |
| POST | `/api/v1/billing/checkout` | `billing:manage` | Buys credit. |
| GET | `/api/v1/billing/access` | AUTHENTICATED | Whether the workspace needs the plan screen. Every member may ask; the balance in it is filled only for `billing:read` (docs/billing/access-codes.md). |
| POST | `/api/v1/billing/redeem` | `billing:manage` | Redeems an invite or pilot code: adds credit. A person only (the route refuses the agent and tokens), rate limited, audited. |
| GET | `/api/v1/metrics/summary` | `analytics:read` | Reads analytics data. |
| GET | `/api/v1/x402/config` | `billing:read` | How to pay; billing information. |
| POST | `/api/v1/x402/credits` | `billing:manage` | Buys credit over HTTP 402. |
| GET | `/api/v1/library` | `content:read` | Reads content data. |
| GET | `/api/v1/library/compositions` | `content:read` | Reads content data. |
| POST | `/api/v1/library/compositions` | `content:create` | Creates content data. |
| GET | `/api/v1/library/compositions/{composition_id}` | `content:read` | Reads content data. |
| GET | `/api/v1/library/{asset_id}/media` | `content:read` | Reads content data. |
| GET | `/api/v1/style-presets` | `content:read` | Static catalog used when making content. |
| GET | `/api/v1/kits` | `playbook:read` | Reads playbook data. |
| POST | `/api/v1/kits` | `playbook:create` | Creates playbook data. |
| GET | `/api/v1/kits/{kit_id}` | `playbook:read` | Reads playbook data. |
| PUT | `/api/v1/kits/{kit_id}` | `playbook:update` | Changes playbook data. |
| DELETE | `/api/v1/kits/{kit_id}` | `playbook:delete` | Deletes playbook data. |
| GET | `/api/v1/campaigns` | `campaign:read` | Reads campaign data. |
| POST | `/api/v1/campaigns` | `campaign:create` | Creates campaign data. |
| GET | `/api/v1/campaigns/{campaign_id}` | `campaign:read` | Reads campaign data. |
| POST | `/api/v1/campaigns/{campaign_id}/start` | `campaign:launch` | Starting a content campaign spawns paid work (rails campaigns.start). |
| POST | `/api/v1/campaigns/{campaign_id}/pause` | `campaign:pause` | Stops a campaign. |
| POST | `/api/v1/campaigns/{campaign_id}/items` | `campaign:update` | Changes campaign data. |
| PATCH | `/api/v1/campaigns/{campaign_id}/items/{item_id}` | `campaign:update` | Changes campaign data. |
| DELETE | `/api/v1/campaigns/{campaign_id}/items/{item_id}` | `campaign:update` | Changes campaign data. |
| GET | `/api/v1/image-posts` | `content:read` | Reads content data. |
| POST | `/api/v1/image-posts` | `content:create` | Creates content data. |
| GET | `/api/v1/image-posts/{image_post_id}` | `content:read` | Reads content data. |
| POST | `/api/v1/image-posts/{image_post_id}/retry` | `content:publish` | Re-renders and posts again: a publish. |
| POST | `/api/v1/image-posts/{image_post_id}/approve` | `content:approve` |  |
| POST | `/api/v1/image-posts/{image_post_id}/reject` | `content:approve` |  |
| GET | `/api/v1/templates` | `content:read` | Reads content data. |
| GET | `/api/v1/templates/admin/all` | PLATFORM_ADMIN | Unpublished templates; staff only. |
| GET | `/api/v1/templates/{template_id}/reference` | `content:read` | Reads content data. |
| POST | `/api/v1/templates/{template_id}/remix` | `content:create` | Makes new content from a template. |
| POST | `/api/v1/templates` | PLATFORM_ADMIN | The template catalog is curated by staff. |
| PUT | `/api/v1/templates/{template_id}` | PLATFORM_ADMIN | Staff only. |
| DELETE | `/api/v1/templates/{template_id}` | PLATFORM_ADMIN | Staff only. |
| GET | `/api/v1/providers/video-models` | `playbook:read` | Reads playbook data. |
| GET | `/api/v1/providers/audio` | `playbook:read` | Reads playbook data. |
| GET | `/api/v1/providers/script-models` | `playbook:read` | Reads playbook data. |
| GET | `/api/v1/ops/metrics` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/ops/config-health` | PLATFORM_ADMIN | Marketer staff (platform), not a workspace role. |
| GET | `/api/v1/failures` | `content:read` | Reads content data. |
| POST | `/api/v1/failures/replay/{kind}/{item_id}` | `content:publish` | The same retry as jobs/image-posts retry by another address: a publish. |
| GET | `/api/v1/workspace/overview` | `analytics:read` | Home KPIs. |
| GET | `/api/v1/workspace/inbox` | `content:read` | Items awaiting a decision. |
| POST | `/api/v1/workspace/required-actions/{action_id}/resolve` | in route: `content:publish` or `spend:approve` | Saying what happened to an unknown outcome: spend:approve for an ads.* execution, content:publish otherwise. Also person-only. |
| POST | `/api/v1/workspace/inbox/{kind}/{ref_id}/decide` | in route: `content:approve` or `spend:approve` | video or carousel needs content:approve; ad_change needs spend:approve. Checked in the route because it calls the department functions directly. |
| GET | `/api/v1/workspace/activity` | `content:read` | Recent events across content. |
| POST | `/api/v1/decisions/log` | `agent:chat` | Written by the agent while it works (route refuses non-agents). |
| POST | `/api/v1/decisions/{decision_id}/outcome` | `agent:chat` | The agent or a person records how a decision turned out. |
| GET | `/api/v1/decisions` | `analytics:read` | The decision log is a report. |
| GET | `/api/v1/memory/facts` | `memory:read` | Reads memory data. |
| POST | `/api/v1/memory/facts` | in route: `memory:confirm` or `agent:chat` | A person's facts are trusted (memory:confirm); the agent records what it learned while working (agent:chat, capped by the person); its facts are never trusted. |
| GET | `/api/v1/memory/facts/{fact_id}/history` | `memory:read` | Reads memory data. |
| POST | `/api/v1/memory/facts/{fact_id}/confirm` | `memory:confirm` | Promotes a fact to trusted. Also person-only. |
| POST | `/api/v1/memory/facts/{fact_id}/correct` | `memory:confirm` | Correcting is confirming a new value. Also person-only. |
| POST | `/api/v1/memory/facts/{fact_id}/forget` | `memory:forget` | Erases a fact. Also person-only. |
| POST | `/api/v1/memory/facts/merge` | in route: `memory:confirm` or `agent:chat` | Same split as writing facts. |
| GET | `/api/v1/memory/learnings` | `memory:read` | Reads memory data. |
| POST | `/api/v1/memory/learnings` | in route: `memory:confirm` or `agent:chat` | Same split as writing facts. |
| POST | `/api/v1/memory/learnings/{learning_id}/status` | in route: `memory:confirm` or `agent:chat` | Same split as writing facts. |
| GET | `/api/v1/memory/audit` | `memory:read` | Reads memory data. |
| GET | `/api/v1/audit-log` | `audit:read` | The workspace's security audit log. |
| GET | `/api/v1/observability/settings` | authenticated | Every member sees how much AI text the workspace sends to the observability provider; the agent reads it (unreadable means `metadata`). |
| PUT | `/api/v1/observability/settings` | `security:manage` | Widens or narrows what a subprocessor receives. Also person-only (no agent, no personal access token). Audited as `observability.settings_changed`. |

## Tests

| File | Covers |
|---|---|
| `tests/auth_helpers.py` | `ctx_for(role)` / `as_role(app, role)` for route tests; `JwtKit` (RSA key generated at test time, JWKS through a monkeypatched fetch); `session_identity(...)` rows. |
| `tests/test_auth_jwt.py` | Good token; bad signature, tampered payload, wrong `iss`/`aud`, expired, `alg` `none`, HS256 signed with the public key, each missing claim, unknown `kid`, non-RSA JWKS entries; revoked or expired session, foreign session, not a member, banned, unverified, database down (503), JWKS down (503), issuer unset (503); 15 s cache; `mfa_required` and its exemption; admin needs two-factor. |
| `tests/test_auth_pat.py` | Token role, creator demoted, creator removed (401), creator banned, legacy tokens, lookup down (503). |
| `tests/test_auth_delegation.py` | Agent minus money without an actor; `agent ∩ role` for each role; actor from another workspace; banned actor; actor lookup down. |
| `tests/test_permissions_catalog.py` | Equality with `permissions.json`; intersection and ceiling rules. |
| `tests/test_policy_coverage.py` | Every route classified, no stale entries, enforcement mounted on every route, unclassified refused. |
| `tests/test_policy_roles.py` | Allow and deny for owner, admin, marketer, analyst and billing on representative routes; deny audit rows; audit failure and slowness; in-route checks (ads status, inbox decide, required actions, account settings, playbook caps, memory); delegation over HTTP; token ceiling, default role, audit; the audit-log route. |
| `tests/integration/test_pg_auth.py` | Real `auth` rows with 0030 and 0031 applied: the identity query, the JWT path end to end, removal and revocation, two-factor, platform admin, tokens dying with membership, legacy tokens, agent capped by a real member, the append-only log, constraints, and 0031's token migration with rollback. |

## Behaviour changes to know about

- The agent role has no `spend:set_limits`, `brand:update` or `workspace:update`. The agent can no longer lower a
  playbook's or the account's spend cap, edit the brand kit, or change notification settings (it could before).
- Analysts and billing can no longer reach routes outside their role (for example billing cannot read content).
- `POST /api/v1/admin/users/{id}/role` still writes `public.users.role`, which no longer grants anything; platform
  admin is `auth."user".role`.
