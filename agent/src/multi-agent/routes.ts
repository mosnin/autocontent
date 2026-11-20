import { isConversationOwner, type SessionClaims, verifySessionToken } from "@agent-starter/core";
import { Hono } from "hono";
import type { Env } from "../env.ts";
import { OBSERVER_PERMISSION } from "../lib/access.ts";
import { hasScope, type Permission } from "../lib/permissions.ts";

/** The permission that lets a person observe every room of their workspace (owner and admin in the catalog). */
export const ROOM_OBSERVER_PERMISSION: Permission = OBSERVER_PERMISSION;

/** What `SwarmRoom.describe()` returns: the room's tenant and the conversation that opened it. */
export interface RoomAccessInfo {
  roomId: string;
  tenantId: string;
  requester: { agent: string; conversationId: string } | null;
}

async function claimsFrom(token: string | null | undefined, env: Env): Promise<SessionClaims | null> {
  try {
    // No `audiences`: anonymous widget visitors and conversation-bound voice tokens fail closed here.
    return await verifySessionToken([env.SESSION_SIGNING_SECRET, env.SESSION_SIGNING_SECRET_PREVIOUS ?? ""], token);
  } catch {
    return null;
  }
}

/**
 * Who may read a room's transcript and live feed (SEC-18): a full user token of the room's tenant that either owns
 * the conversation that opened the room (the orchestrator chat it was spawned from) or holds `audit:read`.
 * Rooms opened by harness conversations (delegated workers, background jobs) are visible to observers only.
 * Restricted tokens (an `aud` such as widget/voice, or a conversation-bound `cid`) never observe rooms.
 */
export function canObserveRoom(room: RoomAccessInfo | null, claims: SessionClaims | null, observer: Permission = ROOM_OBSERVER_PERMISSION): boolean {
  if (!room || !claims || room.tenantId !== claims.tid) return false;
  if (claims.aud !== undefined || claims.cid !== undefined || claims.roles.includes("visitor")) return false;
  if (hasScope(claims, observer)) return true;
  return room.requester !== null && isConversationOwner(room.requester.conversationId, claims);
}

type RoomNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): { describe(): Promise<RoomAccessInfo | null>; fetch(request: Request): Promise<Response> } };

async function authorizedRoom(env: Env, roomId: string, token: string | null | undefined) {
  const claims = await claimsFrom(token, env);
  // Cheap checks first: a token for another tenant never reaches the room object.
  if (!claims || !roomId.startsWith(`room--${claims.tid}--`)) return null;
  const ns = env.GROUP_CHAT_ROOM as unknown as RoomNamespace;
  const stub = ns.get(ns.idFromName(roomId));
  return canObserveRoom(await stub.describe(), claims) ? stub : null;
}

/**
 * Room observation for dashboards (rooms are tenant-scoped by id, `room--<tenant>--…`, and owned by the conversation
 * that opened them).
 *   GET /api/rooms/:roomId          JSON state (transcript, stats, pending speakers)
 *   GET /api/rooms/:roomId/live     WebSocket feed (pass ?token=<session> — browsers cannot set WS headers)
 */
export const roomRoutes = new Hono<{ Bindings: Env }>()
  .get("/api/rooms/:roomId", async (c) => {
    const stub = await authorizedRoom(c.env, c.req.param("roomId"), c.req.header("authorization"));
    if (!stub) return c.json({ error: "FORBIDDEN" }, 403);
    return stub.fetch(new Request("https://room/state"));
  })
  .get("/api/rooms/:roomId/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "EXPECTED_WEBSOCKET" }, 426);
    const stub = await authorizedRoom(c.env, c.req.param("roomId"), c.req.query("token"));
    if (!stub) return c.json({ error: "FORBIDDEN" }, 403);
    return stub.fetch(c.req.raw);
  });
