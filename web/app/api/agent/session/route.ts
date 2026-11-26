import { NextResponse } from "next/server";
import { agentConfig, mintAgentToken } from "@/lib/agent/session";
import { agentSessionRefusal, agentTokenClaims } from "@/lib/auth/claims";
import { getAuthContext, needsTwoFactor, recordDenial } from "@/lib/auth/session";
import { createRateLimiter } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
// A tab asks once on load and once per refresh; 30 a minute covers many tabs.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const FORBIDDEN = { error: "forbidden", permission: "agent:chat" } as const;

// GET /api/agent/session → { configured, origin, token, expiresAt }
// Called by the browser to talk to the Marketer agent harness (agent/).
// Every claim comes from THIS request's session and the database:
// sub = the person, tid = the active workspace's tenant id, roles = [their
// role there], scopes = that role's permissions. Nothing in the request can
// choose them. A role without agent:chat (Billing) gets 403 and no token.
export async function GET() {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch {
    // The database can't say who this is: no token.
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!ctx.membership) return NextResponse.json(FORBIDDEN, { status: 403, headers: NO_STORE });
  if (needsTwoFactor(ctx)) return NextResponse.json({ error: "mfa_required" }, { status: 403, headers: NO_STORE });
  const refusal = agentSessionRefusal(ctx.membership.role);
  if (refusal) {
    await recordDenial(ctx, "agent:chat");
    return NextResponse.json(refusal.body, { status: refusal.status, headers: NO_STORE });
  }
  const hit = limiter.hit(ctx.user.id);
  if (!hit.ok) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { ...NO_STORE, "retry-after": String(hit.retryAfterSeconds) } });
  const cfg = agentConfig();
  if (!cfg) return NextResponse.json({ configured: false }, { headers: NO_STORE });
  try {
    const claims = agentTokenClaims({ personId: ctx.user.id, tenantId: ctx.membership.tenantId, role: ctx.membership.role });
    const { token, expiresAt } = await mintAgentToken(cfg.secret, claims);
    return NextResponse.json({ configured: true, origin: cfg.origin, token, expiresAt }, { headers: NO_STORE });
  } catch {
    // A missing or too-short secret: report "not configured", never the reason.
    return NextResponse.json({ configured: false }, { headers: NO_STORE });
  }
}
