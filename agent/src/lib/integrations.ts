import { type McpServerConfig, type TenantSecurityContext, verifySessionToken } from "@agent-starter/core";
import type { McpServerOptions } from "@agent-starter/flue";
import type { ComposioToolset } from "@agent-starter/integrations";
import { Hono } from "hono";
import { z } from "zod";

/**
 * Config-driven integrations (pure: no bindings, so test/platform.test.ts covers it in Node).
 * platform.ts passes the results to every agent's useAgentStarter.
 */

/**
 * `mcpServers` from agent-starter.config.ts → the hook's `mcp` option. Tools mount as
 * `mcp__<name>__<tool>` behind the firewall (risk from readOnly / risk / defaultRisk, MEDIUM otherwise;
 * server annotations may only raise risk). The bearer token is read from the Worker secret named by
 * `tokenSecret` at connect time; a missing secret sends no Authorization header (the server refuses).
 */
export function mcpServersFromConfig(servers: readonly McpServerConfig[], readSecret: (name: string) => string | undefined): McpServerOptions[] {
  return servers.map((server) => ({
    name: server.name,
    url: server.url,
    ...(server.tokenSecret
      ? {
          headers: () => {
            const token = readSecret(server.tokenSecret as string);
            return token ? { authorization: `Bearer ${token}` } : undefined;
          },
        }
      : {}),
    ...(server.tools ? { tools: server.tools } : {}),
    ...(server.readOnly ? { readOnly: server.readOnly } : {}),
    ...(server.risk ? { risk: server.risk } : {}),
    ...(server.defaultRisk ? { defaultRisk: server.defaultRisk } : {}),
    ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
  }));
}

/** AI Gateway response-cache TTL (`cf-aig-cache-ttl`): default 3600 s (the spec's ~1 h), `AI_GATEWAY_CACHE_TTL` overrides, "0" disables. */
export function gatewayCacheTtlSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return 3600;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), 30 * 86_400);
}

/** Identities the harness acts as (background jobs, delegated workers, rooms, services), never a person. */
export function isHarnessIdentity(tenant: Pick<TenantSecurityContext, "userId" | "roles">): boolean {
  return /^(?:system|agent|room|service|cron)(?::|$)/.test(tenant.userId) || tenant.roles.some((role) => role === "system" || role === "agent" || role === "service" || role === "cron");
}

const TOOLKIT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * POST /api/integrations/composio/authorize `{ toolkit }` → `{ url, connectionRequestId }`: starts the
 * Composio connection flow for the signed-in user (session token; the Composio user is
 * `${tenantId}:${userId}`, so a connection never serves another user or tenant). Widget visitors and
 * voice tokens are refused (verifySessionToken accepts no restricted audience here). 404 when Composio
 * is not configured.
 */
export function createIntegrationRoutes<E extends object>(options: { toolset: () => ComposioToolset | undefined; sessionSecrets: (env: E) => string[]; callbackUrl?: (env: E) => string | undefined }) {
  return new Hono<{ Bindings: E }>().post("/api/integrations/composio/authorize", async (c) => {
    let claims: Awaited<ReturnType<typeof verifySessionToken>>;
    try {
      claims = await verifySessionToken(options.sessionSecrets(c.env), c.req.header("authorization") ?? null);
    } catch {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    const toolset = options.toolset();
    if (!toolset) return c.json({ error: "COMPOSIO_NOT_CONFIGURED" }, 404);
    const body = z.object({ toolkit: z.string().regex(TOOLKIT) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "INVALID_REQUEST" }, 400);
    const tenant: TenantSecurityContext = { tenantId: claims.tid, userId: claims.sub, roles: claims.roles, scopes: claims.scopes, environment: claims.env };
    const callbackUrl = options.callbackUrl?.(c.env);
    const authorization = await toolset.authorize(tenant, body.data.toolkit, callbackUrl ? { callbackUrl } : {});
    return c.json(authorization);
  });
}
