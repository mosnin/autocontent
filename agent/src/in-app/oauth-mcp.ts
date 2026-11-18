import { createAgentOAuthProvider, createConsentHandler, createToolMcpHandler, KVStore, requireScopes } from "@agent-starter/cloudflare";
import { TokenBucketRateLimiter, ToolFirewall } from "@agent-starter/core";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Env } from "../env.ts";
import { bindings, tenantConfigs } from "../lib/platform.ts";
import { appApiFirewall, appApiTools } from "./app-api.ts";
import { guardMcpTool, MCP_WRITE_RATE, mcpExposedTools } from "./mcp-guard.ts";

/**
 * OAuth 2.1 + MCP: external AI clients (Claude, ChatGPT, Cursor, other agents)
 * connect to https://<worker>/mcp, the user signs in with your SaaS session and
 * consents, and the client can then call the SAME firewalled copilot tools —
 * with tenant isolation, risk tiers and approvals enforced by the ToolExecutor.
 */
type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

/**
 * The MCP server's executor passes no host services: `guardMcpTool` (mcp-guard.ts) hands the Marketer tools the
 * Worker env at call time (they read PRIMARY_SAAS_API_URL / SAAS_SERVICE_TOKEN from `ctx.services.env`) and meters
 * writes per tenant in AGENT_CACHE. HIGH/CRITICAL tools are not exposed over MCP: MCP calls have no approval resume
 * path, so a parked call could never complete (decide inbox items in the app).
 */
const mcp = createToolMcpHandler({
  name: "marketer-copilot",
  version: "1.0.0",
  tools: mcpExposedTools(appApiTools()).map((tool) => guardMcpTool(tool, { env: bindings, limiter: () => new TokenBucketRateLimiter(new KVStore(bindings().AGENT_CACHE), MCP_WRITE_RATE) })),
  // A fresh firewall per MCP request and caller: quotas (maxCallsPerTool) are never shared between clients or tenants.
  executor: () => ({ firewall: new ToolFirewall(appApiFirewall) }),
  resolveCaller: async (props) => {
    const tenantId = String(props.tenantId ?? "");
    const userId = String(props.userId ?? "");
    if (!tenantId || !userId) throw new Error("Missing OAuth grant props");
    const tenantConfig = await tenantConfigs().get(tenantId);
    return { tenant: { tenantId, userId, environment: "production", roles: [], scopes: [] }, tenantConfig };
  },
});

let provider: ReturnType<typeof createAgentOAuthProvider<OAuthEnv>> | undefined;
function oauth(env: Env) {
  provider ??= createAgentOAuthProvider<OAuthEnv>({
    apiRoute: "/mcp",
    apiHandler: {
      fetch: (request, envArg, ctx) => {
        // The OAuth provider attaches the verified grant; without it there is no caller to authorize: fail closed.
        const auth = (ctx as unknown as { auth?: { scope: string[]; token: string; audience: string } }).auth;
        if (!auth) return new Response(JSON.stringify({ error: "invalid_token", error_description: "Missing OAuth grant" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Bearer error="invalid_token"' } });
        const denied = requireScopes(auth as never, ["mcp:tools"]);
        if (denied) return denied;
        return mcp(request, envArg, ctx);
      },
    },
    defaultHandler: createConsentHandler<OAuthEnv>({
      appName: env.SERVICE_NAME,
      sessionSecret: (e) => [e.SESSION_SIGNING_SECRET, e.SESSION_SIGNING_SECRET_PREVIOUS].filter((s): s is string => Boolean(s)),
      loginUrl: (returnTo) => `${env.ALLOWED_ORIGINS.split(",")[0]?.trim() ?? ""}/login?returnTo=${encodeURIComponent(returnTo)}`,
    }),
    scopesSupported: ["mcp:tools", "offline_access"],
    resource: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/mcp`,
    issuer: env.PUBLIC_BASE_URL,
  });
  return provider;
}

export const oauthMcpRoutes = new Hono<{ Bindings: Env }>().all("/mcp", (c) => oauth(c.env).fetch(c.req.raw, c.env as OAuthEnv, c.executionCtx as ExecutionContext))
  .all("/authorize", (c) => oauth(c.env).fetch(c.req.raw, c.env as OAuthEnv, c.executionCtx as ExecutionContext))
  .all("/oauth/*", (c) => oauth(c.env).fetch(c.req.raw, c.env as OAuthEnv, c.executionCtx as ExecutionContext))
  .all("/.well-known/*", (c) => oauth(c.env).fetch(c.req.raw, c.env as OAuthEnv, c.executionCtx as ExecutionContext));
