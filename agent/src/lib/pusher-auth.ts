import { isConversationOwner, type SessionClaims, verifySessionToken } from "@agent-starter/core";
import { authorizePrivateChannel, PUSHER_CHANNEL_PATTERN, parseTenantChannel } from "@agent-starter/integrations";
import { Hono } from "hono";
import { OBSERVER_PERMISSION } from "./access.ts";
import { hasScope } from "./permissions.ts";

/**
 * POST /api/pusher/auth: private-channel authorization for live dashboards (pusher-js `authEndpoint`),
 * spec checklist item 6. Telemetry is published to `private-tenant-<tenantId>-room-<roomId | runId>`
 * (PusherPublisher); a browser may subscribe only when:
 *  - the request carries `socket_id` and `channel_name` (form or JSON), else 400;
 *  - it has a valid session token (`authorization: Bearer`; widget visitor and voice tokens are refused), else 401;
 *  - the channel is a well-formed tenant room channel, else 400;
 *  - the channel's tenant is the session's tenant AND the run is the user's own conversation, or the user
 *    holds `audit:read` (owner or admin: job, room and team channels of their tenant), else 403.
 * Answers 404 while Pusher is not configured (PUSHER_KEY / PUSHER_SECRET unset or `integrations.pusher` off).
 * Pure module: platform.ts supplies the keys and session secrets.
 */
export interface PusherAuthDecision {
  status: 200 | 400 | 401 | 403;
  body: { auth: string } | { error: string };
}

/**
 * May this signed-in user watch this tenant room channel? Run ownership is exact (conversation ids encode the owner);
 * people holding `audit:read` watch every run, job and room of their tenant; a conversation-bound token (`cid`) only
 * its own.
 */
export function canWatchChannel(claims: Pick<SessionClaims, "tid" | "sub" | "roles" | "scopes" | "cid">, channel: { tenantId: string; roomId: string }): boolean {
  if (channel.tenantId !== claims.tid) return false;
  if (claims.cid !== undefined && claims.cid !== channel.roomId) return false;
  return hasScope(claims, OBSERVER_PERMISSION) || isConversationOwner(channel.roomId, claims);
}

export async function decidePusherAuth(input: { socketId?: string | null; channelName?: string | null; claims: SessionClaims | null; key: string; secret: string }): Promise<PusherAuthDecision> {
  if (!input.socketId || !input.channelName) return { status: 400, body: { error: "MISSING_PARAMETERS" } };
  if (!input.claims) return { status: 401, body: { error: "UNAUTHORIZED" } };
  const channel = PUSHER_CHANNEL_PATTERN.test(input.channelName) ? parseTenantChannel(input.channelName) : null;
  if (!channel || !/^\d+\.\d+$/.test(input.socketId)) return { status: 400, body: { error: "MALFORMED_CHANNEL" } };
  if (!canWatchChannel(input.claims, channel)) return { status: 403, body: { error: "ACCESS_DENIED" } };
  try {
    return { status: 200, body: await authorizePrivateChannel({ socketId: input.socketId, channelName: input.channelName, appKey: input.key, secret: input.secret, userTenantId: input.claims.tid }) };
  } catch {
    return { status: 403, body: { error: "ACCESS_DENIED" } };
  }
}

export function createPusherAuthRoute<E extends object>(options: { keys: (env: E) => { key: string; secret: string } | undefined; sessionSecrets: (env: E) => string[] }) {
  return new Hono<{ Bindings: E }>().post("/api/pusher/auth", async (c) => {
    const keys = options.keys(c.env);
    if (!keys) return c.json({ error: "PUSHER_NOT_CONFIGURED" }, 404);
    const fields: Record<string, unknown> = (c.req.header("content-type") ?? "").includes("application/json")
      ? (((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>)
      : await c.req.parseBody().catch(() => ({}));
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const claims = await verifySessionToken(options.sessionSecrets(c.env), c.req.header("authorization") ?? null).catch((): SessionClaims | null => null);
    const decision = await decidePusherAuth({ socketId: text(fields.socket_id), channelName: text(fields.channel_name), claims, key: keys.key, secret: keys.secret });
    return c.json(decision.body, decision.status);
  });
}
