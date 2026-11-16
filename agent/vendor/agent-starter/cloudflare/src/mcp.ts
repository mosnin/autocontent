import { type AnyAgentTool, type StandardSchemaV1, type TenantConfig, type TenantSecurityContext, toJsonSchema, ToolExecutor, type ToolExecutorOptions } from "@agent-starter/core";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

/** Give any Standard Schema a `~standard.jsonSchema` converter so the MCP SDK can advertise it. */
export function withJsonSchema<S extends StandardSchemaV1>(schema: S) {
  const standard = schema["~standard"];
  return {
    "~standard": {
      ...standard,
      jsonSchema: { input: () => toJsonSchema(schema), output: () => toJsonSchema(schema) },
    },
  };
}

export interface ToolMcpServerOptions {
  name: string;
  version: string;
  tools: AnyAgentTool[];
  /** Resolve the caller from OAuth props (set at consent time) → tenant context and config. */
  resolveCaller: (props: Record<string, unknown>) => Promise<{ tenant: TenantSecurityContext; tenantConfig: TenantConfig }>;
  /**
   * Extra executor wiring (firewall, approvals, budget, telemetry...). Pass a
   * factory so stateful pieces (a `ToolFirewall`'s per-run quotas) are created
   * per MCP request and per caller instead of being shared by every client.
   */
  executor?: Omit<ToolExecutorOptions, "tools"> | ((caller: { tenant: TenantSecurityContext; tenantConfig: TenantConfig }) => Omit<ToolExecutorOptions, "tools">);
  route?: string;
  allowedHostnames?: string[];
}

/**
 * Expose guarded agent tools as an MCP server (Cloudflare Agents SDK
 * `createMcpHandler`, MCP SDK v2). Every MCP `tools/call` runs through the same
 * ToolExecutor pipeline as the agent itself — validation, tenant isolation,
 * firewall, risk tiers (HIGH/CRITICAL return a pending-approval result instead
 * of executing) and idempotency. Wrap the returned handler with
 * `createAgentOAuthProvider` so only authorized clients reach it.
 */
export function createToolMcpHandler(options: ToolMcpServerOptions) {
  const factory = () => {
    const server = new McpServer({ name: options.name, version: options.version });
    for (const tool of options.tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: withJsonSchema(tool.input) as never,
          annotations: {
            readOnlyHint: tool.sideEffect === "none" || tool.sideEffect === "read",
            destructiveHint: tool.sideEffect === "destructive",
            idempotentHint: tool.idempotent === true,
            openWorldHint: tool.sideEffect === "external",
          },
        },
        (async (args: unknown) => {
          const props = getMcpAuthContext()?.props ?? {};
          const caller = await options.resolveCaller(props);
          const executorOptions = typeof options.executor === "function" ? options.executor(caller) : options.executor;
          const executor = new ToolExecutor({ ...executorOptions, tools: options.tools });
          const outcome = await executor.execute(
            { id: `mcp_${crypto.randomUUID()}`, name: tool.name, arguments: args },
            { tenant: caller.tenant, tenantConfig: caller.tenantConfig, runId: `mcp:${caller.tenant.tenantId}:${caller.tenant.userId}`, signal: new AbortController().signal, mode: "live", log: () => {}, services: {} },
          );
          return { content: [{ type: "text" as const, text: outcome.text }], isError: outcome.status !== "ok" && outcome.status !== "simulated" };
        }) as never,
      );
    }
    return server;
  };
  return createMcpHandler(factory as never, {
    route: options.route ?? "/mcp",
    ...(options.allowedHostnames ? { allowedHostnames: options.allowedHostnames } : {}),
  } as never);
}
