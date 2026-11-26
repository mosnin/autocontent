# Authentication and roles

Marketer signs people in with **Better Auth**, running inside the web app. A person belongs to one or more **workspaces** (Better Auth organizations). In each workspace they hold one **role**, and the role maps to **permissions** from one catalog: [`permissions.json`](./permissions.json). The web app, the backend and the agent harness all enforce the same catalog.

This replaces Clerk. Decision record: [`docs/adr/0011-better-auth-and-workspace-roles.md`](../adr/0011-better-auth-and-workspace-roles.md).

## The pieces

```
browser ──cookie──▶ web (Next.js)
                    ├─ /api/auth/*        Better Auth: sign-in, 2FA, passkeys, SSO, orgs, invitations, sessions
                    ├─ (app) layouts      getSession() on the server; no session → /sign-in
                    ├─ /api/proxy, api()  mint a 5-minute RS256 JWT for the session → backend
                    └─ /api/agent/session mint the agent token (actor, tenant, role, permissions)
backend (FastAPI)   verifies the JWT against web's JWKS, then reads session + membership from the
                    auth schema on every request (15 s cache), then checks the route's permission
agent (Workers)     trusts its HMAC session token from web; passes x-tenant-id and x-actor-id to the
                    backend, which caps the agent at agent ∩ actor
Postgres            schema `auth`: Better Auth's tables (web reads and writes; backend reads only)
                    schema `public`: the product, plus security_audit_log
```

## Identity model

| Term | Meaning | Where |
|---|---|---|
| **person** (actor) | A human who signs in. | `auth.user` |
| **workspace** | A team that owns marketing data. A Better Auth organization. | `auth.organization` |
| **tenant id** | The key every product table is scoped by (`user_id` columns in `public`). One per workspace: `auth.organization."tenantId"`. | set once, never changes |
| **membership** | A person's role in one workspace. | `auth.member` |
| **active workspace** | The workspace a session is acting in. | `auth.session."activeOrganizationId"` |
| **platform admin** | Marketer staff. Unrelated to workspace roles. | `auth.user.role = 'admin'` |

The product tables were keyed by the Clerk user id. They keep their `user_id` columns, which now hold the **tenant id**:

- A workspace created after this change gets `tenantId = organization.id`.
- A workspace migrated from Clerk gets `tenantId = <old Clerk user id>`, so its data stays attached with no data migration.
- The backend upserts a `public.users` row with `id = tenantId` the first time it sees a workspace (that table is the FK target).

In the backend, `AuthCtx.user_id` keeps meaning "the tenant" so no query changes. The person is `AuthCtx.actor_id`.

## Contract: the `auth` schema

Better Auth's tables live in Postgres schema `auth`. Web connects with `search_path=auth`. The migration is `db/migrations/0030_auth.sql`, generated from the Better Auth config with its CLI and applied by `scripts/migrate.py` like every other migration; Better Auth never migrates at runtime.

Columns are Better Auth's defaults (camelCase, quoted). The backend reads exactly these and nothing else:

| Table | Columns the backend reads |
|---|---|
| `auth."user"` | `id`, `email`, `"emailVerified"`, `role`, `banned`, `"banExpires"`, `"twoFactorEnabled"` |
| `auth.session` | `id`, `"userId"`, `"expiresAt"`, `"activeOrganizationId"` |
| `auth.organization` | `id`, `name`, `"tenantId"` (additional field, text, not null, unique), `"requireTwoFactor"` (additional field, boolean, default false) |
| `auth.member` | `"organizationId"`, `"userId"`, `role` |

The backend's database role should have `SELECT` only on `auth`. Web is the only writer.

## Contract: the backend JWT

Web mints it with Better Auth's `jwt` plugin, server-side only, per request to the backend. The browser never holds it.

