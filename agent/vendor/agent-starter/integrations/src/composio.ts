import {
  AgentError,
  type AnyAgentTool,
  defineAgentTool,
  type RiskTier,
  type SideEffect,
  type TenantConfig,
  TenantIsolationError,
  type TenantSecurityContext,
  ToolFirewall,
  type ToolFirewallPolicy,
  globToRegExp,
  sha256Hex,
} from "@agent-starter/core";
import { BaseNonAgenticProvider, Composio, ComposioToolInputRequiredError, SessionPreset } from "@composio/core";
import type { Tool as ComposioRawTool, ToolRouterCreateSessionConfig } from "@composio/core";
import { type JsonSchemaObject, jsonSchemaStandard } from "./json-schema.ts";

/**
 * Composio integration with an agent firewall in front of every action.
 *
 * Flow: `composio.create(userId, config)` opens a per-user Tool Router session
 * (DIRECT_TOOLS preset by default, so every real tool slug is visible to the
 * firewall instead of being hidden behind COMPOSIO_MULTI_EXECUTE_TOOL), the
 * session's tools are adapted into core `AgentToolDefinition`s with a risk tier
 * derived from the slug, and every execution re-checks the core `ToolFirewall`
 * (allow/deny globs, per-tenant lists, quotas, argument rules) before calling
 * `session.execute()`. Composio-native allow/deny (`toolkits`, `tools`,
 * `tags`, `hooks`, `requireApproval`) is passed through in `session` so the
 * vendor enforces the same policy server-side.
 */

/** Raw Composio tool provider: `session.tools()` returns Composio's own `Tool` objects (slug + JSON schema). */
export class RawToolsProvider extends BaseNonAgenticProvider<ComposioRawTool[], ComposioRawTool> {
  readonly name = "agent-starter-raw";
  wrapTool(tool: ComposioRawTool): ComposioRawTool {
    return tool;
  }
  wrapTools(tools: ComposioRawTool[]): ComposioRawTool[] {
    return tools;
  }
}

/** Result shape of `session.execute()` (`ToolRouterSessionExecuteResponse`). */
export interface ComposioExecuteResult {
  data: Record<string, unknown>;
  error: string | null;
  logId?: string;
  resultType?: "completed" | "failed" | "blocked";
  blockReason?: { type: string; hookId: string };
}

export interface ComposioConnectionRequestLike {
  id: string;
  status?: string;
  redirectUrl?: string | null;
}

/** The subset of a Composio Tool Router session the toolset uses (structurally satisfied by `SessionWithoutMcp`). */
export interface ComposioSessionLike {
  readonly sessionId: string;
  tools(): Promise<unknown>;
  execute(toolSlug: string, arguments_?: Record<string, unknown>, options?: { account?: string }): Promise<ComposioExecuteResult>;
  authorize(toolkit: string, options?: { callbackUrl?: string; alias?: string }): Promise<ComposioConnectionRequestLike>;
}

/** The subset of the `Composio` client the toolset uses (structurally satisfied by `new Composio(...)`). */
export interface ComposioClientLike {
  create(userId: string, config?: ToolRouterCreateSessionConfig): Promise<ComposioSessionLike>;
}

/**
 * Create a Workers-compatible Composio client whose sessions return raw tools
 * (required for schema adaptation). Tracking and the SDK's npm "latest
 * version" check are off by default: both would add a stray subrequest to
 * every Worker invocation that constructs a client.
 */
