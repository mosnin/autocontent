import "server-only";

// Mints agent-starter session tokens for the signed-in user. Same format as
// createSessionToken() in agent/vendor/agent-starter/core/src/tenancy/session-token.ts:
//   base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, body))
// The tenant is the Marketer user (Clerk `sub`), derived from OUR session,
// never from the request. SESSION_SIGNING_SECRET must match the Worker's.

const encoder = new TextEncoder();

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export interface AgentConfig {
  origin: string;
  secret: string;
}

/** The agent harness is optional: without it the app works and sessions show an offline state. */
export function agentConfig(): AgentConfig | null {
  const origin = process.env.NEXT_PUBLIC_AGENT_ORIGIN?.replace(/\/+$/, "");
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!origin || !secret) return null;
  return { origin, secret };
}

export async function mintAgentToken(secret: string, userId: string, ttlSeconds = 3600): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: userId, tid: userId, roles: ["owner"], scopes: [], iat: now, exp: now + ttlSeconds, env: process.env.NODE_ENV === "production" ? "production" : "development" };
  const body = b64url(JSON.stringify(claims));
  return { token: `${body}.${b64url(await hmac(secret, body))}`, expiresAt: claims.exp * 1000 };
}
