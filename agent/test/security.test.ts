/**
 * Edge security contract: session auth, tenant isolation, server-side initialData,
 * approval links that never mutate on GET. Mirrors how src/app.ts mounts agents.
 */
import { createSessionToken } from "@agent-starter/core";
import { agentAuth, createApprovalRoutes, createConversationRoute } from "@agent-starter/flue";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

const SECRET = "test-session-secret";
const mount = "/agents/assistant";

function app() {
  const hono = new Hono();
  hono.route("/api", createConversationRoute({ agentName: "assistant", secret: () => SECRET }));
  hono.use(`${mount}/*`, agentAuth({ secret: () => SECRET, agentName: "assistant", mount, adminRoles: ["admin"] }));
  hono.post(`${mount}/:id`, async (c) => c.json(await c.req.json()));
  hono.get(`${mount}/:id`, (c) => c.json({ ok: true }));
  hono.route("/", createApprovalRoutes({ agents: [], secret: () => "test-approval-secret" }));
  return hono;
}

const bearer = async (tid: string, sub: string, roles: string[] = []) => `Bearer ${await createSessionToken(SECRET, { tid, sub, roles })}`;

describe("edge security", () => {
  it("rejects requests without a valid session token", async () => {
    const res = await app().request(`${mount}/assistant--tenant_a--u1.s1`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("mints conversations scoped to the caller's tenant and user", async () => {
    const res = await app().request("/api/conversations", { method: "POST", headers: { authorization: await bearer("tenant_a", "u1") }, body: JSON.stringify({ sessionKey: "s1" }) });
    expect(await res.json()).toEqual({ conversationId: "assistant--tenant_a--u1.s1" });
  });

  it("forbids opening another tenant's or another user's conversation", async () => {
    const auth = { authorization: await bearer("tenant_a", "u1") };
    expect((await app().request(`${mount}/assistant--tenant_b--u1.s1`, { headers: auth })).status).toBe(403);
    expect((await app().request(`${mount}/assistant--tenant_a--u2.s1`, { headers: auth })).status).toBe(403);
  });

  it("overwrites client-supplied initialData with server-derived identity", async () => {
    const res = await app().request(`${mount}/assistant--tenant_a--u1.s1`, {
      method: "POST",
      headers: { authorization: await bearer("tenant_a", "u1"), "content-type": "application/json" },
      body: JSON.stringify({ message: "hi", initialData: { tenantId: "tenant_b", roles: ["admin"] } }),
    });
    const body = (await res.json()) as { initialData: { tenantId: string; userId: string; roles: string[] } };
    expect(body.initialData).toMatchObject({ tenantId: "tenant_a", userId: "u1", roles: [] });
  });

  it("rejects malformed approval tokens and never mutates on GET", async () => {
    expect((await app().request("/approvals/not-a-token", { method: "POST" })).status).toBe(400);
    expect((await app().request("/approvals/not-a-token")).status).toBe(400);
  });
});
