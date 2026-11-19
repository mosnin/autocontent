// Tests for the auth catalog, the membership rules, token claims, the CSP
// builder and the middleware's route decisions. Run with `npm test`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildStatements, roles, roleStatements } from "../lib/auth/access.ts";
import { auditRow, clientIp, ipPolicy } from "../lib/auth/audit.ts";
import { ALL_PERMISSIONS, ASSIGNABLE_ROLES, CATALOG, can, isAssignableRole, parseMemberRole, permissionsFor, rankOf } from "../lib/auth/catalog.ts";
import { agentSessionRefusal, agentTokenClaims, BACKEND_AUDIENCE, BACKEND_TOKEN_TTL_SECONDS, backendJwtPayload } from "../lib/auth/claims.ts";
import { decideRoute, signInUrl } from "../lib/auth/route-policy.ts";
import { canGrant, checkInvite, checkRemoval, checkRoleChange, countOwners, grantableRoles } from "../lib/auth/rules.ts";
import { mintAgentToken, verifyAgentToken } from "../lib/security/agent-token.ts";
import { buildCsp, createNonce } from "../lib/security/csp.ts";

// ── the catalog ─────────────────────────────────────────────────────────────

test("the embedded catalog equals docs/auth/permissions.json", () => {
  const file = JSON.parse(readFileSync(new URL("../../docs/auth/permissions.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), file);
});

test("roles grant only permissions that exist", () => {
  for (const role of Object.keys(CATALOG.roles)) for (const p of permissionsFor(role)) assert.ok(ALL_PERMISSIONS.includes(p), `${role}: ${p}`);
});

test("owner holds every permission; agent is not assignable", () => {
  assert.deepEqual(permissionsFor("owner"), ALL_PERMISSIONS);
  assert.equal(isAssignableRole("agent"), false);
  assert.deepEqual(ASSIGNABLE_ROLES, ["owner", "admin", "marketer", "analyst", "billing"]);
});

test("can() answers from the catalog and fails closed", () => {
  assert.equal(can("owner", "workspace:delete"), true);
  assert.equal(can("admin", "workspace:delete"), false);
  assert.equal(can("marketer", "campaign:launch"), true);
  assert.equal(can("marketer", "campaign:delete"), false);
  assert.equal(can("analyst", "campaign:launch"), false);
  assert.equal(can("analyst", "agent:approve"), false);
  assert.equal(can("analyst", "analytics:read"), true);
  assert.equal(can("billing", "billing:manage"), true);
  assert.equal(can("billing", "content:read"), false);
  assert.equal(can("admin", "member:invite"), true);
  assert.equal(can("marketer", "member:invite"), false);
  // Unknown role, unknown permission, garbage.
  assert.equal(can("superuser", "content:read"), false);
  assert.equal(can("owner", "content:fly"), false);
  assert.equal(can(undefined, "content:read"), false);
  assert.equal(can("owner", ""), false);
});

test("a stored membership role is one assignable role or nothing", () => {
  assert.equal(parseMemberRole("admin"), "admin");
  assert.equal(parseMemberRole(" analyst "), "analyst");
  assert.equal(parseMemberRole("admin,owner"), null);
  assert.equal(parseMemberRole("agent"), null);
  assert.equal(parseMemberRole("member"), null);
  assert.equal(parseMemberRole(""), null);
  assert.equal(parseMemberRole(null), null);
});

test("Better Auth statements are derived from catalog permissions", () => {
  const s = buildStatements();
  assert.ok(s.member.includes("invite") && s.member.includes("update"), "catalog and Better Auth member actions merge");
  assert.deepEqual(roleStatements("owner").organization?.sort(), ["delete", "update"]);
  assert.deepEqual(roleStatements("admin").organization, ["update"]);
  assert.deepEqual(roleStatements("admin").invitation?.sort(), ["cancel", "create"]);
  assert.equal(roleStatements("marketer").invitation, undefined);
  assert.equal(roleStatements("marketer").organization, undefined);
  assert.equal(roleStatements("analyst").member?.includes("update"), false);
  for (const r of ASSIGNABLE_ROLES) assert.equal(roleStatements(r).team, undefined, `${r} has no team rights`);
  for (const r of ASSIGNABLE_ROLES) assert.equal(roleStatements(r).ac, undefined, `${r} has no dynamic-role rights`);
});

// ── grant ceiling, last owner, self change ─────────────────────────────────

const M = (id: string, role: string) => ({ memberId: `m_${id}`, userId: `u_${id}`, role });

test("grant ceiling: at most your own rank, and only owners make owners", () => {
  assert.equal(canGrant("owner", "owner").ok, true);
  assert.equal(canGrant("owner", "billing").ok, true);
  assert.deepEqual(canGrant("admin", "owner"), { ok: false, code: "owner_only", message: "Only an owner can make someone an owner." });
  assert.equal(canGrant("admin", "admin").ok, true);
  assert.equal(canGrant("admin", "analyst").ok, true);
  assert.equal(canGrant("marketer", "admin").ok, false);
  assert.equal(canGrant("analyst", "marketer").ok, false);
  assert.equal(canGrant("owner", "agent").ok, false, "agent is never granted");
  assert.equal(canGrant("owner", "member").ok, false, "Better Auth's default role is not ours");
  assert.equal(canGrant("nobody", "analyst").ok, false);
  assert.deepEqual(grantableRoles("owner"), ["owner", "admin", "marketer", "analyst", "billing"]);
  assert.deepEqual(grantableRoles("admin"), ["admin", "marketer", "analyst", "billing"]);
  assert.deepEqual(grantableRoles("billing"), ["billing"]);
});

test("invites need member:invite and respect the ceiling", () => {
  assert.equal(checkInvite({ actorRole: "admin", role: "analyst" }).ok, true);
  assert.equal(checkInvite({ actorRole: "admin", role: "owner" }).ok, false);
  const r = checkInvite({ actorRole: "marketer", role: "analyst" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "forbidden");
  assert.equal(checkInvite({ actorRole: undefined, role: "analyst" }).ok, false);
});

test("role changes: never your own, never above you, never the last owner", () => {
  const self = checkRoleChange({ actor: M("a", "owner"), target: M("a", "owner"), newRole: "admin", ownerCount: 2 });
  assert.equal(!self.ok && self.code, "self_change");
  const last = checkRoleChange({ actor: M("a", "owner"), target: M("b", "owner"), newRole: "admin", ownerCount: 1 });
  assert.equal(!last.ok && last.code, "last_owner");
  assert.equal(checkRoleChange({ actor: M("a", "owner"), target: M("b", "owner"), newRole: "admin", ownerCount: 2 }).ok, true);
  const above = checkRoleChange({ actor: M("a", "admin"), target: M("b", "owner"), newRole: "analyst", ownerCount: 2 });
  assert.equal(!above.ok && above.code, "grant_ceiling");
  const promoteOwner = checkRoleChange({ actor: M("a", "admin"), target: M("b", "analyst"), newRole: "owner", ownerCount: 1 });
  assert.equal(!promoteOwner.ok && promoteOwner.code, "owner_only");
  assert.equal(checkRoleChange({ actor: M("a", "admin"), target: M("b", "analyst"), newRole: "marketer", ownerCount: 1 }).ok, true);
  const noRight = checkRoleChange({ actor: M("a", "marketer"), target: M("b", "analyst"), newRole: "billing", ownerCount: 1 });
  assert.equal(!noRight.ok && noRight.code, "forbidden");
  const agent = checkRoleChange({ actor: M("a", "owner"), target: M("b", "analyst"), newRole: "agent", ownerCount: 1 });
  assert.equal(!agent.ok && agent.code, "unknown_role");
  // Same person under another member id is still yourself.
  assert.equal(checkRoleChange({ actor: { memberId: "m1", userId: "u1", role: "owner" }, target: { memberId: "m2", userId: "u1", role: "admin" }, newRole: "analyst", ownerCount: 2 }).ok, false);
});

test("removal: the last owner stays; leaving is allowed; admins can't remove owners", () => {
  const lastLeave = checkRemoval({ actor: M("a", "owner"), target: M("a", "owner"), ownerCount: 1 });
  assert.equal(!lastLeave.ok && lastLeave.code, "last_owner");
  assert.equal(checkRemoval({ actor: M("a", "owner"), target: M("a", "owner"), ownerCount: 2 }).ok, true);
  assert.equal(checkRemoval({ actor: M("a", "analyst"), target: M("a", "analyst"), ownerCount: 1 }).ok, true, "anyone can leave");
  assert.equal(checkRemoval({ actor: M("a", "admin"), target: M("b", "marketer"), ownerCount: 1 }).ok, true);
  assert.equal(checkRemoval({ actor: M("a", "admin"), target: M("b", "owner"), ownerCount: 2 }).ok, false);
  assert.equal(checkRemoval({ actor: M("a", "marketer"), target: M("b", "analyst"), ownerCount: 1 }).ok, false);
  const lastOwner = checkRemoval({ actor: M("a", "owner"), target: M("b", "owner"), ownerCount: 1 });
  assert.equal(!lastOwner.ok && lastOwner.code, "last_owner");
  assert.equal(countOwners([{ role: "owner" }, { role: "admin" }, { role: "owner,admin" }, { role: "owner" }]), 2);
  assert.equal(rankOf("owner") > rankOf("admin"), true);
});

// ── tokens ──────────────────────────────────────────────────────────────────

test("the backend JWT payload is exactly sub, sid, org, email with a 5 minute life", () => {
  const p = backendJwtPayload({ user: { id: "person_1", email: "a@b.test" }, session: { id: "sess_1", activeOrganizationId: "org_1" } }, 1_700_000_000_000);
  assert.deepEqual(p, { sub: "person_1", sid: "sess_1", org: "org_1", email: "a@b.test", iat: 1_700_000_000, exp: 1_700_000_300 });
  assert.equal(BACKEND_AUDIENCE, "marketer-api");
  assert.equal(BACKEND_TOKEN_TTL_SECONDS, 300);
  assert.throws(() => backendJwtPayload({ user: { id: "p", email: "" }, session: { id: "s", activeOrganizationId: null } }), /no active workspace/);
  assert.throws(() => backendJwtPayload({ user: { id: "", email: "" }, session: { id: "s", activeOrganizationId: "o" } }));
});

test("agent token claims: person, tenant, one role, that role's permissions", async () => {
  const c = agentTokenClaims({ personId: "person_1", tenantId: "user_clerk_legacy", role: "analyst" });
  assert.equal(c.sub, "person_1");
  assert.equal(c.tid, "user_clerk_legacy");
  assert.deepEqual(c.roles, ["analyst"]);
  assert.deepEqual(c.scopes, permissionsFor("analyst"));
  assert.ok(!c.scopes.includes("campaign:launch") && !c.scopes.includes("agent:approve"));
  assert.ok(agentTokenClaims({ personId: "p", tenantId: "t", role: "marketer" }).scopes.includes("agent:approve"));
  assert.throws(() => agentTokenClaims({ personId: "", tenantId: "t", role: "owner" }));
  assert.throws(() => agentTokenClaims({ personId: "p", tenantId: "", role: "owner" }));
  // The minted token carries them unchanged.
  const secret = "test-signing-secret-0123456789";
  const { token } = await mintAgentToken(secret, c, { now: () => 1_700_000_000_000 });
  const v = await verifyAgentToken(secret, token, { now: () => 1_700_000_001_000 });
  assert.deepEqual({ sub: v?.sub, tid: v?.tid, roles: v?.roles, scopes: v?.scopes }, c);
});

// ── audit rows ──────────────────────────────────────────────────────────────

test("audit rows drop secrets, bound sizes and require a dotted action", () => {
  const r = auditRow({ action: "auth.sign_in", outcome: "failure", userAgent: "x".repeat(2000), metadata: { password: "hunter2", nested: { token: "t", ok: 1 }, role: "admin" } });
  assert.equal(r.user_agent?.length, 512);
  assert.deepEqual(r.metadata, { nested: { ok: 1 }, role: "admin" });
  assert.equal(r.actor_type, "user");
  assert.throws(() => auditRow({ action: "SignIn", outcome: "success" }));
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), { NODE_ENV: "development" }), "203.0.113.9");
  assert.equal(clientIp(new Headers()), null);
});

// ── CSP ─────────────────────────────────────────────────────────────────────

test("the strict CSP carries the nonce and strict-dynamic, and no unsafe-inline scripts", () => {
  const nonce = createNonce();
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(nonce, createNonce());
  const prod = buildCsp(nonce, { NODE_ENV: "production", NEXT_PUBLIC_AGENT_ORIGIN: "https://agent.example.test" });
  const script = prod.split("; ").find((d) => d.startsWith("script-src "))!;
  assert.equal(script, `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  assert.ok(!prod.includes("unsafe-eval"));
  assert.ok(prod.includes("frame-ancestors 'none'"));
  assert.ok(prod.includes("object-src 'none'"));
  assert.ok(prod.includes("base-uri 'self'"));
  assert.ok(prod.includes("form-action 'self'"));
  assert.ok(prod.includes("connect-src 'self' https://agent.example.test wss://agent.example.test"));
  assert.ok(!/ws: |wss:(;|$)/.test(prod), "no blanket websockets in production");
  const dev = buildCsp(nonce, { NODE_ENV: "development" });
  assert.ok(dev.includes("'unsafe-eval'"));
  assert.throws(() => buildCsp("bad nonce'; script-src *", {}));
});

// ── middleware decisions ────────────────────────────────────────────────────

test("signed-out pages redirect to sign-in with a safe next; APIs get 401", () => {
  assert.deepEqual(decideRoute({ pathname: "/home", hasSessionCookie: false }), { action: "redirect", location: "/sign-in?next=%2Fhome" });
  assert.deepEqual(decideRoute({ pathname: "/paid/campaigns/42", search: "?tab=x", hasSessionCookie: false }), { action: "redirect", location: "/sign-in?next=%2Fpaid%2Fcampaigns%2F42%3Ftab%3Dx" });
  assert.deepEqual(decideRoute({ pathname: "/onboarding", hasSessionCookie: false }).action, "redirect");
  assert.deepEqual(decideRoute({ pathname: "/home", hasSessionCookie: true }), { action: "next", csp: true });
  assert.deepEqual(decideRoute({ pathname: "/api/proxy/api/v1/niches", hasSessionCookie: false }), { action: "unauthorized" });
  assert.deepEqual(decideRoute({ pathname: "/api/agent/session", hasSessionCookie: false }), { action: "unauthorized" });
  assert.deepEqual(decideRoute({ pathname: "/api/onboarding/decisions", hasSessionCookie: false }), { action: "unauthorized" });
  assert.deepEqual(decideRoute({ pathname: "/api/agent/session", hasSessionCookie: true }), { action: "next", csp: false });
  // Auth pages are public but get the strict CSP; Better Auth's API and marketing pass through.
  assert.deepEqual(decideRoute({ pathname: "/sign-in", hasSessionCookie: false }), { action: "next", csp: true });
  assert.deepEqual(decideRoute({ pathname: "/accept-invitation/abc", hasSessionCookie: false }), { action: "next", csp: true });
  assert.deepEqual(decideRoute({ pathname: "/api/auth/sign-in/email", hasSessionCookie: false }), { action: "next", csp: false });
  assert.deepEqual(decideRoute({ pathname: "/api/media", hasSessionCookie: false }), { action: "next", csp: false });
  assert.deepEqual(decideRoute({ pathname: "/pricing", hasSessionCookie: false }), { action: "next", csp: false });
  // Look-alike paths are not app paths.
  assert.deepEqual(decideRoute({ pathname: "/homepage", hasSessionCookie: false }), { action: "next", csp: false });
  assert.equal(signInUrl("//evil.test"), "/sign-in?next=%2Fhome");
});

test("/api/agent/session refuses roles without agent:chat (Billing) with 403 and no token", () => {
  const forbidden = { status: 403, body: { error: "forbidden", permission: "agent:chat" } };
  assert.deepEqual(agentSessionRefusal("billing"), forbidden);
  assert.deepEqual(agentSessionRefusal(undefined), forbidden);
  assert.deepEqual(agentSessionRefusal("agent"), null, "the system role has agent:chat, but is never a membership role");
  for (const r of ["owner", "admin", "marketer", "analyst"]) assert.equal(agentSessionRefusal(r), null, r);
});

// ── client address ──────────────────────────────────────────────────────────

test("the client address never comes from a header the client controls", () => {
  const spoofed = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-vercel-forwarded-for": "198.51.100.4", "x-real-ip": "198.51.100.4" });
  // Vercel: the platform's headers, never x-forwarded-for.
  assert.deepEqual(ipPolicy({ VERCEL: "1", NODE_ENV: "production" }).headers, ["x-vercel-forwarded-for", "x-real-ip"]);
  assert.equal(clientIp(spoofed, { VERCEL: "1", NODE_ENV: "production" }), "198.51.100.4");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }), { VERCEL: "1", NODE_ENV: "production" }), null);
  // Self-hosted production with nothing configured: no address (one shared rate-limit bucket).
  assert.deepEqual(ipPolicy({ NODE_ENV: "production" }).headers, []);
  assert.equal(clientIp(spoofed, { NODE_ENV: "production" }), null);
  // Behind a known proxy: the rightmost hop that isn't the proxy.
  const env = { NODE_ENV: "production", AUTH_IP_HEADER: "x-forwarded-for", AUTH_TRUSTED_PROXIES: "10.0.0.0/8, 192.0.2.1" };
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.2.3" }), env), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 192.0.2.1" }), env), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), env), "203.0.113.9");
  // Several hops and no trusted proxy: ignored (the first hop is the client's word).
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), { NODE_ENV: "development" }), null);
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), { NODE_ENV: "development" }), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }), { NODE_ENV: "development" }), null);
});

// ── Better Auth's default "member" role is never assigned ──────────────────

test("nothing assigns Better Auth's default member role", () => {
  assert.deepEqual(Object.keys(roles).sort(), [...ASSIGNABLE_ROLES].sort(), "only catalog roles are Better Auth roles");
  assert.equal(Object.hasOwn(roles, "member"), false);
  assert.equal(Object.hasOwn(roles, "agent"), false);
  const inv = checkInvite({ actorRole: "owner", role: "member" });
  assert.equal(!inv.ok && inv.code, "unknown_role");
  const chg = checkRoleChange({ actor: M("a", "owner"), target: M("b", "analyst"), newRole: "member", ownerCount: 1 });
  assert.equal(!chg.ok && chg.code, "unknown_role");
  for (const bad of ["member", "agent", "Owner", "admin,owner", "", "superuser"]) assert.equal(canGrant("owner", bad).ok, false, bad);
  assert.equal(parseMemberRole("member"), null, "a stored member role grants nothing");
});
