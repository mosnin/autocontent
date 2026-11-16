/**
 * Multi-agent module contract (pure modules only, no `cloudflare:workers`): who may watch a room (SEC-18), where
 * bus messages and room turns land (harness conversations no user can own: SEC-07, SEC-20).
 */
import { conversationInstanceId, createSessionToken, isConversationOwner, parseConversationInstanceId } from "@agent-starter/core";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import { canObserveRoom, type RoomAccessInfo, roomRoutes } from "../src/multi-agent/routes.ts";
import { BUS_TARGETS, busConversationId, roomConversationId, SPECIALISTS } from "../src/multi-agent/roster.ts";

const SECRET = "test-session-secret-multi-agent";
const roomId = "room--tenant_a--abc123";
const alicesChat = conversationInstanceId("orchestrator", "tenant_a", "alice", "main");
const room: RoomAccessInfo = { roomId, tenantId: "tenant_a", requester: { agent: "orchestrator", conversationId: alicesChat } };

const claims = (sub: string, extra: Record<string, unknown> = {}) => ({ sub, tid: "tenant_a", roles: [] as string[], scopes: [] as string[], exp: 9e9, iat: 0, env: "test" as const, ...extra });

describe("room observation (SEC-18)", () => {
  it("lets the user who opened the room and observers in, nobody else", () => {
    expect(canObserveRoom(room, claims("alice"))).toBe(true);
    expect(canObserveRoom(room, claims("bob"))).toBe(false);
    expect(canObserveRoom(room, claims("bob", { roles: ["admin"] }))).toBe(true);
    expect(canObserveRoom(room, { ...claims("alice"), tid: "tenant_b" })).toBe(false);
    expect(canObserveRoom(room, claims("alice", { roles: ["visitor"] }))).toBe(false);
    expect(canObserveRoom(room, claims("alice", { aud: "voice", cid: alicesChat }))).toBe(false);
    expect(canObserveRoom({ ...room, requester: null }, claims("alice"))).toBe(false);
    expect(canObserveRoom(null, claims("alice", { roles: ["admin"] }))).toBe(false);
  });

  it("serves state only after the owner check, through the room's describe()", async () => {
    const calls: string[] = [];
    const env = {
      SESSION_SIGNING_SECRET: SECRET,
      GROUP_CHAT_ROOM: {
        idFromName: (name: string) => name,
        get: (id: string) => ({
          describe: async () => (calls.push(`describe:${id}`), room),
          fetch: async () => (calls.push(`fetch:${id}`), Response.json({ status: "WAITING" })),
        }),
      },
    } as unknown as Env;
    const get = async (sub: string, path = roomId) => roomRoutes.request(`/api/rooms/${path}`, { headers: { authorization: `Bearer ${await createSessionToken(SECRET, { tid: path.split("--")[1] ?? "x", sub })}` } }, env);
    expect((await get("bob")).status).toBe(403);
    expect(calls).toEqual([`describe:${roomId}`]);
    expect((await get("alice")).status).toBe(200);
    expect(calls.at(-1)).toBe(`fetch:${roomId}`);
    expect((await get("alice", "room--tenant_b--abc123")).status).toBe(403);
    expect((await roomRoutes.request(`/api/rooms/${roomId}/live?token=x`, {}, env)).status).toBe(426);
  });
});

describe("harness conversations (SEC-07, SEC-20)", () => {
  it("bus targets are dispatch-only specialists and bus conversations are never user-owned", () => {
    expect([...BUS_TARGETS].sort()).toEqual(SPECIALISTS.map((s) => s.agent).sort());
    for (const http of ["orchestrator", "assistant", "copilot", "coder", "support-agent"]) expect(BUS_TARGETS).not.toContain(http);
    const id = busConversationId("analyst-agent", "tenant_a", "alice.main");
    expect(id).toBe(busConversationId("analyst-agent", "tenant_a", "bus")); // a key shaped like a user id falls back to "bus"
    for (const key of ["bus", "billing-check"]) {
      const conversation = busConversationId("analyst-agent", "tenant_a", key);
      expect(parseConversationInstanceId(conversation)).toBeNull();
      for (const sub of ["alice", "bus", "-bus", "agent:orchestrator"]) expect(isConversationOwner(conversation, { tid: "tenant_a", sub })).toBe(false);
    }
  });

  it("room specialists run in harness conversations no user can own", () => {
    const id = roomConversationId("analyst-agent", { roomId, tenantId: "tenant_a" });
    expect(id).toBe("analyst-agent--tenant_a---room.abc123");
    expect(parseConversationInstanceId(id)).toBeNull();
    for (const sub of ["room", "-room", "alice"]) expect(isConversationOwner(id, { tid: "tenant_a", sub })).toBe(false);
  });
});
