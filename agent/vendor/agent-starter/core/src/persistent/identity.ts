import { AgentError } from "../errors.ts";
import type { ReplayGuard } from "../messaging/signing.ts";
import { base64UrlDecode, base64UrlEncode, hmacSha256, randomId, timingSafeEqual } from "../util/crypto.ts";

/**
 * Identity of a persistent agent: its own principal (`agent:<tenantId>/<agentId>`), separate from the human owner
 * (`user:<id>`) it acts for. Actions are attributed "agent acting on behalf of owner".
 */
export interface AgentIdentity {
  principal: string;
  tenantId: string;
  agentId: string;
  ownerUserId: string;
  /** `user:<ownerUserId>`. */
  actingFor: string;
}

export function agentPrincipal(tenantId: string, agentId: string): string {
  return `agent:${tenantId}/${agentId}`;
}

export function agentIdentity(tenantId: string, agentId: string, ownerUserId: string): AgentIdentity {
  if (!tenantId || !agentId || !ownerUserId) throw new AgentError("CONFIG_INVALID", "Agent identity needs tenantId, agentId and ownerUserId");
  return { principal: agentPrincipal(tenantId, agentId), tenantId, agentId, ownerUserId, actingFor: `user:${ownerUserId}` };
}

/**
 * Claims of an agent assertion. Mirrors RFC 8693 token exchange's `act` (actor) claim and the WAG/XAA drafts:
 * `sub` is the agent, `act.sub` the human it acts for. This compact HMAC token is a stand-in until those drafts
 * settle; swap the signer for an asymmetric one when the host SaaS needs to verify without a shared secret.
 */
export interface AgentAssertionClaims {
  iss: string;
  sub: string;
  act: { sub: string };
  tenant: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scope?: string;
}

export const AGENT_ASSERTION_TYPE = "agent-assertion+jwt";
export const MAX_AGENT_ASSERTION_TTL_SECONDS = 300;
export const AGENT_ASSERTION_HEADER = "x-agent-assertion";

const HEADER = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: AGENT_ASSERTION_TYPE }));

export async function signAgentAssertion(
  secret: string,
  input: { identity: AgentIdentity; audience: string; ttlSeconds?: number; scope?: string; issuer?: string; now?: () => number },
): Promise<string> {
  const now = Math.floor((input.now ?? Date.now)() / 1000);
  const ttl = Math.min(Math.max(1, input.ttlSeconds ?? MAX_AGENT_ASSERTION_TTL_SECONDS), MAX_AGENT_ASSERTION_TTL_SECONDS);
  if (!input.audience) throw new AgentError("CONFIG_INVALID", "Agent assertion needs an audience");
  const claims: AgentAssertionClaims = {
    iss: input.issuer ?? "agent-starter",
    sub: input.identity.principal,
    act: { sub: input.identity.actingFor },
    tenant: input.identity.tenantId,
    aud: input.audience,
    iat: now,
    exp: now + ttl,
    jti: randomId("jti"),
    ...(input.scope ? { scope: input.scope } : {}),
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = base64UrlEncode(await hmacSha256(secret, `${HEADER}.${payload}`));
  return `${HEADER}.${payload}.${signature}`;
}

/**
 * Verify an agent assertion: signature (secret rotation via an array), type, audience, expiry, a lifetime no longer
 * than five minutes, a well-formed `agent:` subject acting for a `user:`, and (with `replay`) single use of `jti`.
 */
export async function verifyAgentAssertion(
  secrets: string | string[],
  token: string | null | undefined,
  options: { audience: string; replay?: ReplayGuard; now?: () => number; clockSkewSeconds?: number },
): Promise<AgentAssertionClaims> {
  const fail = (why: string) => new AgentError("SIGNATURE_INVALID", `Invalid agent assertion: ${why}`);
  if (!token) throw fail("missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw fail("malformed");
  const [header, payload, signature] = parts as [string, string, string];
  let ok = false;
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    if (!secret) continue;
    const expected = base64UrlEncode(await hmacSha256(secret, `${header}.${payload}`));
    if (timingSafeEqual(expected, signature)) ok = true;
  }
  if (!ok) throw fail("signature mismatch");
  let head: { alg?: string; typ?: string };
  let claims: AgentAssertionClaims;
  try {
    head = JSON.parse(base64UrlDecode(header));
    claims = JSON.parse(base64UrlDecode(payload));
  } catch {
    throw fail("undecodable");
  }
  if (head.alg !== "HS256" || head.typ !== AGENT_ASSERTION_TYPE) throw fail("wrong type");
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  const skew = options.clockSkewSeconds ?? 30;
  if (claims.aud !== options.audience) throw fail("audience mismatch");
  if (!Number.isInteger(claims.exp) || !Number.isInteger(claims.iat)) throw fail("bad times");
  if (claims.exp <= now - skew) throw fail("expired");
  if (claims.iat > now + skew) throw fail("issued in the future");
  if (claims.exp - claims.iat > MAX_AGENT_ASSERTION_TTL_SECONDS) throw fail("lifetime too long");
  if (typeof claims.sub !== "string" || !claims.sub.startsWith(`agent:${claims.tenant}/`)) throw fail("bad subject");
  if (typeof claims.act?.sub !== "string" || !claims.act.sub.startsWith("user:")) throw fail("bad actor");
  if (typeof claims.jti !== "string" || !claims.jti) throw fail("missing jti");
  if (options.replay && !(await options.replay.firstSeen(`agent-assertion:${claims.jti}`, claims.exp - now + skew))) throw fail("replayed");
  return claims;
}