| Claim | Value |
|---|---|
| `alg` | `RS256` (key pair in `auth.jwks`, private key encrypted with `BETTER_AUTH_SECRET`) |
| `iss` | `BETTER_AUTH_URL` (the web origin) |
| `aud` | `marketer-api` |
| `exp` | 5 minutes |
| `sub` | person id |
| `sid` | session id |
| `org` | active workspace id |
| `email` | person's email (informational; the backend reads it from the DB) |

JWKS: `GET {BETTER_AUTH_URL}/api/auth/jwks`.

Backend configuration: `MARKETER_AUTH_ISSUER`, `MARKETER_AUTH_JWKS_URL` (defaults to `{issuer}/api/auth/jwks`), `MARKETER_AUTH_AUDIENCE` (default `marketer-api`). The Clerk settings are removed.

### What the backend does with it

1. Verify signature, `iss`, `aud`, `exp`, `alg`. Any failure: 401 and one hit on the auth-failure bucket.
2. One query: the session `sid` exists, belongs to `sub` and is unexpired; the person is not banned; the person is a member of `org`; read their role, the workspace's `tenantId` and `requireTwoFactor`. Cache the answer for 15 seconds per `(sid, org)`. If the database can't answer: 503, never allow.
3. If the workspace requires two-factor and the person has not enabled it: 403 `{"detail": "mfa_required"}` on everything except reading their own profile.
4. Build `AuthCtx(user_id=tenantId, actor_id=sub, actor_email, org_id, role, permissions, actor_type="user")`.
5. The route's permission (see below) must be in `permissions`, else 403 `{"detail": "forbidden", "permission": "<resource>:<action>"}` and a `permission_denied` row in `security_audit_log`.

## Permissions on routes

Every backend route declares the permission it needs, in one place: `backend/policy.py`, a table of `(method, path template) → "resource:action" | PUBLIC | AUTHENTICATED | PLATFORM_ADMIN`. One dependency enforces it. A test enumerates every route FastAPI has registered and fails if one is missing from the table, so a new route cannot ship unclassified.

The rails stay where they are. A permission says who may ask; the rails still decide whether a money or publishing action runs, and still send large changes for approval.

## Other ways in

| Caller | How it authenticates | Role it gets |
|---|---|---|
| Personal access token (`mkt_…`) | sha256 lookup, as today | The role stored on the token, which can be at most its creator's role when it was created. Refused if the creator is no longer a member. Existing tokens migrate as `admin` with the tenant as creator. |
| Agent harness | service token + `x-tenant-id` | `agent` ∩ the role of `x-actor-id` in that workspace. No actor, or the actor isn't a member: `agent` minus `spend:approve` and `campaign:launch`. |
| Platform admin | the JWT, plus `auth.user.role = 'admin'` and two-factor enabled | Platform routes only. Grants nothing inside a workspace. |

## The agent token

`/api/agent/session` mints the agent-starter HMAC token with:
`sub` = person id, `tid` = tenant id, `roles` = `[<workspace role>]`, `scopes` = the role's permissions as `resource:action` strings. The agent passes `sub` to the backend as `x-actor-id`. Approval decide-by-id is allowed for roles that grant `agent:approve`.

## Security baseline

