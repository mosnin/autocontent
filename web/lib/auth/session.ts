import "server-only";

// Server helpers: who is signed in, which workspace they act in, their role
// and its permissions. Everything here reads the database; nothing trusts the
// browser. If the database can't answer, these throw, and callers answer no.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { clientIp, writeAudit } from "./audit";
import { can, parseMemberRole, permissionsFor, type AssignableRole, type Permission } from "./catalog";
import { auth, authPool, type Session } from "./server";

export type { Session };

export interface Membership {
  memberId: string;
  organizationId: string;
  organizationName: string;
  tenantId: string;
  requireTwoFactor: boolean;
  role: AssignableRole;
  permissions: Permission[];
}

export interface AuthContext {
  session: Session["session"];
  user: Session["user"];
  /** The active workspace membership; null when the person has none (onboarding creates one). */
  membership: Membership | null;
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: "unauthorized" | "forbidden" | "mfa_required" | "no_workspace" | "unavailable",
    readonly permission?: string,
  ) {
    super(code);
  }
}

/** The current session, validated against the database (expired or revoked: null). Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  return (await auth().api.getSession({ headers: await headers() })) ?? null;
});

interface MembershipRow {
  memberId: string;
  organizationId: string;
  name: string;
  tenantId: string;
  requireTwoFactor: boolean | null;
  role: string;
}

const MEMBERSHIP_SQL = `select m.id as "memberId", o.id as "organizationId", o.name, o."tenantId", o."requireTwoFactor", m.role
  from auth.member m join auth.organization o on o.id = m."organizationId"`;

function toMembership(r: MembershipRow | undefined): Membership | null {
  if (!r) return null;
  const role = parseMemberRole(r.role);
  if (!role || !r.tenantId) return null;
  return { memberId: r.memberId, organizationId: r.organizationId, organizationName: r.name, tenantId: r.tenantId, requireTwoFactor: r.requireTwoFactor === true, role, permissions: permissionsFor(role) };
}

/** The person's membership in one workspace, or null. */
export async function membershipIn(userId: string, organizationId: string): Promise<Membership | null> {
  const r = await authPool().query<MembershipRow>(`${MEMBERSHIP_SQL} where m."userId" = $1 and o.id = $2 limit 1`, [userId, organizationId]);
  return toMembership(r.rows[0]);
}

/** Every workspace the person belongs to, oldest first (the workspace switcher). */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const r = await authPool().query<MembershipRow>(`${MEMBERSHIP_SQL} where m."userId" = $1 order by m."createdAt" asc, m.id asc`, [userId]);
  return r.rows.map(toMembership).filter((m): m is Membership => m !== null);
}

/** Session plus active membership. Null when signed out. Cached per request. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const s = await getSession();
  if (!s) return null;
  const orgId = s.session.activeOrganizationId;
  const membership = orgId ? await membershipIn(s.user.id, orgId) : null;
  return { session: s.session, user: s.user, membership };
});

export async function getActiveMembership(): Promise<Membership | null> {
  return (await getAuthContext())?.membership ?? null;
}

/** For pages and layouts: the signed-in context, or a redirect to sign-in. */
export async function requireSession(next = "/home"): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return ctx;
}

/** Two-factor is required by the workspace (or the platform role) and the person hasn't set it up. */
export function needsTwoFactor(ctx: AuthContext): boolean {
  const enabled = (ctx.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
  return !enabled && ctx.membership?.requireTwoFactor === true;
}

/** Write a permission.denied row to the security log for this request. */
export async function recordDenial(ctx: AuthContext | null, permission: string) {
  const h = await headers();
  await writeAudit(authPool(), {
    action: "permission.denied",
    outcome: "denied",
    actorId: ctx?.user.id ?? null,
    actorEmail: ctx?.user.email ?? "",
    orgId: ctx?.membership?.organizationId ?? ctx?.session.activeOrganizationId ?? null,
    targetType: "permission",
    targetId: permission,
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
    metadata: { surface: "web" },
  });
}

/**
 * For route handlers and server actions: the context if the person's role in
 * the active workspace grants `permission`, else an AuthError (401, 403 or
 * 503). A denial is written to the security log.
 */
export async function requirePermission(permission: Permission): Promise<AuthContext & { membership: Membership }> {
  let ctx: AuthContext | null;
  try {
    ctx = await getAuthContext();
  } catch {
    throw new AuthError(503, "unavailable");
  }
  if (!ctx) throw new AuthError(401, "unauthorized");
  if (!ctx.membership) throw new AuthError(403, "no_workspace", permission);
  if (needsTwoFactor(ctx)) throw new AuthError(403, "mfa_required", permission);
  if (!can(ctx.membership.role, permission)) {
    await recordDenial(ctx, permission);
    throw new AuthError(403, "forbidden", permission);
  }
  return ctx as AuthContext & { membership: Membership };
}

/** An AuthError as the JSON body the backend uses ({"detail": …}). */
export function authErrorResponse(e: unknown): Response {
  const err = e instanceof AuthError ? e : new AuthError(503, "unavailable");
  const body = err.status === 503 ? { detail: "unavailable" } : { detail: err.code, ...(err.permission && err.code === "forbidden" ? { permission: err.permission } : {}) };
  return Response.json(body, { status: err.status, headers: { "cache-control": "no-store" } });
}
