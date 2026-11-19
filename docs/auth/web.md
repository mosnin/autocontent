# Auth in the web app

How sign-in, workspaces and roles work in `web/`. The contract shared with the backend and the agent is [`README.md`](./README.md); the permission catalog is [`permissions.json`](./permissions.json).

## How it fits together

```
browser ──httpOnly cookie──▶ /api/auth/*            Better Auth (app/api/auth/[...all]/route.ts)
   │                         middleware.ts           optimistic cookie check + per-request CSP nonce
   │                         (app) layout            session, verified email, workspace, two-factor (server)
   │                         (onboarding) layout     creates the first workspace
   │                         /api/proxy, lib/api.ts  mint a 5-minute RS256 JWT per request → backend
   │                         /api/agent/session      mint the agent HMAC token (person, tenant, role, scopes)
   └── authClient (lib/auth/client.ts): sign-in forms, Team, Security, SSO screens
```

| File | What it does |
|---|---|
| `lib/auth/catalog.data.ts` | Typed copy of `permissions.json`. A test fails when they differ. |
| `lib/auth/catalog.ts` | `can(role, "resource:action")`, `permissionsFor(role)`, role labels. Pure; safe in client components. |
| `lib/auth/access.ts` | Better Auth access control built from the catalog (`createAccessControl`). Maps Better Auth's own organization statements onto catalog permissions (for example `invitation:create` ← `member:invite`). `agent` is never a Better Auth role. |
| `lib/auth/rules.ts` | Grant ceiling, last owner, self change, as pure functions. Used by the server hooks and by the Team screen to offer only what the server accepts. |
| `lib/auth/config.ts` | The Better Auth configuration: database, email and password, plugins, hooks, rate limits, cookies, audit. Server only. |
| `lib/auth/server.ts` | `auth()` and `authPool()`: the instance, created on first use (`import "server-only"`). |
| `lib/auth/session.ts` | `getSession`, `getAuthContext` (session + active membership + permissions), `requireSession` (pages), `requirePermission(perm)` (route handlers and actions; writes `permission.denied`), `needsTwoFactor`. |
| `lib/auth/workspace.ts` | Active workspace selection, first-workspace creation (advisory-locked so two requests can't create two), pending-invitation detection. |
| `lib/auth/backend-token.ts`, `claims.ts` | The backend JWT and agent token claims. |
| `lib/auth/actions.ts` | Server actions: list and revoke own sessions (tokens never reach the browser), create and switch workspace. |
| `lib/auth/audit.ts` | Rows for `public.security_audit_log`, secret scrubbing, and the client-address policy. |
| `lib/auth/email.ts` | Resend HTTP API; development without a key prints links to the server log. |
| `lib/auth/route-policy.ts` | The middleware's decisions (redirect, 401, CSP), unit-tested. |
| `components/auth/*` | Auth pages, Security, Team, Workspace security, workspace switcher and user menu. All built from `@/design-system`. |
| `scripts/migrate-from-clerk.ts` | One-time import of a Clerk user export (below). |
| `scripts/auth-cli.ts` | Entry point for the Better Auth CLI (schema generation and checks). |

### Request lifecycle

1. **Middleware** (`middleware.ts`) sees only whether a session cookie exists. App pages without one redirect to `/sign-in?next=…`; `/api/proxy`, `/api/agent` and `/api/onboarding` answer 401. App and auth pages get a fresh nonce and the strict CSP (`buildCsp` in `lib/security/csp.ts`), report-only until `CSP_MODE=enforce`.
2. **The (app) layout** validates the session against the database, requires a verified email, makes sure the session's active workspace is one the person belongs to (else picks their first, or sends them to onboarding, or to a pending invitation), and sends people without two-factor to `/two-factor/setup` when the workspace requires it. It passes the role's permissions to the shell (`PermissionsProvider`), which components read with `useAllowed("campaign:launch")`.
3. **Backend calls** (`lib/api.ts` on the server, `/api/proxy` for the browser) mint a JWT through the jwt plugin's server-only `signJWT`: `sub`, `sid`, `org`, `email`, `iss = BETTER_AUTH_URL`, `aud = marketer-api`, 5 minutes, RS256. The plugin's HTTP `/token` endpoint is disabled and `get-session` never carries a JWT header, so the browser cannot get one.
4. **The agent token** (`/api/agent/session`) carries `sub` = person, `tid` = the workspace's tenant id, `roles` = [role], `scopes` = the role's permissions. Roles without `agent:chat` (Billing) get `403 {"error":"forbidden","permission":"agent:chat"}` and the chat shows "Your role doesn't include working with the agents".

### Workspace lifecycle

- A new person signs up, verifies their email, signs in, and lands in onboarding, whose layout creates a workspace named from their email domain (`acme-foods.com` → "Acme Foods"; personal domains → "My workspace") before any backend call. Confirming the brand in onboarding renames it.
- `tenantId` is set in `beforeCreateOrganization` to the new workspace's id, chosen there so both go in one insert. It can't be sent by a client (`input: false`) or changed afterwards.
- Someone invited by email who signs up is sent to the invitation, never to onboarding, so they get no extra workspace. They join with the invited role.
- "Create workspace" in the sidebar switcher makes another workspace with the person as owner.
- Each new session starts in the person's first workspace (`session.create.before`).

### What the server enforces

All in `config.ts`, regardless of what the UI shows:

- Roles on memberships and invitations are catalog roles only. Better Auth's default `member` can't be granted (SSO provisioning asks for it; it becomes `analyst`). `agent` can't be granted.
- Grant ceiling (invite and role change), last owner (role change, removal, leaving), self change: `hooks.before` on the organization endpoints, plus data-level backstops in `organizationHooks`.
- Changing `requireTwoFactor` needs `security:manage`; SSO provider endpoints need `security:manage` in the provider's workspace, and every provider belongs to a workspace.
- Sensitive actions (two-factor changes, passkeys, password, revoke all sessions, SSO changes, deleting a workspace) need a session created in the last 10 minutes.
- A password change always signs out other sessions; a reset signs out all of them.
- Impersonation endpoints are disabled; the admin plugin's admin role has no impersonate permission.

### Client address

Rate limits and the security log key on the client address, chosen by one policy (`ipPolicy` in `lib/auth/audit.ts`, also given to Better Auth's `advanced.ipAddress`):

| Where | Header read |
|---|---|
| Vercel | `x-vercel-forwarded-for`, then `x-real-ip` (set by the platform). `x-forwarded-for` is ignored. |
| Self-hosted | `AUTH_IP_HEADER`, with `AUTH_TRUSTED_PROXIES` (IPs or IPv4 CIDRs); the address is the rightmost hop that isn't a trusted proxy. |
| Self-hosted, nothing set | None. Every client shares one rate-limit bucket: stricter, never bypassable. Set the two variables. |
| Development | `x-forwarded-for`, single value only. The e2e test uses this to give the rate-limit check its own bucket. |

## Environment

See `web/.env.example`. Required: `BETTER_AUTH_SECRET` (32+ random bytes), `BETTER_AUTH_URL` (https in production; the JWT issuer), `AUTH_DATABASE_URL` (or `DATABASE_URL`). Email: `RESEND_API_KEY`, `EMAIL_FROM`. Optional: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `AUTH_DB_POOL_MAX`, `AUTH_IP_HEADER`, `AUTH_TRUSTED_PROXIES`, `CSP_MODE`.

The app builds with none of them set; the auth instance is created on first request.

## The schema

`db/migrations/0030_auth.sql` creates schema `auth` with every Better Auth table. It is generated from `config.ts`:

```bash
cd web
AUTH_DATABASE_URL=postgres://… BETTER_AUTH_SECRET=… npx auth@1.7.26 generate --config scripts/auth-cli.ts --output /tmp/auth.sql
npx auth@1.7.26 check schema --config scripts/auth-cli.ts   # against a migrated database: must pass
```

Then re-apply the two hand edits marked in the file. Apply with `scripts/migrate.py up`. Better Auth never migrates at runtime. The rollback drops the schema.

## Adding a permission

1. Add the action to `docs/auth/permissions.json` (resource list and the roles that get it).
2. Paste the JSON into `web/lib/auth/catalog.data.ts` (and the backend and agent copies, in the same change). `npm test` fails until the copies match.
3. Gate the control with `useAllowed("resource:action")` in the component, and the route handler or action with `requirePermission("resource:action")`. The backend's `policy.py` names the permission for its routes.
4. If it changes what Better Auth itself allows (members, invitations, the workspace), map it in `roleStatements` in `lib/auth/access.ts` and add a test.

## Screens

| Route | What |
|---|---|
| `/sign-in` | Password, passkey, Google (when configured), "Use SSO" by email domain |
| `/sign-up`, `/verify-email` | Create account; check inbox and resend |
| `/forgot-password`, `/reset-password` | Reset by email link |
| `/two-factor`, `/two-factor/setup` | Code or backup code; enrolment when a workspace requires it |
| `/accept-invitation/[id]` | Join or decline (only the invited address) |
| `/settings#security` | Password, two-factor (QR, backup codes), passkeys, sessions |
| `/settings#team` | Members, roles and their descriptions, invite, change role, remove, pending invitations |
| `/settings#workspace` | Require two-factor, SSO providers with domain verification, security log (`audit:read`) |

Fixture previews (no sign-in): `/preview/auth/<sign-in|sign-up|verify-email|forgot-password|reset-password|two-factor|two-factor/setup|accept-invitation>` and `/preview/app/settings/<security|team|team/admin|team/analyst|workspace|workspace/analyst>`. Add `?role=analyst` (or another role) to any `/preview/app/...` page to see it as that role, and `?theme=light`.

## The end-to-end test

`web/test/e2e-auth.cjs` drives a real browser against your own Postgres and a dev server: sign-up with the verification link from the dev log, onboarding, an Analyst invitation, TOTP enrolment and sign-in with a computed code, session revocation, the JWT verified by a stub backend against `/api/auth/jwks`, and the rate limit. It also checks the security log.

```bash
# 1. Postgres with the migrations applied (and 0031 for security_audit_log)
MARKETER_DATABASE_URL=postgres://postgres@localhost:54401/postgres .venv/bin/python scripts/migrate.py up

# 2. Dev server, no RESEND_API_KEY (links go to the log), API pointed at the stub
cd web
BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
AUTH_DATABASE_URL=postgres://postgres@localhost:54401/postgres NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3199 \
npx next dev -p 3100 > /tmp/web-dev.log 2>&1 &

# 3. The test (needs `playwright`; the stub backend runs inside it on :3199)
E2E_DEV_LOG=/tmp/web-dev.log E2E_DATABASE_URL=postgres://postgres@localhost:54401/postgres node test/e2e-auth.cjs
```

Sign-up is limited to 3 a minute per address, so wait a minute between runs.

## Moving off Clerk

```bash
cd web
AUTH_DATABASE_URL=postgres://… node --experimental-strip-types scripts/migrate-from-clerk.ts --file clerk-users.json --dry-run
AUTH_DATABASE_URL=postgres://… node --experimental-strip-types scripts/migrate-from-clerk.ts --file clerk-users.json
```

Each person keeps their Clerk id, is marked verified, has no password (Google, SSO, or "Forgot your password?"), and owns a workspace whose `tenantId` is their Clerk id, so their data stays attached. `public.users.role = 'admin'` becomes `auth."user".role = 'admin'`. Re-running skips what exists. Output has counts and skipped ids only.