- **Passwords:** 12 to 128 characters, checked against Have I Been Pwned, hashed with scrypt (Better Auth default). Email must be verified before first sign-in. A password reset revokes every other session.
- **Email verification:** one email carries a six-digit code (Better Auth's `emailOTP` plugin: 10 minutes, 5 tries, stored hashed) and the link (24 hours) as a fallback. A new email replaces the code. The plugin is used for verification only: its sign-in, password reset, email change and bare-code endpoints are disabled, so a code never stands in for a password or skips two-factor.
- **Two-factor:** TOTP with backup codes. A workspace can require it (`requireTwoFactor`). Platform admins must have it.
- **Passkeys:** WebAuthn, as a second factor or a password replacement.
- **Enterprise SSO:** OIDC and SAML per workspace (`@better-auth/sso`), with verified email domains. Only `security:manage` can configure it.
- **Sessions:** httpOnly, Secure, SameSite=Lax cookies with the `__Secure-` prefix. 7-day expiry, refreshed daily; sensitive actions need a session from the last 10 minutes. People can see and revoke their sessions.
- **Rate limits:** stored in the database (serverless-safe). Sign-in 5 a minute, sign-up 3 a minute, password reset 3 an hour, two-factor verify 5 a minute, email code verify 5 a minute, verification email resend 3 a minute, per IP.
- **CSRF and redirects:** Better Auth's origin and Fetch-Metadata checks stay on; `trustedOrigins` is the web origin only. Every callback URL is checked against it.
- **Invitations:** expire after 72 hours; only the invited address can accept; the grant ceiling and last-owner rules in `permissions.json` are enforced in organization hooks, not only in the UI.
- **No impersonation.** The admin plugin is used for platform roles and bans only; nobody holds the impersonate permission.
- **Audit:** every sign-in (success and failure), sign-out, password and two-factor change, passkey change, session revocation, invitation, role change, removal, SSO change, token creation and revocation, and permission denial is written to `public.security_audit_log`, which is append-only (a trigger refuses UPDATE and DELETE).

## `public.security_audit_log`

Created in `db/migrations/0031_rbac.sql`. Web and backend both write it.

| Column | Type |
|---|---|
| `id` | bigserial primary key |
| `at` | timestamptz not null default now() |
| `org_id` | text null |
| `tenant_id` | text null |
| `actor_id` | text null |
| `actor_email` | text not null default '' |
| `actor_type` | text not null, one of `user`, `agent`, `token`, `platform_admin`, `system` |
| `action` | text not null, dotted, e.g. `auth.sign_in`, `member.role_changed`, `permission.denied` |
| `target_type` | text null |
| `target_id` | text null |
| `outcome` | text not null, one of `success`, `denied`, `failure` |
| `ip` | text null |
| `user_agent` | text null (first 512 chars) |
| `metadata` | jsonb not null default '{}' (never secrets, tokens or passwords) |

People with `audit:read` see their workspace's rows in Settings.

## Environment

| Variable | Where | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | web | 32+ random bytes. Signs cookies, encrypts the JWT private key. |
| `BETTER_AUTH_URL` | web | The public web origin, https in production. Also the JWT issuer. |
| `AUTH_DATABASE_URL` | web | Postgres; falls back to `DATABASE_URL`. Use a pooled connection on Vercel. |
| `RESEND_API_KEY`, `EMAIL_FROM` | web | Verification, reset and invitation email. In development without a key, links print to the server log; never in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | web | Optional. Google sign-in appears only when set. |
| `MARKETER_AUTH_ISSUER`, `MARKETER_AUTH_JWKS_URL`, `MARKETER_AUTH_AUDIENCE` | backend | See the JWT section. |
| `MARKETER_AUTH_DATABASE_URL` | backend | Optional read-only connection for the `auth` schema; defaults to the main database. |

## Moving off Clerk

`web/scripts/migrate-from-clerk.ts` imports a Clerk user export: each person keeps their Clerk id as their Better Auth id, gets `emailVerified = true` and no password (they sign in with Google, a magic reset link or SSO), and gets a workspace with `tenantId = <Clerk id>` where they are owner. `public.users.role = 'admin'` becomes `auth.user.role = 'admin'`. It is idempotent and has a dry-run mode.

## Where the code is

| Area | Files | Doc |
|---|---|---|
| Web | `web/lib/auth/*`, `web/app/api/auth/[...all]`, auth pages, settings for security, team and workspace security | [`web.md`](./web.md) |
| Backend | `backend/auth.py`, `backend/policy.py`, `backend/permissions.py` | [`backend.md`](./backend.md) |
| Agent | `agent/src/lib/permissions.ts`, token claims, approval routes | [`agent.md`](./agent.md) |
