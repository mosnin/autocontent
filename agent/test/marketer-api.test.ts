/**
 * The shared Marketer API client (src/marketer/api.ts): tenant header from the execution context only, the service
 * token as bearer, idempotency keys on writes only, the brokered path for persistent agents, and error mapping.
 * Plain Node: no platform import, `fetch` stubbed.
 */
import { AgentError, HttpError } from "@agent-starter/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorDetail, marketerApi, type MarketerCallContext, marketerUrl } from "../src/marketer/api.ts";

const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test/", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };

interface Seen {
  url: string;
  init: RequestInit & { credential?: string };
}

let seen: Seen[] = [];
let reply: () => Response = () => Response.json({ ok: true });

beforeEach(() => {
  seen = [];
  reply = () => Response.json({ ok: true });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (seen.push({ url, init }), reply())));
});
afterEach(() => vi.unstubAllGlobals());

const ctx = (over: Partial<MarketerCallContext> = {}): MarketerCallContext => ({
  tenant: { tenantId: "user_2abcTenant", userId: "user_2abcTenant" },
  idempotencyKey: "idem-run1-call1",
  signal: new AbortController().signal,
  services: { env: ENV },
  ...over,
});
const headers = (i = 0) => (seen[i]?.init.headers ?? {}) as Record<string, string>;

describe("marketerApi", () => {
  it("calls /api/v1 with the service token and the tenant from the context; no idempotency key on reads", async () => {
    const result = await marketerApi(ctx(), { method: "GET", path: "/workspace/overview", query: { days: 7, before: undefined, empty: "" } });
    expect(result).toEqual({ ok: true });
    expect(seen[0]?.url).toBe("https://api.marketer.test/api/v1/workspace/overview?days=7");
    expect(headers()).toMatchObject({ authorization: "Bearer svc-token-0123456789", "x-tenant-id": "user_2abcTenant", accept: "application/json" });
    expect(headers()["idempotency-key"]).toBeUndefined();
    expect(seen[0]?.init.body).toBeUndefined();
  });

  it("sends the run's idempotency key and a JSON body on writes", async () => {
    await marketerApi(ctx(), { method: "POST", path: "/jobs", body: { niche_id: "n1", platform: "tiktok" } });
    expect(seen[0]?.init.method).toBe("POST");
    expect(headers()).toMatchObject({ "idempotency-key": "idem-run1-call1", "content-type": "application/json", "x-tenant-id": "user_2abcTenant" });
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ niche_id: "n1", platform: "tiktok" });
  });

  it("goes through the persistent agent's brokered fetch with the saas credential and never sets the token itself", async () => {
    const brokered = vi.fn(async (url: string, init: RequestInit & { credential?: string }) => (seen.push({ url, init }), Response.json({ items: [] })));
    await marketerApi(ctx({ services: { env: { PRIMARY_SAAS_API_URL: ENV.PRIMARY_SAAS_API_URL }, fetch: brokered } }), { method: "GET", path: "/workspace/inbox" });
    expect(brokered).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(seen[0]?.init.credential).toBe("saas");
    expect(headers().authorization).toBeUndefined();
    expect(headers()["x-tenant-id"]).toBe("user_2abcTenant");
  });

  it("maps FastAPI errors to HttpError with the detail and a hint; 4xx are definite, 5xx retryable", async () => {
    reply = () => Response.json({ detail: "daily cap of $50.00 reached" }, { status: 402 });
    const denied = await marketerApi(ctx(), { method: "POST", path: "/ads/campaigns/abc/budget", body: {} }).catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(HttpError);
    expect((denied as HttpError).status).toBe(402);
    expect((denied as HttpError).message).toContain("daily cap of $50.00 reached");
    expect((denied as HttpError).message).toContain("do not retry");
    expect((denied as HttpError).retryable).toBe(false);

    reply = () => Response.json({ detail: [{ msg: "field required", loc: ["body", "niche_id"] }] }, { status: 422 });
    expect(((await marketerApi(ctx(), { method: "POST", path: "/jobs", body: {} }).catch((e: unknown) => e)) as HttpError).message).toContain("field required");

    reply = () => new Response("upstream down", { status: 503, headers: { "retry-after": "2" } });
    const outage = (await marketerApi(ctx(), { method: "GET", path: "/jobs" }).catch((e: unknown) => e)) as HttpError;
    expect(outage.status).toBe(503);
    expect(outage.retryable).toBe(true);
    expect(outage.retryAfterMs).toBe(2000);

    reply = () => new Response("", { status: 401 });
    expect(((await marketerApi(ctx(), { method: "GET", path: "/jobs" }).catch((e: unknown) => e)) as HttpError).message).toContain("MARKETER_AGENT_SERVICE_TOKEN");
  });

  it("fails closed when unconfigured or without a valid tenant, before any request", async () => {
    await expect(marketerApi(ctx({ services: { env: { SAAS_SERVICE_TOKEN: "x" } } }), { method: "GET", path: "/jobs" })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(marketerApi(ctx({ services: { env: { PRIMARY_SAAS_API_URL: ENV.PRIMARY_SAAS_API_URL } } }), { method: "GET", path: "/jobs" })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    await expect(marketerApi(ctx({ services: {} }), { method: "GET", path: "/jobs" })).rejects.toBeInstanceOf(AgentError);
    await expect(marketerApi(ctx({ tenant: { tenantId: "" } }), { method: "GET", path: "/jobs" })).rejects.toMatchObject({ code: "TENANT_ISOLATION_VIOLATION" });
    await expect(marketerApi(ctx({ tenant: { tenantId: "../admin" } }), { method: "GET", path: "/jobs" })).rejects.toMatchObject({ code: "TENANT_ISOLATION_VIOLATION" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses unsafe paths and handles empty and text bodies", async () => {
    expect(() => marketerUrl("https://api.test", "/jobs/../admin")).toThrow(/unsafe/);
    expect(() => marketerUrl("https://api.test", "//evil.test/x")).toThrow(/unsafe/);
    expect(() => marketerUrl("https://api.test", "/jobs?x=1")).toThrow(/unsafe/);
    reply = () => new Response(null, { status: 204 });
    expect(await marketerApi(ctx(), { method: "DELETE", path: "/kits/k1" })).toBeNull();
    reply = () => new Response("# Title\n\nBody", { status: 200 });
    expect(await marketerApi(ctx(), { method: "GET", path: "/articles/a1/markdown" })).toBe("# Title\n\nBody");
    expect(errorDetail("<html>Bad   gateway</html>")).toBe("<html>Bad gateway</html>");
  });
});
