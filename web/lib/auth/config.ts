// Better Auth configuration. Server code only: imported by server.ts (which
// adds "server-only") and by scripts/auth-cli.ts (the schema generator), never
// by a client component. The security baseline it implements is
// docs/auth/README.md; how it fits together is docs/auth/web.md.

import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { defaultStatements as adminStatements } from "better-auth/plugins/admin/access";
import { createAccessControl } from "better-auth/plugins/access";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { PostgresDialect } from "kysely";
import { Pool } from "pg";

import { ac, roles } from "./access";
import { clientIp, writeAudit, type AuditEvent } from "./audit";
import { can, isAssignableRole, parseMemberRole, type Permission } from "./catalog";
import { BACKEND_AUDIENCE, BACKEND_TOKEN_TTL_SECONDS } from "./claims";
import { sendAuthEmail } from "./email";
import { checkInvite, checkRemoval, checkRoleChange, countOwners, type RuleResult } from "./rules";

type Env = Record<string, string | undefined>;

export const AUTH_SCHEMA = "auth";
/** Sensitive actions need a session this recent (README: 10 minutes). */
export const FRESH_AGE_SECONDS = 10 * 60;
export const INVITATION_TTL_SECONDS = 72 * 60 * 60;

export function authDatabaseUrl(env: Env = process.env): string | undefined {
  return env.AUTH_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || undefined;
}

/** The web origin. Production refuses to start on anything but https. */
export function authBaseUrl(env: Env = process.env): string {
  const raw = env.BETTER_AUTH_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("BETTER_AUTH_URL is not set");
    return "http://localhost:3000";
  }
  const u = new URL(raw);
  if (env.NODE_ENV === "production" && u.protocol !== "https:") throw new Error("BETTER_AUTH_URL must be https in production");
  return u.origin;
}

