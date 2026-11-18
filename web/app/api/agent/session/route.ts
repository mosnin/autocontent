import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { agentConfig, mintAgentToken } from "@/lib/agent/session";
import { createRateLimiter } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
// A tab asks once on load and once per refresh; 30 a minute covers many tabs.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

// GET /api/agent/session → { configured, origin, token, expiresAt }
// Called by the browser to talk to the Marketer agent harness (agent/).
// The tenant in the token is the Clerk user of THIS request; nothing in the
// request can choose it.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const hit = limiter.hit(userId);
  if (!hit.ok) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { ...NO_STORE, "retry-after": String(hit.retryAfterSeconds) } });
  const cfg = agentConfig();
  if (!cfg) return NextResponse.json({ configured: false }, { headers: NO_STORE });
  try {
    const { token, expiresAt } = await mintAgentToken(cfg.secret, userId);
    return NextResponse.json({ configured: true, origin: cfg.origin, token, expiresAt }, { headers: NO_STORE });
  } catch {
    // A missing or too-short secret: report "not configured", never the reason.
    return NextResponse.json({ configured: false }, { headers: NO_STORE });
  }
}
