// Agent session tokens: base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, body)).
// Same format as createSessionToken() / verifySessionToken() in
// agent/vendor/agent-starter/core/src/tenancy/session-token.ts. Pure (WebCrypto
// only) so the Node test runner can load it.

const encoder = new TextEncoder();

export const DEFAULT_AGENT_TOKEN_TTL_SECONDS = 900;
const MIN_TTL = 60;
const MAX_TTL = 3600;

export interface AgentClaims {
  sub: string;
  tid: string;
  roles: string[];
  scopes: string[];
  iat: number;
  exp: number;
  env: "production" | "development";
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Compare without an early exit, so timing does not reveal how many leading bytes matched. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** TTL from AGENT_SESSION_TTL_SECONDS, clamped to 1–60 minutes. Default 15 minutes. */
export function agentTokenTtl(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_AGENT_TOKEN_TTL_SECONDS;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(n)));
}

export interface AgentTokenSubject {
  /** The person (Better Auth user id). Becomes `sub`; the agent passes it to the backend as x-actor-id. */
  sub: string;
  /** The workspace's tenant id. Becomes `tid`. */
  tid: string;
  /** Exactly one workspace role. */
  roles: string[];
  /** The role's permissions as "resource:action". */
  scopes: string[];
}

const SCOPE_RE = /^[a-z_]+:[a-z_]+$/;

function validSubject(s: Partial<AgentTokenSubject> | null | undefined): s is AgentTokenSubject {
  return (
    !!s &&
    typeof s.sub === "string" && s.sub.length > 0 && s.sub.length <= 256 &&
    typeof s.tid === "string" && s.tid.length > 0 && s.tid.length <= 256 &&
    Array.isArray(s.roles) && s.roles.length === 1 && typeof s.roles[0] === "string" && s.roles[0].length > 0 &&
    Array.isArray(s.scopes) && s.scopes.every((x) => typeof x === "string" && SCOPE_RE.test(x))
  );
}

/**
 * Mint a token for one signed-in person acting in one workspace. Every claim
 * must come from the server's own session and membership lookup, never from
 * the request (see app/api/agent/session/route.ts).
 */
export async function mintAgentToken(secret: string, subject: AgentTokenSubject, opts: { ttlSeconds?: number; production?: boolean; now?: () => number } = {}): Promise<{ token: string; expiresAt: number }> {
  if (!secret || secret.length < 16) throw new Error("session signing secret is missing or too short");
  if (!validSubject(subject)) throw new Error("a person, a tenant, one role and its scopes are required");
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(opts.ttlSeconds ?? DEFAULT_AGENT_TOKEN_TTL_SECONDS)));
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  const claims: AgentClaims = { sub: subject.sub, tid: subject.tid, roles: [...subject.roles], scopes: [...subject.scopes], iat: now, exp: now + ttl, env: opts.production ? "production" : "development" };
  const body = b64url(JSON.stringify(claims));
  return { token: `${body}.${b64url(await hmac(secret, body))}`, expiresAt: claims.exp * 1000 };
}

/**
 * Verify a token the way the agent Worker does: constant-time signature
 * check, then expiry. Returns null on any failure. The web app does not
 * accept these tokens anywhere; this exists so the mint is tested against a
 * verifier, and for any future server-side check.
 */
export async function verifyAgentToken(secret: string, token: string, opts: { now?: () => number } = {}): Promise<AgentClaims | null> {
  const [body, signature, extra] = token.split(".");
  if (!secret || !body || !signature || extra !== undefined) return null;
  if (!timingSafeEqual(b64url(await hmac(secret, body)), signature)) return null;
  let claims: AgentClaims;
  try {
    claims = JSON.parse(b64urlDecode(body)) as AgentClaims;
  } catch {
    return null;
  }
  if (!validSubject(claims) || !Number.isInteger(claims.exp)) return null;
  if (claims.exp * 1000 < (opts.now ?? Date.now)()) return null;
  return claims;
}
