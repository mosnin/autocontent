// Fixtures for the auth screens in /preview (no sign-in, no database).
// Never imported by real pages.

import type { SessionSummary } from "./auth/actions";
import type { AssignableRole } from "./auth/catalog";
import type { AuthSettingsData } from "./auth/settings-data";

const now = Date.parse("2026-11-19T10:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(now + h * 3_600_000).toISOString();

export const FX_MEMBERS = [
  { id: "m_sam", userId: "u_sam", name: "Sam Rivera", email: "sam@pastaclub.co", role: "owner", createdAt: ago(900) },
  { id: "m_ada", userId: "u_ada", name: "Ada Okafor", email: "ada@pastaclub.co", role: "admin", createdAt: ago(600) },
  { id: "m_lee", userId: "u_lee", name: "Lee Chen", email: "lee@pastaclub.co", role: "marketer", createdAt: ago(300) },
  { id: "m_kim", userId: "u_kim", name: "Kim Novak", email: "kim@pastaclub.co", role: "analyst", createdAt: ago(100) },
  { id: "m_pat", userId: "u_pat", name: "Pat Doyle", email: "finance@pastaclub.co", role: "billing", createdAt: ago(50) },
];

export function fxAuthSettings(role: AssignableRole = "owner"): AuthSettingsData {
  const me = FX_MEMBERS.find((m) => m.role === role) ?? FX_MEMBERS[0]!;
  return {
    organizationId: "org_pasta",
    me: { memberId: me.id, userId: me.userId, role },
    members: FX_MEMBERS,
    invitations: [
      { id: "inv_1", email: "jo@pastaclub.co", role: "marketer", expiresAt: ahead(60) },
      { id: "inv_2", email: "agency@studio.example", role: "analyst", expiresAt: ahead(12) },
    ],
    requireTwoFactor: true,
    providers: [{ providerId: "pasta-okta", domain: "pastaclub.co", issuer: "https://pastaclub.okta.com", type: "oidc", domainVerified: false }],
    audit:
      role === "owner" || role === "admin"
        ? [
            { id: "9", at: ago(0.2), actorEmail: "sam@pastaclub.co", actorType: "user", action: "member.invited", outcome: "success", target: null, ip: "203.0.113.9" },
            { id: "8", at: ago(1), actorEmail: "kim@pastaclub.co", actorType: "user", action: "permission.denied", outcome: "denied", target: "permission:campaign:launch", ip: "198.51.100.4" },
            { id: "7", at: ago(3), actorEmail: "ada@pastaclub.co", actorType: "user", action: "member.role_changed", outcome: "success", target: "member:m_lee", ip: "203.0.113.20" },
            { id: "6", at: ago(5), actorEmail: "unknown@example.com", actorType: "user", action: "auth.sign_in", outcome: "failure", target: null, ip: "192.0.2.77" },
            { id: "5", at: ago(26), actorEmail: "sam@pastaclub.co", actorType: "user", action: "auth.two_factor_enabled", outcome: "success", target: null, ip: "203.0.113.9" },
          ]
        : null,
    twoFactorEnabled: role === "owner",
    hasPassword: true,
    baseUrl: "https://marketer.sh",
  };
}

export const FX_SESSIONS: SessionSummary[] = [
  { id: "s1", current: true, createdAt: ago(2), updatedAt: ago(0.1), ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" },
  { id: "s2", current: false, createdAt: ago(40), updatedAt: ago(20), ipAddress: "198.51.100.23", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
  { id: "s3", current: false, createdAt: ago(120), updatedAt: ago(70), ipAddress: "192.0.2.14", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" },
];

export const FX_WORKSPACES = [
  { id: "org_pasta", name: "Pasta Club", role: "owner" },
  { id: "org_side", name: "Side Project", role: "analyst" },
];
