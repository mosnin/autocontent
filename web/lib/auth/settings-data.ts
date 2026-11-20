import "server-only";

// Data for Settings → Security, Team and Workspace security, read on the
// server for the signed-in person's active workspace. What a role may not
// see is not loaded at all (invitations need member:invite, SSO providers
// security:read, the log audit:read).

import type { AuditEntry, SsoProviderRow } from "@/components/auth/workspace-security";
import type { TeamInvitation, TeamMember } from "@/components/auth/team-settings";
import { can } from "./catalog";
import { authBaseUrl } from "./config";
import { authPool } from "./server";
import type { AuthContext, Membership } from "./session";

export interface AuthSettingsData {
  organizationId: string;
  me: { memberId: string; userId: string; role: Membership["role"] };
  members: TeamMember[];
  invitations: TeamInvitation[];
  requireTwoFactor: boolean;
  providers: SsoProviderRow[];
  audit: AuditEntry[] | null;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  baseUrl: string;
}

export async function loadAuthSettings(ctx: AuthContext & { membership: Membership }): Promise<AuthSettingsData> {
  const pool = authPool();
  const m = ctx.membership;
  const orgId = m.organizationId;
  const [members, invitations, providers, audit, password] = await Promise.all([
    pool.query<{ id: string; userId: string; name: string; email: string; role: string; createdAt: Date }>(
      `select m.id, m."userId", u.name, u.email, m.role, m."createdAt" from auth.member m join auth."user" u on u.id = m."userId" where m."organizationId" = $1 order by m."createdAt" asc`,
      [orgId],
    ),
    can(m.role, "member:invite")
      ? pool.query<{ id: string; email: string; role: string; expiresAt: Date }>(`select id, email, role, "expiresAt" from auth.invitation where "organizationId" = $1 and status = 'pending' and "expiresAt" > now() order by "createdAt" desc limit 200`, [orgId])
      : Promise.resolve({ rows: [] }),
    can(m.role, "security:read")
      ? pool.query<{ providerId: string; domain: string; issuer: string; oidcConfig: string | null; domainVerified: boolean | null }>(`select "providerId", domain, issuer, "oidcConfig", "domainVerified" from auth."ssoProvider" where "organizationId" = $1 order by "providerId"`, [orgId])
      : Promise.resolve({ rows: [] }),
    can(m.role, "audit:read")
      ? pool
          .query<{ id: string; at: Date; actor_email: string; actor_type: string; action: string; outcome: AuditEntry["outcome"]; target_type: string | null; target_id: string | null; ip: string | null }>(
            `select id::text, at, actor_email, actor_type, action, outcome, target_type, target_id, ip from public.security_audit_log where org_id = $1 order by at desc, id desc limit 500`,
            [orgId],
          )
          // An unreadable log shows as empty rather than hiding the section.
          .catch(() => ({ rows: [] }))
      : Promise.resolve(null),
    pool.query(`select 1 from auth.account where "userId" = $1 and "providerId" = 'credential' and password is not null limit 1`, [ctx.user.id]),
  ]);
  return {
    organizationId: orgId,
    me: { memberId: m.memberId, userId: ctx.user.id, role: m.role },
    members: members.rows.map((r) => ({ id: r.id, userId: r.userId, name: r.name, email: r.email, role: r.role, createdAt: new Date(r.createdAt).toISOString() })),
    invitations: invitations.rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: new Date(r.expiresAt).toISOString() })),
    requireTwoFactor: m.requireTwoFactor,
    providers: providers.rows.map((r) => ({ providerId: r.providerId, domain: r.domain, issuer: r.issuer, type: r.oidcConfig ? "oidc" : "saml", domainVerified: r.domainVerified === true })),
    audit: audit ? audit.rows.map((r) => ({ id: r.id, at: new Date(r.at).toISOString(), actorEmail: r.actor_email, actorType: r.actor_type, action: r.action, outcome: r.outcome, target: r.target_type ? `${r.target_type}:${r.target_id ?? ""}` : null, ip: r.ip })) : null,
    twoFactorEnabled: (ctx.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    hasPassword: password.rows.length > 0,
    baseUrl: authBaseUrl(),
  };
}