/** A small pool: serverless functions each hold their own. search_path is set for any raw SQL; Better Auth also qualifies every statement with schemaName. */
export function createAuthPool(env: Env = process.env): Pool {
  const connectionString = authDatabaseUrl(env);
  if (!connectionString) throw new Error("AUTH_DATABASE_URL (or DATABASE_URL) is not set");
  return new Pool({
    connectionString,
    max: Math.max(1, Math.min(10, Number(env.AUTH_DB_POOL_MAX) || 3)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    options: `-c search_path=${AUTH_SCHEMA}`,
  });
}

// ── helpers over the auth schema (raw SQL, fully qualified) ─────────────────

interface MemberRow {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
}

async function findMember(pool: Pool, organizationId: string, userId: string): Promise<MemberRow | null> {
  const r = await pool.query<MemberRow>(`select id, "userId", "organizationId", role from auth.member where "organizationId" = $1 and "userId" = $2 limit 1`, [organizationId, userId]);
  return r.rows[0] ?? null;
}

async function findMemberById(pool: Pool, memberId: string): Promise<MemberRow | null> {
  const r = await pool.query<MemberRow>(`select id, "userId", "organizationId", role from auth.member where id = $1 limit 1`, [memberId]);
  return r.rows[0] ?? null;
}

async function findMemberByEmail(pool: Pool, organizationId: string, email: string): Promise<MemberRow | null> {
  const r = await pool.query<MemberRow>(
    `select m.id, m."userId", m."organizationId", m.role from auth.member m join auth."user" u on u.id = m."userId" where m."organizationId" = $1 and lower(u.email) = lower($2) limit 1`,
    [organizationId, email],
  );
  return r.rows[0] ?? null;
}

async function ownerCount(pool: Pool, organizationId: string): Promise<number> {
  const r = await pool.query<{ role: string }>(`select role from auth.member where "organizationId" = $1`, [organizationId]);
  return countOwners(r.rows);
}

async function firstMembership(pool: Pool, userId: string): Promise<string | null> {
  const r = await pool.query<{ organizationId: string }>(`select "organizationId" from auth.member where "userId" = $1 order by "createdAt" asc, id asc limit 1`, [userId]);
  return r.rows[0]?.organizationId ?? null;
}

async function ssoProviderOrg(pool: Pool, providerId: string): Promise<string | null> {
  const r = await pool.query<{ organizationId: string | null }>(`select "organizationId" from auth."ssoProvider" where "providerId" = $1 limit 1`, [providerId]);
  return r.rows[0]?.organizationId ?? null;
}

function refuse(r: RuleResult): never {
  if (r.ok) throw new Error("unreachable");
  throw new APIError(r.code === "last_owner" || r.code === "unknown_role" ? "BAD_REQUEST" : "FORBIDDEN", { message: r.message, code: r.code.toUpperCase() });
}

const SENSITIVE_PATHS = new Set([
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/delete-passkey",
  "/change-password",
  "/change-email",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/organization/delete",
]);

/** SSO endpoints that configure a provider (as opposed to signing in with one). */
const SSO_ADMIN = /^\/sso\/(register|update-provider|delete-provider|request-domain-verification|verify-domain|get-provider)$/;

// ── the audit map: endpoint path → audit action ─────────────────────────────

const AUDITED: Record<string, string> = {
  "/sign-up/email": "auth.sign_up",
  "/sign-in/email": "auth.sign_in",
  "/sign-in/social": "auth.sign_in_started",
  "/sign-in/sso": "auth.sign_in_started",
  "/passkey/verify-authentication": "auth.sign_in",
  "/verify-email": "auth.email_verified",
  "/change-password": "auth.password_changed",
  "/request-password-reset": "auth.password_reset_requested",
  "/reset-password": "auth.password_reset",
  "/two-factor/enable": "auth.two_factor_enrolment_started",
  "/two-factor/disable": "auth.two_factor_disabled",
  "/two-factor/generate-backup-codes": "auth.backup_codes_regenerated",
  "/two-factor/verify-totp": "auth.two_factor_verified",
  "/two-factor/verify-backup-code": "auth.two_factor_verified",
  "/passkey/verify-registration": "auth.passkey_added",
  "/passkey/delete-passkey": "auth.passkey_removed",
  "/passkey/update-passkey": "auth.passkey_renamed",
  "/revoke-session": "session.revoked",
  "/revoke-sessions": "session.revoked_all",
  "/revoke-other-sessions": "session.revoked_others",
  "/organization/create": "workspace.created",
  "/organization/update": "workspace.updated",
  "/organization/delete": "workspace.deleted",
  "/organization/invite-member": "member.invited",
  "/organization/cancel-invitation": "invitation.cancelled",
  "/organization/accept-invitation": "invitation.accepted",
  "/organization/reject-invitation": "invitation.rejected",
  "/organization/update-member-role": "member.role_changed",
  "/organization/remove-member": "member.removed",
  "/organization/leave": "member.left",
  "/sso/register": "sso.provider_created",
  "/sso/update-provider": "sso.provider_updated",
  "/sso/delete-provider": "sso.provider_deleted",
  "/sso/request-domain-verification": "sso.domain_verification_requested",
  "/sso/verify-domain": "sso.domain_verified",
  "/admin/set-role": "platform.role_changed",
  "/admin/ban-user": "platform.user_banned",
  "/admin/unban-user": "platform.user_unbanned",
  "/admin/revoke-user-session": "platform.session_revoked",
  "/admin/revoke-user-sessions": "platform.sessions_revoked",
  "/admin/remove-user": "platform.user_removed",
  "/admin/set-user-password": "platform.password_set",
};

type AnyCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function bodyOf(ctx: AnyCtx): Record<string, unknown> {
  const b = (ctx as { body?: unknown }).body;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 256) : null;
}

/** Which workspace an organization endpoint acts on: the body's, else the session's active one. */
function orgOf(ctx: AnyCtx, session: { session: Record<string, unknown> } | null): string | null {
  const b = bodyOf(ctx);
  return str(b.organizationId) ?? str(session?.session.activeOrganizationId) ?? null;
}

// ── the config ───────────────────────────────────────────────────────────────

