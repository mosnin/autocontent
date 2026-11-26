import { KeyValueReplayGuard, type ReplayGuard, TenantConfigProvider, TenantIdSchema, verifySignedRequest } from "@agent-starter/core";
import { Hono } from "hono";
import { KVStore } from "./adapters.ts";

export interface TenantSyncOptions<Env> {
  kv: (env: Env) => KVNamespace;
  secret: (env: Env) => string | string[];
  /**
   * Replay cache for signed requests. Defaults to the same KV namespace under
   * `replay:tenant-sync:` with a TTL of the tolerance window + 60 s.
   */
  replay?: (env: Env) => ReplayGuard;
  /** Signature timestamp tolerance (seconds). Default 300. */
  toleranceSeconds?: number;
}

/**
 * SaaS → edge configuration sync. When a customer changes settings in your
 * dashboard, your backend PUTs the tenant config here. Agents then read
 * limits/flags from KV in ~ms instead of calling your primary database on
 * every turn.
 *
 *   PUT    /internal/tenants/:tenantId/config   (body = TenantConfig JSON)
 *   DELETE /internal/tenants/:tenantId/config   (empty body)
 *
 * Requests are signed with `signRequest(secret, { method, path, body })` from
 * `@agent-starter/core` and sent as `x-agent-signature: t=…,v1=…`. The HMAC
 * covers method + path + body, so a captured PUT for tenant A can never be
 * replayed as a DELETE or against tenant B, and each signed request is
 * accepted once (KV replay cache) within the 300 s window.
 */
export function createTenantSyncRoutes<Env extends object>(options: TenantSyncOptions<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  const verify = async (c: { env: Env; req: { method: string; path: string; header(name: string): string | undefined } }, body: string) => {
    await verifySignedRequest(
      options.secret(c.env),
      { method: c.req.method, path: c.req.path, body, header: c.req.header("x-agent-signature") ?? null },
      {
        replay: options.replay?.(c.env) ?? new KeyValueReplayGuard(new KVStore(options.kv(c.env)), "replay:"),
        replayScope: "tenant-sync",
        ...(options.toleranceSeconds !== undefined ? { toleranceSeconds: options.toleranceSeconds } : {}),
      },
    );
  };

  app.put("/internal/tenants/:tenantId/config", async (c) => {
    const raw = await c.req.text();
    try {
      await verify(c, raw);
    } catch {
      return c.json({ error: "SIGNATURE_INVALID" }, 401);
    }
    const provider = new TenantConfigProvider({ kv: new KVStore(options.kv(c.env)) });
    try {
      const config = await provider.set(c.req.param("tenantId"), JSON.parse(raw));
      return c.json({ ok: true, config });
    } catch (error) {
      return c.json({ error: "CONFIG_INVALID", message: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete("/internal/tenants/:tenantId/config", async (c) => {
    const raw = await c.req.text();
    try {
      await verify(c, raw);
    } catch {
      return c.json({ error: "SIGNATURE_INVALID" }, 401);
    }
    const tenantId = TenantIdSchema.safeParse(c.req.param("tenantId"));
    if (!tenantId.success) return c.json({ error: "CONFIG_INVALID", message: "Invalid tenant id" }, 400);
    await options.kv(c.env).delete(`config:${tenantId.data}`);
    return c.json({ ok: true });
  });
  return app;
}
