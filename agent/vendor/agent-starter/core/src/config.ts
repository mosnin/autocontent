import { z } from "zod";
import { RiskTierSchema } from "./tenancy/tenancy.ts";

export const ModuleNameSchema = z.enum(["chat", "widget", "in-app", "background", "multi-agent", "computer-use", "coding", "voice", "persistent"]);
export type ModuleName = z.infer<typeof ModuleNameSchema>;

/** One external MCP server (Streamable HTTP). The serializable subset of the Flue hook's `McpServerOptions`. */
export const McpServerConfigSchema = z.object({
  /** Tools mount as `mcp__<name>__<tool>`. */
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  url: z.url({ protocol: /^https$/ }),
  /** Name of the Worker secret (wrangler secret put) holding the bearer token, e.g. "LINEAR_MCP_TOKEN". Never the token itself. */
  tokenSecret: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
  /** Allowlist of server tool names (exact or glob). Omit to mount every listed tool (still firewalled). */
  tools: z.array(z.string().min(1)).optional(),
  /** Server tool names (globs) that are read-only: LOW risk, `read`, idempotent. */
  readOnly: z.array(z.string().min(1)).optional(),
  /** Glob → risk tier overrides (first match wins). */
  risk: z.record(z.string(), RiskTierSchema).optional(),
  /** Tier for tools nothing else classifies (the hook defaults to MEDIUM). */
  defaultRisk: RiskTierSchema.optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Domain adaptation config: the single file a team edits to tailor the starter
 * to their product (target domain, data source, tool allowlist, custom skills,
 * budgets, enabled modules and integrations).
 */
export const AgentStarterConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  targetDomain: z.string().min(3).max(300),
  primaryDatabase: z.string().max(200).default("Primary SaaS API"),
  modules: z.array(ModuleNameSchema).min(1),
  models: z
    .object({
      /** Flue model specifier, e.g. "openai/gpt-6.1-terra". */
      frontier: z.string().default("openai/gpt-6.1-terra"),
      reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
      /** Workers AI first line for routing, compaction, critique. */
      firstLine: z.string().default("cloudflare/@cf/meta/llama-3.1-8b-instruct"),
      /** Cheap model Flue uses for automatic context compaction. */
      compaction: z.string().default("cloudflare/@cf/openai/gpt-oss-20b"),
      fallbacks: z.array(z.string()).default(["openai/gpt-5.5", "cloudflare/@cf/moonshotai/kimi-k2.6"]),
      embedding: z.string().default("@cf/baai/bge-base-en-v1.5"),
      reranker: z.string().default("@cf/baai/bge-reranker-base"),
    })
    .default({
      frontier: "openai/gpt-6.1-terra",
      reasoningEffort: "medium",
      firstLine: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
      compaction: "cloudflare/@cf/openai/gpt-oss-20b",
      fallbacks: ["openai/gpt-5.5", "cloudflare/@cf/moonshotai/kimi-k2.6"],
      embedding: "@cf/baai/bge-base-en-v1.5",
      reranker: "@cf/baai/bge-reranker-base",
    }),
  budget: z.object({ hardCeilingUsd: z.number().positive().default(1.5), maxReasoningTurnsPerJob: z.number().int().positive().default(25) }).default({ hardCeilingUsd: 1.5, maxReasoningTurnsPerJob: 25 }),
  autonomy: z
    .object({ confidenceThreshold: z.number().min(0).max(1).default(0.85), maxAutonomousTier: RiskTierSchema.default("MEDIUM") })
    .default({ confidenceThreshold: 0.85, maxAutonomousTier: "MEDIUM" }),
  authorizedTools: z.array(z.string()).default([]),
  /** Runtime skills for your domain; the CLI scaffolds `src/skills/<kebab-name>/SKILL.md` stubs for them. */
  customSkills: z.array(z.object({ skillName: z.string().min(1).max(64), description: z.string().min(1).max(1024) })).default([]),
  /**
   * External MCP servers whose tools every agent mounts behind the firewall (`mcp__<name>__<tool>`).
   * Secrets never live here: `tokenSecret` names the Worker secret that holds the bearer token.
   */
  mcpServers: z.array(McpServerConfigSchema).default([]),
  integrations: z
    .object({
      composio: z.boolean().default(false),
      sendraven: z.boolean().default(false),
      boatdev: z.boolean().default(false),
      pusher: z.boolean().default(false),
      langfuse: z.boolean().default(false),
      firecrawl: z.boolean().default(false),
      jina: z.boolean().default(true),
      qdrant: z.boolean().default(false),
    })
    .default({ composio: false, sendraven: false, boatdev: false, pusher: false, langfuse: false, firecrawl: false, jina: true, qdrant: false }),
});
export type AgentStarterConfig = z.infer<typeof AgentStarterConfigSchema>;
export type AgentStarterConfigInput = z.input<typeof AgentStarterConfigSchema>;

export function defineAgentStarterConfig(config: AgentStarterConfigInput): AgentStarterConfig {
  return AgentStarterConfigSchema.parse(config);
}
