// Host-app (e.g. Next.js App Router) routes that pair with this agent backend.
// 1) Mint agent session tokens for signed-in users.  2) Receive signed agent webhooks.  3) Authorize Pusher channels.
// The agent Worker also serves 3) itself at POST /api/pusher/auth (src/lib/pusher-auth.ts) with the same rules;
// use this version when your dashboards authenticate against the host app instead.
import { createSessionToken, isConversationOwner, verifySignature } from "@agent-starter/core";
import { authorizePrivateChannel, PUSHER_CHANNEL_PATTERN, parseTenantChannel } from "@agent-starter/integrations";

// GET /api/agent-session → { token } (call from your authenticated UI; tenant/user come from YOUR session)
export async function mintAgentSession(user: { id: string; tenantId: string; roles: string[] }): Promise<string> {
  return createSessionToken(process.env.SESSION_SIGNING_SECRET as string, { sub: user.id, tid: user.tenantId, roles: user.roles }, 3600);
}

// POST /api/webhooks/agent-relay → verifies x-agent-signature, enforces tenant consistency, then fan out to your realtime layer.
// The Worker signs with OUTBOUND_WEBHOOK_SECRET (falling back to WEBHOOK_SIGNING_SECRET): accept either, so the host
// keeps working when you split the secrets, and during a rotation.
export async function handleAgentWebhook(request: Request): Promise<Response> {
  const signature = request.headers.get("x-agent-signature");
  const tenantId = request.headers.get("x-tenant-id");
  if (!signature || !tenantId) return Response.json({ error: "Missing required security metadata headers." }, { status: 401 });
  const raw = await request.text();
  const secrets = [process.env.OUTBOUND_WEBHOOK_SECRET, process.env.WEBHOOK_SIGNING_SECRET].filter((s): s is string => Boolean(s));
  try {
    await verifySignature(secrets, raw, signature);
  } catch {
    return Response.json({ error: "Invalid agent signature" }, { status: 403 });
  }
  const event = JSON.parse(raw) as { tenantId?: string; type: string };
  if (event.tenantId !== tenantId) return Response.json({ error: "Context boundary violation: tenant id mismatch." }, { status: 400 });
  // e.g. persist job results (event.type "job.result": summary + signed artifactUrl), update dashboards, trigger downstream flows.
  // Deliveries can repeat (the Worker's durable outbox retries failed ones): de-duplicate on the x-agent-event-id header.
  return Response.json({ received: true });
}

// POST /api/pusher/auth (form: socket_id, channel_name) → private channel auth for `private-tenant-<id>-room-<run|room>`.
// `user` is YOUR signed-in session (null when there is none). The tenant comes from the session, never the request;
// the user must own the run (their own conversation id) or be an admin / operator of that tenant.
export async function pusherAuth(request: Request, user: { id: string; tenantId: string; roles: string[] } | null): Promise<Response> {
  const form = await request.formData();
  const socketId = form.get("socket_id");
  const channelName = form.get("channel_name");
  if (typeof socketId !== "string" || typeof channelName !== "string" || !socketId || !channelName) {
    return Response.json({ error: "Missing required socket handshake parameters." }, { status: 400 });
  }
  if (!user) return Response.json({ error: "Unauthorized: session invalid or expired." }, { status: 401 });
  const channel = PUSHER_CHANNEL_PATTERN.test(channelName) ? parseTenantChannel(channelName) : null;
  if (!channel || !/^\d+\.\d+$/.test(socketId)) return Response.json({ error: "Malformed channel name." }, { status: 400 });
  const operator = user.roles.some((role) => role === "admin" || role === "operator");
  if (channel.tenantId !== user.tenantId || !(operator || isConversationOwner(channel.roomId, { tid: user.tenantId, sub: user.id }))) {
    return Response.json({ error: "Access denied: context boundary violation." }, { status: 403 });
  }
  const auth = await authorizePrivateChannel({ socketId, channelName, appKey: process.env.PUSHER_KEY as string, secret: process.env.PUSHER_SECRET as string, userTenantId: user.tenantId });
  return Response.json(auth);
}
