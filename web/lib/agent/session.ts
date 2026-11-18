import "server-only";

import { agentTokenTtl, mintAgentToken as mint } from "@/lib/security/agent-token";

// Mints agent-starter session tokens for the signed-in user. The format and
// the claims live in lib/security/agent-token.ts. The tenant is the Marketer
// user (Clerk `sub`), derived from OUR session, never from the request.
// SESSION_SIGNING_SECRET must match the Worker's.

export interface AgentConfig {
  origin: string;
  secret: string;
}

/** The agent harness is optional: without it the app works and sessions show an offline state. */
export function agentConfig(): AgentConfig | null {
  const raw = process.env.NEXT_PUBLIC_AGENT_ORIGIN?.replace(/\/+$/, "");
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!raw || !secret) return null;
  // The token is sent to this origin as a Bearer credential: it must be a real
  // http(s) origin, and https outside local development.
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return null;
  }
  const local = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && (local || process.env.NODE_ENV !== "production"))) return null;
  return { origin: origin.origin, secret };
}

/** Short-lived (15 minutes by default, AGENT_SESSION_TTL_SECONDS to change): the browser refreshes before expiry. */
export async function mintAgentToken(secret: string, userId: string): Promise<{ token: string; expiresAt: number }> {
  return mint(secret, userId, { ttlSeconds: agentTokenTtl(process.env.AGENT_SESSION_TTL_SECONDS), production: process.env.NODE_ENV === "production" });
}
