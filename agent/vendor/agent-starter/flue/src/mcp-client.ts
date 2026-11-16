import { AgentError, type AnyAgentTool, defineAgentTool, globToRegExp, type RiskTier, type SideEffect, type TenantSecurityContext } from "@agent-starter/core";
import { jsonSchemaStandard } from "@agent-starter/integrations";

/**
 * MCP client behind the agent firewall (R-STK-09).
 *
 * Flue's `useMcpConnection` mounts a remote server's tools raw, so they would
 * bypass the core ToolExecutor (firewall, approvals, budgets, audit). This
 * module instead lists the server's tools, assigns each an honest risk tier
 * (from your allowlists, with server annotations trusted only when you say so,
 * and `destructiveHint` always able to raise the tier), labels every output
 * untrusted, and turns them into `defineAgentTool`s that `useAgentStarter`
 * mounts like any other guarded tool (`mcp: [...]` option).
 */

export interface McpToolAnnotationsLike {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A tool as listed by an MCP server (`tools/list`). */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotationsLike;
}

export interface McpCallResult {
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** The two MCP operations the adapter needs. `createMcpHttpClient` implements it; tests and custom transports can too. */
export interface McpClientLike {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<McpCallResult>;
  close?(): Promise<void>;
}

export interface McpServerOptions {
  /** Server name; tools are mounted as `mcp__<name>__<tool>`. */
  name: string;
  /** Streamable HTTP endpoint (e.g. https://mcp.example.com/mcp). Required unless `client` is given. */
  url?: string;
  /** Request headers (auth) resolved per tenant/user at connect time. Never hard-code secrets: read them from env bindings. */
  headers?: (tenant: TenantSecurityContext) => Record<string, string> | undefined;
  /** Custom client (tests, other transports). Overrides `url`. */
  client?: (tenant: TenantSecurityContext) => McpClientLike;
  /** Allowlist of server tool names (exact or glob). Omit to mount every listed tool (still firewalled). */
  tools?: string[];
  /** Server tool names (globs) that are read-only: LOW risk, `read`, idempotent. */
  readOnly?: string[];
  /** Glob → risk tier overrides (first match wins), applied after readOnly. */
  risk?: Record<string, RiskTier>;
  /** Trust the server's readOnlyHint/idempotentHint to lower risk. Default false (only `destructiveHint` is honoured, and only to raise). */
  trustAnnotations?: boolean;
  /** Tier for tools nothing else classifies. Default MEDIUM (external side effect). */
  defaultRisk?: RiskTier;
  timeoutMs?: number;
  maxOutputChars?: number;
  /** How long a tool listing is reused before re-listing (ms). Default 10 minutes. */
  refreshMs?: number;
}

/** JSON-serializable record of one MCP tool, stored in Flue persistent state so renders can mount it synchronously. */
export interface McpToolDescriptor {
  server: string;
  /** Mounted tool name (`mcp__server__tool`, ≤ 64 chars). */
  name: string;
  /** The server's own tool name. */
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: RiskTier;
  sideEffect: SideEffect;
  idempotent: boolean;
}

export interface McpRiskAssessment {
  risk: RiskTier;
  sideEffect: SideEffect;
  idempotent: boolean;
}

const matches = (name: string, globs: string[] | undefined) => (globs ?? []).some((g) => globToRegExp(g).test(name));

function sideEffectFor(risk: RiskTier, destructive: boolean): SideEffect {
  if (destructive) return "destructive";
  return risk === "LOW" ? "read" : "external";
}

/** Risk for one MCP tool. Order: destructiveHint (always raises) → readOnly allowlist → risk overrides → trusted annotations → default MEDIUM. */
export function assessMcpTool(tool: McpToolInfo, server: Pick<McpServerOptions, "readOnly" | "risk" | "trustAnnotations" | "defaultRisk">): McpRiskAssessment {
  const hints = tool.annotations ?? {};
  if (hints.destructiveHint === true) {
    const override = Object.entries(server.risk ?? {}).find(([glob]) => globToRegExp(glob).test(tool.name))?.[1];
    return { risk: override === "CRITICAL" || override === "HIGH" ? override : "CRITICAL", sideEffect: "destructive", idempotent: false };
  }
  if (matches(tool.name, server.readOnly)) return { risk: "LOW", sideEffect: "read", idempotent: true };
  const override = Object.entries(server.risk ?? {}).find(([glob]) => globToRegExp(glob).test(tool.name))?.[1];
  if (override) return { risk: override, sideEffect: sideEffectFor(override, false), idempotent: override === "LOW" };
  if (server.trustAnnotations && hints.readOnlyHint === true) return { risk: "LOW", sideEffect: "read", idempotent: true };
  const risk = server.defaultRisk ?? "MEDIUM";
  return { risk, sideEffect: sideEffectFor(risk, false), idempotent: server.trustAnnotations === true && hints.idempotentHint === true };
}

function sanitize(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `mcp__<server>__<tool>`, shortened with a stable hash when it exceeds the 64-character tool-name limit. */
export function mcpToolName(server: string, tool: string): string {
  const full = `mcp__${sanitize(server)}__${sanitize(tool)}`;
  return full.length <= 64 ? full : `${full.slice(0, 55)}_${fnv1a(full)}`;
}

/** Turn a server listing into descriptors (allowlist applied, risk assessed). */
export function describeMcpTools(server: McpServerOptions, listed: McpToolInfo[]): McpToolDescriptor[] {
  const selected = server.tools ? listed.filter((t) => matches(t.name, server.tools)) : listed;
  return selected.map((tool) => {
    const assessment = assessMcpTool(tool, server);
    const title = tool.title ?? tool.annotations?.title;
    const description = [`MCP tool "${tool.name}" from server "${server.name}".`, title && title !== tool.name ? `Title: ${title}.` : "", tool.description ?? ""].filter(Boolean).join(" ");
    return {
      server: server.name,
      name: mcpToolName(server.name, tool.name),
      toolName: tool.name,
      description: description.slice(0, 1024),
      inputSchema: { type: "object", properties: {}, ...(tool.inputSchema ?? {}) },
      ...assessment,
    };
  });
}

/** Render an MCP call result as text for the model (it is wrapped as untrusted by the executor). */
export function formatMcpResult(result: McpCallResult): string {
  const parts: string[] = [];
  if (result.structuredContent !== undefined) parts.push(`Structured content:\n${JSON.stringify(result.structuredContent, null, 2)}`);
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (item.type === "image" || item.type === "audio") parts.push(`[${String(item.type)}: ${String(item.mimeType ?? "binary")}]`);
    else if (item.type === "resource" && item.resource && typeof item.resource === "object") {
      const resource = item.resource as { uri?: string; text?: string };
      parts.push(resource.text ? `[Resource: ${resource.uri ?? "?"}]\n${resource.text}` : `[Resource: ${resource.uri ?? "?"}]`);
    } else if (item.type === "resource_link") parts.push(`[Resource link: ${String(item.name ?? "")} (${String(item.uri ?? "")})]`);
    else parts.push(JSON.stringify(item));
  }
  return parts.filter(Boolean).join("\n\n") || "(MCP tool returned no content)";
}

/**
 * Guarded agent tools from descriptors (synchronous: safe to call during a Flue render).
 * `client` resolves the live connection at execution time.
 */
export function mcpToolsFromDescriptors(descriptors: McpToolDescriptor[], server: McpServerOptions, client: () => McpClientLike): AnyAgentTool[] {
  return descriptors
    .filter((d) => d.server === server.name)
    .map((d) =>
      defineAgentTool({
        name: d.name,
        description: d.description,
        input: jsonSchemaStandard(d.inputSchema),
        // destructive tools can never be LOW (defineAgentTool enforces it); keep the assessment honest.
        risk: d.sideEffect === "destructive" && d.risk === "LOW" ? "MEDIUM" : d.risk,
        sideEffect: d.sideEffect,
        idempotent: d.idempotent,
        outputTrust: "untrusted",
        tags: ["mcp", `mcp:${d.server}`],
        ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
        ...(server.maxOutputChars ? { maxOutputChars: server.maxOutputChars } : {}),
        simulate: (args): unknown => ({ simulated: true, mcpServer: d.server, tool: d.toolName, arguments: args }),
        execute: async (args, ctx): Promise<unknown> => {
          const result = await client().callTool(d.toolName, args, { signal: ctx.signal });
          const text = formatMcpResult(result);
          if (result.isError) throw new AgentError("TOOL_EXECUTION_FAILED", `MCP tool "${d.toolName}" on "${d.server}" failed: ${text.slice(0, 2000)}`);
          return text;
        },
      }),
    );
}

const clients = new Map<string, McpClientLike>();

/** Per-isolate client cache keyed by server, tenant and user (auth headers can differ per user). */
export function mcpClientFor(server: McpServerOptions, tenant: TenantSecurityContext): McpClientLike {
  const key = `${server.name}|${tenant.tenantId}|${tenant.userId}`;
  let client = clients.get(key);
  if (!client) {
    if (server.client) client = server.client(tenant);
    else if (server.url) client = createMcpHttpClient({ url: server.url, headers: () => server.headers?.(tenant) ?? {} });
    else throw new AgentError("CONFIG_INVALID", `MCP server "${server.name}" needs a url or a client.`);
    clients.set(key, client);
  }
  return client;
}

/** Drop cached clients (tests, credential rotation). */
export function resetMcpClients(): void {
  clients.clear();
}

/** One-shot (non-Flue) helper: list a server's tools and return guarded agent tools, e.g. for AgentRuntime or the MCP-server bridge. */
export async function createMcpTools(server: McpServerOptions, tenant: TenantSecurityContext): Promise<AnyAgentTool[]> {
  const client = mcpClientFor(server, tenant);
  return mcpToolsFromDescriptors(describeMcpTools(server, await client.listTools()), server, () => client);
}

// ---------------------------------------------------------------------------
// Minimal Streamable HTTP MCP client (JSON-RPC over fetch; JSON or SSE replies).
// ---------------------------------------------------------------------------

export interface McpHttpClientOptions {
  url: string;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: typeof fetch;
  /** Per-request timeout (ms). Default 60 s. */
  timeoutMs?: number;
  protocolVersion?: string;
  clientName?: string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Fetch-only MCP client (Workers compatible): initialize → tools/list (paginated) → tools/call. */
export function createMcpHttpClient(options: McpHttpClientOptions): McpClientLike {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const protocolVersion = options.protocolVersion ?? "2025-06-18";
  let sessionId: string | undefined;
  let initialized: Promise<void> | undefined;
  let nextId = 1;

  const post = async (body: Record<string, unknown>, signal?: AbortSignal): Promise<JsonRpcResponse | null> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocolVersion,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(await options.headers?.()),
    };
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
    const response = await doFetch(options.url, { method: "POST", headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const session = response.headers.get("mcp-session-id");
    if (session) sessionId = session;
    if (response.status === 202 || response.status === 204) return null;
    if (!response.ok) throw new AgentError("HTTP_ERROR", `MCP ${String(body.method)} failed with HTTP ${response.status}`, { retryable: response.status >= 500 || response.status === 429 });
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) {
      const text = await response.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const message = JSON.parse(data) as JsonRpcResponse;
        if (message.id === body.id) return message;
      }
      throw new AgentError("HTTP_ERROR", `MCP ${String(body.method)}: no response in event stream`);
    }
    return (await response.json()) as JsonRpcResponse;
  };

  const request = async (method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    const message = await post({ jsonrpc: "2.0", id: nextId++, method, params }, signal);
    if (!message) throw new AgentError("HTTP_ERROR", `MCP ${method}: empty response`);
    if (message.error) throw new AgentError("TOOL_EXECUTION_FAILED", `MCP ${method} error ${message.error.code}: ${message.error.message}`);
    return message.result;
  };

  const ensureInitialized = () => {
    initialized ??= (async () => {
      await request("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: options.clientName ?? "agent-starter", version: "0.1.0" } });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    return initialized;
  };

  return {
    async listTools() {
      await ensureInitialized();
      const tools: McpToolInfo[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = (await request("tools/list", cursor ? { cursor } : {})) as { tools?: McpToolInfo[]; nextCursor?: string };
        tools.push(...(page.tools ?? []));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) break;
        if (cursor) seen.add(cursor);
      } while (cursor);
      return tools;
    },
    async callTool(name, args, callOptions = {}) {
      await ensureInitialized();
      return (await request("tools/call", { name, arguments: args }, callOptions.signal)) as McpCallResult;
    },
    async close() {
      sessionId = undefined;
      initialized = undefined;
    },
  };
}
