import { AgentError, type AnyAgentTool, defineAgentTool } from "@agent-starter/core";

/**
 * Guards for the tools exposed over MCP (src/in-app/oauth-mcp.ts). Pure: the env and the limiter are injected, so it
 * runs in Node tests.
 *
 * An MCP call is not a conversation: there is no BudgetGuard, no per-run firewall quota that survives the request
 * (the firewall is rebuilt per request), no approval resume path and no idempotency ledger (tool-call ids are
 * random per request). So, per tool:
 *  - HIGH / CRITICAL tools are never exposed (a parked call could never complete);
 *  - MEDIUM writes (start a video, a carousel, an article: each spends content credits) are metered per TENANT in
 *    durable storage: an external client that loops, or retries after a timeout, runs into RATE_LIMITED instead of
 *    the account's credits. The backend's own spend caps stay the last wall.
 *  - reads are not metered here (the OAuth provider and the backend rate limit them).
 */
export interface McpWriteLimiter {
  take(key: string, cost?: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/** Writes an external MCP client may make per tenant: a burst of 5, refilled at 20 per hour. */
export const MCP_WRITE_RATE = Object.freeze({ ratePerMinute: 20 / 60, burst: 5, prefix: "rl:mcp-write:" });

const isWrite = (tool: AnyAgentTool) => tool.sideEffect === "write" || tool.sideEffect === "external" || tool.sideEffect === "destructive";

/** The tools an MCP client may see: no UI-only tool, nothing that needs a person's approval. */
export function mcpExposedTools(tools: readonly AnyAgentTool[]): AnyAgentTool[] {
  return tools.filter((t) => t.name !== "navigate_ui" && t.risk !== "HIGH" && t.risk !== "CRITICAL" && t.requiresApproval !== true);
}

/**
 * Wrap one tool for MCP: hand it the Worker env at call time (the MCP executor passes no host services) and meter
 * its writes per tenant. The limiter fails CLOSED: if it cannot be read, the write is refused (a read still runs).
 */
export function guardMcpTool(tool: AnyAgentTool, deps: { env: () => unknown; limiter: () => McpWriteLimiter }): AnyAgentTool {
  return defineAgentTool({
    ...tool,
    execute: async (args, ctx) => {
      if (isWrite(tool) && ctx.mode === "live") {
        let decision: { allowed: boolean; retryAfterMs: number };
        try {
          decision = await deps.limiter().take(ctx.tenant.tenantId);
        } catch {
          throw new AgentError("RATE_LIMITED", `TEMPORARILY_UNAVAILABLE: the write limit for ${tool.name} could not be checked, so nothing was sent. Try later.`, { retryable: false });
        }
        if (!decision.allowed) {
          const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
          throw new AgentError("RATE_LIMITED", `TEMPORARILY_UNAVAILABLE: this account's limit for changes over MCP is used up, so ${tool.name} was not sent. Do not retry now; earliest retry in about ${seconds}s.`, { details: { retryAfterMs: decision.retryAfterMs }, retryable: false });
        }
      }
      return tool.execute(args, { ...ctx, services: { ...ctx.services, env: deps.env() } });
    },
  }) as unknown as AnyAgentTool;
}