export function createAuth(options: { pool?: Pool; env?: Env } = {}) {
  const env = options.env ?? process.env;
  const pool = options.pool ?? createAuthPool(env);
  const baseURL = authBaseUrl(env);
  const production = env.NODE_ENV === "production";
  const google = env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() ? { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim() } : null;

  const audit = (e: AuditEvent) => writeAudit(pool, e);

  /** The actor's role in a workspace, or null. Database errors propagate: no answer means no. */
  const roleIn = async (organizationId: string | null, userId: string) => (organizationId ? parseMemberRole((await findMember(pool, organizationId, userId))?.role) : null);

  const requirePerm = async (organizationId: string | null, userId: string, permission: Permission) => {
    if (!organizationId) throw new APIError("BAD_REQUEST", { message: "A workspace is required.", code: "NO_ACTIVE_ORGANIZATION" });
    if (!can(await roleIn(organizationId, userId), permission)) throw new APIError("FORBIDDEN", { message: "Your role doesn't allow this.", code: "FORBIDDEN" });
  };

  // Platform admin access control: everything the admin plugin offers except impersonation.
  const platformAc = createAccessControl(adminStatements);
  const platformRoles = {
    admin: platformAc.newRole({
      user: adminStatements.user.filter((a) => a !== "impersonate" && a !== "impersonate-admins") as never,
      session: [...adminStatements.session],
    }),
    user: platformAc.newRole({ user: [], session: [] }),
  };

  const config = {
    appName: "Marketer",
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: { dialect: new PostgresDialect({ pool }), type: "postgres", schemaName: AUTH_SCHEMA, transaction: true },

    // The plugin's HTTP token endpoint would hand a backend JWT to the browser:
    // it is off. Web mints backend tokens server-side (lib/auth/backend-token.ts).
    // Impersonation is off for everyone. list-sessions would return session
    // tokens to the browser; the Security screen uses a server action instead.
    disabledPaths: ["/token", "/admin/impersonate-user", "/admin/stop-impersonating", "/list-sessions"],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, subject: "Reset your Marketer password", link: url, action: "Choose a new password", lines: ["Someone asked to reset the password for your Marketer account.", "The link works once, for an hour."] }, env);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({ to: user.email, subject: "Verify your email for Marketer", link: url, action: "Verify your email", lines: ["Confirm this is your address to finish creating your Marketer account.", "The link works for 24 hours."] }, env);
      },
    },
    socialProviders: google ? { google: { ...google, prompt: "select_account" } } : {},
    account: { encryptOAuthTokens: true, accountLinking: { enabled: true, trustedProviders: google ? ["google"] : [] } },

    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: FRESH_AGE_SECONDS,
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: 5 },
        "/sign-up/*": { window: 60, max: 3 },
        "/request-password-reset": { window: 60 * 60, max: 3 },
        "/reset-password": { window: 60 * 60, max: 3 },
        "/two-factor/verify-*": { window: 60, max: 5 },
        "/passkey/verify-authentication": { window: 60, max: 5 },
      },
    },

    advanced: {
      useSecureCookies: production,
      cookiePrefix: "marketer",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: production },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },

    databaseHooks: {
      session: {
        create: {
          // A new session acts in the person's first workspace. None yet: onboarding creates one.
          before: async (session) => {
            if (session.activeOrganizationId) return;
            const org = await firstMembership(pool, session.userId);
            return { data: { ...session, activeOrganizationId: org } };
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path;

        if (path === "/sign-out") {
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s) await audit({ action: "auth.sign_out", outcome: "success", actorId: s.user.id, actorEmail: s.user.email, orgId: s.session.activeOrganizationId ?? null, ip: clientIp(ctx.headers), userAgent: ctx.headers?.get("user-agent") });
          return;
        }

        if (SENSITIVE_PATHS.has(path)) {
          const s = await getSessionFromCtx(ctx);
          if (!s) throw new APIError("UNAUTHORIZED");
          const age = Date.now() - new Date(s.session.createdAt).getTime();
          if (age > FRESH_AGE_SECONDS * 1000) throw new APIError("FORBIDDEN", { message: "Sign in again to do this.", code: "SESSION_NOT_FRESH" });
        }

        // A password change always signs out every other session.
        if (path === "/change-password") return { context: { body: { ...bodyOf(ctx), revokeOtherSessions: true } } };

        if (path === "/organization/update-member-role") {
          const s = await getSessionFromCtx(ctx);
          if (!s) throw new APIError("UNAUTHORIZED");
          const b = bodyOf(ctx);
          const target = str(b.memberId) ? await findMemberById(pool, str(b.memberId)!) : null;
          const orgId = orgOf(ctx, s);
          if (!target || !orgId || target.organizationId !== orgId) throw new APIError("BAD_REQUEST", { message: "Member not found.", code: "MEMBER_NOT_FOUND" });
          const actor = await findMember(pool, orgId, s.user.id);
          if (!actor) throw new APIError("FORBIDDEN", { message: "You are not a member of this workspace.", code: "NOT_MEMBER" });
          const newRole = Array.isArray(b.role) ? (b.role.length === 1 ? b.role[0] : null) : b.role;
          const r = checkRoleChange({ actor: { memberId: actor.id, userId: actor.userId, role: actor.role }, target: { memberId: target.id, userId: target.userId, role: target.role }, newRole, ownerCount: await ownerCount(pool, orgId) });
          if (!r.ok) refuse(r);
          return;
        }

        if (path === "/organization/remove-member" || path === "/organization/leave") {
          const s = await getSessionFromCtx(ctx);
          if (!s) throw new APIError("UNAUTHORIZED");
          const orgId = orgOf(ctx, s);
          if (!orgId) throw new APIError("BAD_REQUEST", { message: "A workspace is required.", code: "NO_ACTIVE_ORGANIZATION" });
          const actor = await findMember(pool, orgId, s.user.id);
          if (!actor) throw new APIError("FORBIDDEN", { message: "You are not a member of this workspace.", code: "NOT_MEMBER" });
          const key = path === "/organization/leave" ? null : str(bodyOf(ctx).memberIdOrEmail);
          const target = key === null ? actor : key.includes("@") ? await findMemberByEmail(pool, orgId, key) : await findMemberById(pool, key);
          if (!target || target.organizationId !== orgId) throw new APIError("BAD_REQUEST", { message: "Member not found.", code: "MEMBER_NOT_FOUND" });
          const r = checkRemoval({ actor: { memberId: actor.id, userId: actor.userId, role: actor.role }, target: { memberId: target.id, userId: target.userId, role: target.role }, ownerCount: await ownerCount(pool, orgId) });
          if (!r.ok) refuse(r);
          return;
        }

        if (path === "/organization/update") {
          const data = bodyOf(ctx).data as Record<string, unknown> | undefined;
          if (data && "tenantId" in data) throw new APIError("BAD_REQUEST", { message: "The tenant id never changes.", code: "IMMUTABLE_FIELD" });
          if (data && "requireTwoFactor" in data) {
            const s = await getSessionFromCtx(ctx);
            if (!s) throw new APIError("UNAUTHORIZED");
            await requirePerm(orgOf(ctx, s), s.user.id, "security:manage");
          }
          return;
        }

        if (SSO_ADMIN.test(path)) {
          const s = await getSessionFromCtx(ctx);
          if (!s) throw new APIError("UNAUTHORIZED");
          const b = { ...bodyOf(ctx), ...((ctx as { query?: Record<string, unknown> }).query ?? {}) };
          // Every provider belongs to a workspace; personal providers are not offered.
          const orgId = path === "/sso/register" ? str(b.organizationId) : str(b.providerId) ? await ssoProviderOrg(pool, str(b.providerId)!) : null;
          if (!orgId) throw new APIError("BAD_REQUEST", { message: "SSO providers belong to a workspace.", code: "ORGANIZATION_REQUIRED" });
          await requirePerm(orgId, s.user.id, "security:manage");
          return;
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        const action = AUDITED[ctx.path] ?? (ctx.path.startsWith("/callback/") ? "auth.sign_in" : ctx.path.startsWith("/sso/callback") || ctx.path.startsWith("/sso/saml2/sp/acs") ? "auth.sign_in" : null);
        if (!action) return;
        const returned = ctx.context.returned;
        const failed = isAPIError(returned);
        const status = failed ? (returned as APIError).statusCode : 200;
        const s = ctx.context.newSession ?? ctx.context.session ?? null;
        const b = bodyOf(ctx);
        const r = (returned && typeof returned === "object" ? returned : {}) as Record<string, unknown>;
        const twoFactorRedirect = !failed && r.twoFactorRedirect === true;
        let finalAction = action;
        // verify-totp with a session already present is enrolment; without, it is the second step of a sign-in.
        if (ctx.path === "/two-factor/verify-totp" && ctx.context.session && !ctx.context.newSession) finalAction = "auth.two_factor_enabled";
        else if (ctx.path.startsWith("/two-factor/verify-")) finalAction = "auth.sign_in";
        if (twoFactorRedirect) finalAction = "auth.two_factor_challenge";
        const orgId = str(b.organizationId) ?? str((r.member as Record<string, unknown> | undefined)?.organizationId) ?? str(r.organizationId) ?? (ctx.path === "/organization/create" ? str(r.id) : null) ?? s?.session.activeOrganizationId ?? null;
        await audit({
          action: finalAction,
          outcome: failed ? (status === 401 || status === 403 ? "denied" : "failure") : "success",
          actorId: s?.user.id ?? null,
          actorEmail: s?.user.email ?? str(b.email) ?? "",
          orgId,
          targetType: str(b.memberId) || str(b.memberIdOrEmail) ? "member" : str(b.invitationId) ? "invitation" : str(b.providerId) ? "sso_provider" : str(b.userId) ? "user" : str(b.sessionToken) ? "session" : null,
          targetId: str(b.memberId) ?? str(b.memberIdOrEmail) ?? str(b.invitationId) ?? str(b.providerId) ?? str(b.userId) ?? null,
          ip: clientIp(ctx.request?.headers ?? ctx.headers),
          userAgent: (ctx.request?.headers ?? ctx.headers)?.get("user-agent") ?? null,
          metadata: {
            ...(failed ? { status, error: (returned as APIError).body?.code ?? null } : {}),
            ...(typeof b.role === "string" ? { role: b.role } : {}),
            ...(ctx.path === "/organization/invite-member" && str(b.email) ? { invitee: str(b.email) } : {}),
            ...(ctx.path === "/organization/update" && b.data && typeof b.data === "object" ? { fields: Object.keys(b.data as object) } : {}),
          },
        });
      }),
    },

    plugins: [
      haveIBeenPwned({ customPasswordCompromisedMessage: "This password has appeared in a data breach. Choose a different one." }),
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: async (user) => user.emailVerified === true,
        organizationLimit: 20,
        membershipLimit: 200,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        invitationLimit: 100,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        teams: { enabled: false },
        schema: {
          organization: {
            additionalFields: {
              tenantId: { type: "string", required: true, unique: true, input: false },
              requireTwoFactor: { type: "boolean", required: false, defaultValue: false, input: true },
            },
          },
        },
        sendInvitationEmail: async ({ id, email, organization: org, inviter, role }) => {
          await sendAuthEmail(
            {
              to: email,
              subject: `Join ${org.name} on Marketer`,
              link: `${baseURL}/accept-invitation/${encodeURIComponent(id)}`,
              action: "Accept the invitation",
              lines: [`${inviter.user.name || inviter.user.email} invited you to ${org.name} on Marketer as ${role}.`, "The invitation works for 72 hours and only for this address."],
            },
            env,
          );
        },
        organizationHooks: {
          // The tenant id is the new workspace's own id, chosen here so both are written in one insert.
          beforeCreateOrganization: async ({ organization: org }) => {
            const id = crypto.randomUUID().replace(/-/g, "");
            return { data: { ...org, id, tenantId: id, slug: `w-${id.slice(0, 12)}`, requireTwoFactor: false } };
          },
          beforeUpdateOrganization: async ({ organization: org }) => {
            const { tenantId: _ignored, ...rest } = org as Record<string, unknown>;
            return { data: rest };
          },
          beforeCreateInvitation: async ({ invitation, inviter, organization: org }) => {
            const actor = await findMember(pool, org.id, inviter.id);
            const r = checkInvite({ actorRole: actor?.role, role: invitation.role });
            if (!r.ok) refuse(r);
          },
          // Members only ever hold one catalog role. SSO provisioning asks for Better Auth's
          // default "member"; that becomes the least-privileged role, analyst.
          beforeAddMember: async ({ member }) => {
            const role = member.role === "member" ? "analyst" : member.role;
            if (!isAssignableRole(role)) throw new APIError("BAD_REQUEST", { message: "That role does not exist.", code: "UNKNOWN_ROLE" });
            return { data: { ...member, role } };
          },
          beforeAcceptInvitation: async ({ invitation }) => {
            if (!isAssignableRole(invitation.role)) throw new APIError("BAD_REQUEST", { message: "That invitation's role no longer exists.", code: "UNKNOWN_ROLE" });
          },
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (!isAssignableRole(newRole)) throw new APIError("BAD_REQUEST", { message: "That role does not exist.", code: "UNKNOWN_ROLE" });
            if (parseMemberRole(member.role) === "owner" && newRole !== "owner" && (await ownerCount(pool, member.organizationId)) <= 1) refuse({ ok: false, code: "last_owner", message: "A workspace needs at least one owner." });
          },
          beforeRemoveMember: async ({ member }) => {
            if (parseMemberRole(member.role) === "owner" && (await ownerCount(pool, member.organizationId)) <= 1) refuse({ ok: false, code: "last_owner", message: "A workspace needs at least one owner." });
          },
        },
      }),
      twoFactor({
        issuer: "Marketer",
        allowPasswordless: true,
        backupCodeOptions: { amount: 10, length: 10 },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
      }),
      passkey({ rpID: new URL(baseURL).hostname, rpName: "Marketer", origin: baseURL }),
      sso({
        domainVerification: { enabled: true, tokenPrefix: "marketer-verification" },
        trustEmailVerified: false,
        providersLimit: 5,
        organizationProvisioning: { disabled: false, defaultRole: "member" },
      }),
      jwt({
        jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
        jwt: { issuer: baseURL, audience: BACKEND_AUDIENCE, expirationTime: `${BACKEND_TOKEN_TTL_SECONDS}s` },
        // Never attach a JWT to get-session responses: the browser must not obtain one.
        disableSettingJwtHeader: true,
      }),
      admin({ ac: platformAc, roles: platformRoles, defaultRole: "user", adminRoles: ["admin"], allowImpersonatingAdmins: false }),
      nextCookies(), // last
    ],
  } satisfies BetterAuthOptions;

  return { auth: betterAuth(config), pool };
}

export type AuthInstance = ReturnType<typeof createAuth>["auth"];