export function createComposioClient(options: { apiKey: string; baseURL?: string; allowTracking?: boolean; disableVersionCheck?: boolean }): ComposioClientLike {
  const client: ComposioClientLike = new Composio({
    apiKey: options.apiKey,
    provider: new RawToolsProvider(),
    allowTracking: options.allowTracking ?? false,
    disableVersionCheck: options.disableVersionCheck ?? true,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
  return client;
}

export interface ComposioRiskAssessment {
  risk: RiskTier;
  sideEffect: SideEffect;
  idempotent: boolean;
}

const DESTRUCTIVE_VERBS = ["DELETE", "REMOVE", "DESTROY"];
const WRITE_VERBS = ["SEND", "CREATE", "POST", "UPDATE"];
const READ_VERBS = ["GET", "LIST", "SEARCH", "FETCH"];

function hasVerb(slug: string, verbs: string[]): boolean {
  const parts = slug.toUpperCase().split(/[^A-Z0-9]+/);
  // First segment is the toolkit (GITHUB_, GMAIL_...), so verbs are matched on the rest.
  return parts.slice(1).some((part) => verbs.includes(part));
}

/**
 * Risk mapping for Composio slugs. The most dangerous verb wins:
 * *_DELETE_* / *_REMOVE_* / *_DESTROY_* → CRITICAL destructive;
 * *_SEND_* / *_CREATE_* / *_POST_* / *_UPDATE_* → HIGH external;
 * *_GET_* / *_LIST_* / *_SEARCH_* / *_FETCH_* → LOW read; anything else → MEDIUM external.
 * Composio's `destructiveHint` / `createHint` / `updateHint` tags can only raise the tier, never lower it.
 */
export function classifyComposioTool(slug: string, tags: readonly string[] = []): ComposioRiskAssessment {
  const lowerTags = tags.map((t) => t.toLowerCase());
  if (hasVerb(slug, DESTRUCTIVE_VERBS) || lowerTags.includes("destructivehint")) return { risk: "CRITICAL", sideEffect: "destructive", idempotent: false };
  if (hasVerb(slug, WRITE_VERBS) || lowerTags.includes("createhint") || lowerTags.includes("updatehint")) return { risk: "HIGH", sideEffect: "external", idempotent: false };
  if (hasVerb(slug, READ_VERBS)) return { risk: "LOW", sideEffect: "read", idempotent: true };
  return { risk: "MEDIUM", sideEffect: "external", idempotent: false };
}

/** A Composio tool normalized from any provider format (raw, OpenAI function, Anthropic). */
export interface NormalizedComposioTool {
  slug: string;
  description: string;
  inputSchema: JsonSchemaObject;
  tags: string[];
  toolkit?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Accepts Composio raw tools, OpenAI `{ type: "function", function }` tools and Anthropic `{ name, input_schema }` tools. */
export function normalizeComposioTools(raw: unknown): NormalizedComposioTool[] {
  if (!Array.isArray(raw)) {
    throw new AgentError("CONFIG_INVALID", "Composio session.tools() did not return an array. Create the client with `createComposioClient()` (RawToolsProvider) or a provider that returns a tool array.");
  }
  const out: NormalizedComposioTool[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const fn = asRecord(record.function);
    if (typeof record.slug === "string") {
      const toolkit = asRecord(record.toolkit);
      out.push({
        slug: record.slug,
        description: typeof record.description === "string" ? record.description : String(record.name ?? record.slug),
        inputSchema: asRecord(record.inputParameters) ?? { type: "object", properties: {} },
        tags: Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === "string") : [],
        ...(typeof toolkit?.slug === "string" ? { toolkit: toolkit.slug } : {}),
      });
    } else if (fn && typeof fn.name === "string") {
      out.push({ slug: fn.name, description: typeof fn.description === "string" ? fn.description : fn.name, inputSchema: asRecord(fn.parameters) ?? { type: "object", properties: {} }, tags: [] });
    } else if (typeof record.name === "string") {
      out.push({
        slug: record.name,
        description: typeof record.description === "string" ? record.description : record.name,
        inputSchema: asRecord(record.input_schema) ?? asRecord(record.inputSchema) ?? { type: "object", properties: {} },
        tags: [],
      });
    }
  }
  return out;
}

const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

async function toolNameFor(slug: string): Promise<string> {
  if (TOOL_NAME.test(slug)) return slug;
  const cleaned = slug.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^[^a-zA-Z]+/, "");
  const hash = (await sha256Hex(slug)).slice(0, 8);
  return `${(cleaned || "composio").slice(0, 55)}_${hash}`;
}

export interface ComposioToolsetOptions {
  client: ComposioClientLike;
  /**
   * Forwarded to `composio.create(userId, config)`. Put Composio-native allow/deny
   * here: `toolkits`, `tools: { github: { disable: ["GITHUB_DELETE_A_REPOSITORY"] } }`,
   * `tags`, `hooks`, `authConfigs`, `connectedAccounts`. Defaults to
   * `{ sessionPreset: "direct_tools" }`.
   */
  session?: ToolRouterCreateSessionConfig;
  /** Agent firewall applied before tools are exposed and again before every execution. */
  firewall?: ToolFirewall | ToolFirewallPolicy;
  /**
   * Expose Composio meta tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, ...).
   * Off by default: multi-execute would run slugs the firewall never evaluated.
   */
  allowMetaTools?: boolean;
  /** Add Composio's server-side `after_execute` prompt-injection check hook to inline session configs. */
  promptInjectionHook?: boolean;
  /** Glob → assessment overrides applied after the default classification (first match wins). */
  riskOverrides?: Array<{ match: string } & Partial<ComposioRiskAssessment>>;
  /** Maps the executing tenant/user to the Composio user id (default `${tenantId}:${userId}`). */
  userIdFor?: (tenant: TenantSecurityContext) => string;
  /** Connected-account selector forwarded to `session.execute(..., { account })`. */
  account?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface ComposioAuthorization {
  /** Where to send the user to connect the toolkit; null for toolkits that need no redirect. */
  url: string | null;
  connectionRequestId: string;
  status?: string;
}

/**
 * JSON-serializable record of one adapted Composio tool. Flue renders are
 * synchronous, so `useAgentStarter` preloads descriptors in `useAgentStart`
 * (`describeTools`), keeps them in persistent state and rebuilds the guarded
 * tools on every render with `toolsFromDescriptors`.
 */
export interface ComposioToolDescriptor extends ComposioRiskAssessment {
  /** Agent tool name (slug, or a hashed safe name when the slug is not a valid tool name). */
  name: string;
  slug: string;
  description: string;
  inputSchema: JsonSchemaObject;
  tags: string[];
  toolkit?: string;
}

export const DEFAULT_COMPOSIO_USER_ID = (tenant: TenantSecurityContext): string => `${tenant.tenantId}:${tenant.userId}`;

export class ComposioToolset {
  readonly firewall: ToolFirewall;
  private readonly sessions = new Map<string, Promise<ComposioSessionLike>>();
  private readonly userIdFor: (tenant: TenantSecurityContext) => string;

  constructor(private readonly options: ComposioToolsetOptions) {
    this.firewall = options.firewall instanceof ToolFirewall ? options.firewall : new ToolFirewall(options.firewall ?? {});
    this.userIdFor = options.userIdFor ?? DEFAULT_COMPOSIO_USER_ID;
  }

  private sessionConfig(): ToolRouterCreateSessionConfig {
    const base = this.options.session ?? {};
    const config: ToolRouterCreateSessionConfig = { sessionPreset: SessionPreset.DIRECT_TOOLS, ...base };
    const usesSavedConfig = Boolean((base as { experimental?: { sessionConfigId?: string } }).experimental?.sessionConfigId);
    if (this.options.promptInjectionHook && !usesSavedConfig) {
      const existing: unknown[] = (base as { hooks?: unknown[] }).hooks ?? [];
      const hook = { type: "after_execute", id: "agent-starter-prompt-injection", appliesTo: "all", handler: { type: "prompt_injection_check", action: "block" } } as const;
      return { ...config, hooks: [...existing, hook] } as ToolRouterCreateSessionConfig;
    }
    return config;
  }

  /** Resolve the Composio user id for a plain id or a tenant security context. */
  resolveUserId(user: string | TenantSecurityContext): string {
    return typeof user === "string" ? user : this.userIdFor(user);
  }

  /** Per-user session (cached for the lifetime of this toolset; sessions persist server-side). */
  session(user: string | TenantSecurityContext): Promise<ComposioSessionLike> {
    const userId = this.resolveUserId(user);
    let pending = this.sessions.get(userId);
    if (!pending) {
      pending = this.options.client.create(userId, this.sessionConfig());
      pending.catch(() => this.sessions.delete(userId));
      this.sessions.set(userId, pending);
    }
    return pending;
  }

  /** Start a connection flow for a toolkit; returns the URL the user must open. */
  async authorize(user: string | TenantSecurityContext, toolkit: string, options: { callbackUrl?: string; alias?: string } = {}): Promise<ComposioAuthorization> {
    const session = await this.session(user);
    const request = await session.authorize(toolkit, options);
    return { url: request.redirectUrl ?? null, connectionRequestId: request.id, ...(request.status ? { status: request.status } : {}) };
  }

  assess(slug: string, tags: readonly string[] = []): ComposioRiskAssessment {
    const base = classifyComposioTool(slug, tags);
    const override = this.options.riskOverrides?.find((o) => globToRegExp(o.match).test(slug));
    if (!override) return base;
    const merged = { risk: override.risk ?? base.risk, sideEffect: override.sideEffect ?? base.sideEffect, idempotent: override.idempotent ?? base.idempotent };
    // A destructive action can never be LOW (core refuses to define such a tool).
    if (merged.sideEffect === "destructive" && merged.risk === "LOW") merged.risk = "MEDIUM";
    return merged;
  }

  /** Adapt the session's tools into firewall-filtered core tool definitions bound to one Composio user. */
  async tools(user: string | TenantSecurityContext, tenantConfig?: TenantConfig): Promise<AnyAgentTool[]> {
    const userId = this.resolveUserId(user);
    const bindsTenant = typeof user !== "string";
    const session = await this.session(user);
    const normalized = normalizeComposioTools(await session.tools()).filter((tool) => this.options.allowMetaTools || !/^COMPOSIO_/i.test(tool.slug));
    const visible = this.firewall.visible(
      normalized.map((tool) => ({ ...tool, name: tool.slug })),
      tenantConfig,
    );
    const tools: AnyAgentTool[] = [];
    for (const tool of visible) tools.push(await this.adapt(tool, userId, bindsTenant));
    return tools;
  }

  /** Firewall-filtered, risk-assessed descriptors for a user's session tools (async; run outside renders). */
  async describeTools(user: string | TenantSecurityContext, tenantConfig?: TenantConfig): Promise<ComposioToolDescriptor[]> {
    const session = await this.session(user);
    const normalized = normalizeComposioTools(await session.tools()).filter((tool) => this.options.allowMetaTools || !/^COMPOSIO_/i.test(tool.slug));
    const visible = this.firewall.visible(
      normalized.map((tool) => ({ ...tool, name: tool.slug })),
      tenantConfig,
    );
    const out: ComposioToolDescriptor[] = [];
    for (const tool of visible) {
      out.push({
        name: await toolNameFor(tool.slug),
        slug: tool.slug,
        description: tool.description.slice(0, 1024),
        inputSchema: tool.inputSchema,
        tags: tool.tags,
        ...(tool.toolkit ? { toolkit: tool.toolkit } : {}),
        ...this.assess(tool.slug, tool.tags),
      });
    }
    return out;
  }

  /** Rebuild guarded tools from descriptors synchronously (safe inside a Flue render). */
  toolsFromDescriptors(descriptors: ComposioToolDescriptor[], user: string | TenantSecurityContext): AnyAgentTool[] {
    const userId = this.resolveUserId(user);
    const bindsTenant = typeof user !== "string";
    return descriptors.map((d) => this.build(d, userId, bindsTenant));
  }

  private async adapt(tool: NormalizedComposioTool, userId: string, bindsTenant: boolean): Promise<AnyAgentTool> {
    const assessment = this.assess(tool.slug, tool.tags);
    return this.build({ name: await toolNameFor(tool.slug), slug: tool.slug, description: tool.description, inputSchema: tool.inputSchema, tags: tool.tags, ...(tool.toolkit ? { toolkit: tool.toolkit } : {}), ...assessment }, userId, bindsTenant);
  }

  private build(tool: ComposioToolDescriptor, userId: string, bindsTenant: boolean): AnyAgentTool {
    const slug = tool.slug;
    // A destructive action can never be LOW (core refuses to define such a tool).
    const risk = tool.sideEffect === "destructive" && tool.risk === "LOW" ? "MEDIUM" : tool.risk;
    return defineAgentTool({
      name: tool.name,
      description: tool.description.slice(0, 1024),
      input: jsonSchemaStandard(tool.inputSchema),
      risk,
      sideEffect: tool.sideEffect,
      idempotent: tool.idempotent,
      outputTrust: "untrusted",
      tags: ["composio", ...(tool.toolkit ? [`toolkit:${tool.toolkit}`] : []), ...tool.tags.map((t) => `composio:${t}`)],
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
      ...(this.options.maxOutputChars ? { maxOutputChars: this.options.maxOutputChars } : {}),
      simulate: (args) => ({ simulated: true, composioTool: slug, arguments: args }),
      execute: async (args, ctx) => {
        if (bindsTenant && this.userIdFor(ctx.tenant) !== userId) {
          throw new TenantIsolationError(`Composio tool "${slug}" is bound to a different user than the executing context.`, { tool: slug });
        }
        return this.execute(userId, slug, args, ctx.tenantConfig);
      },
    });
  }

  /** Firewall-checked execution of one Composio slug for a user. */
  async execute(user: string | TenantSecurityContext, slug: string, args: Record<string, unknown>, tenantConfig?: TenantConfig): Promise<unknown> {
    if (!this.options.allowMetaTools && /^COMPOSIO_/i.test(slug)) {
      throw new AgentError("TOOL_NOT_ALLOWED", `Composio meta tool "${slug}" is disabled by the agent firewall.`, { details: { tool: slug } });
    }
    const decision = this.firewall.evaluate(slug, args, tenantConfig);
    if (!decision.allowed) throw new AgentError("TOOL_NOT_ALLOWED", decision.reason ?? `Tool "${slug}" is blocked by the agent firewall.`, { details: { tool: slug } });
    this.firewall.record(slug);
    const session = await this.session(user);
    let result: ComposioExecuteResult;
    try {
      result = await session.execute(slug, args, this.options.account ? { account: this.options.account } : undefined);
    } catch (error) {
      if (error instanceof ComposioToolInputRequiredError) {
        throw new AgentError("APPROVAL_REQUIRED", `Composio requires user input before running "${slug}".`, {
          details: { tool: slug, inputRequests: error.inputRequests },
          cause: error,
        });
      }
      throw new AgentError("TOOL_EXECUTION_FAILED", `Composio execution of "${slug}" failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error, retryable: false });
    }
    if (result.resultType === "blocked") {
      throw new AgentError("TOOL_NOT_ALLOWED", `Composio session hook blocked "${slug}": ${result.error ?? "blocked"}`, { details: { tool: slug, blockReason: result.blockReason, logId: result.logId } });
    }
    if (result.resultType === "failed" || (result.resultType === undefined && result.error)) {
      throw new AgentError("TOOL_EXECUTION_FAILED", `Composio tool "${slug}" failed: ${result.error ?? "unknown error"}`, { details: { tool: slug, logId: result.logId } });
    }
    return result.data;
  }
}
