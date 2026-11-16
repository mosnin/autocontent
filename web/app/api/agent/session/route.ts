import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { agentConfig, mintAgentToken } from "@/lib/agent/session";

// GET /api/agent/session → { configured, origin, token, expiresAt }
// Called by the browser to talk to the Marketer agent harness (agent/).
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = agentConfig();
  if (!cfg) return NextResponse.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  const { token, expiresAt } = await mintAgentToken(cfg.secret, userId);
  return NextResponse.json({ configured: true, origin: cfg.origin, token, expiresAt }, { headers: { "cache-control": "no-store" } });
}
