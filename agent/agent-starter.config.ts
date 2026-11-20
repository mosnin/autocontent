import { defineAgentStarterConfig } from "@agent-starter/core";

/**
 * Domain adaptation: edit this file to tailor the starter to your product.
 * src/lib/platform.ts applies it to every agent:
 *  - models: primary/fallback/first-line/compaction models and reasoning effort
 *    (the AGENT_MODEL / AGENT_FALLBACK_MODELS / FIRST_LINE_MODEL vars override per deployment);
 *  - budget: hard ceilings per conversation/job (a tenant can be configured lower, never higher);
 *  - autonomy: default confidence threshold and highest autonomous risk tier;
 *  - authorizedTools: when non-empty, the only tools (names or globs) any agent may run,
 *    besides the built-in planning/workflow/memory tools;
 *  - targetDomain / primaryDatabase: one instruction line every agent gets (useCustomSkills, src/lib/custom-skills.ts);
 *  - customSkills: your domain skills; each has a runtime skill in src/skills/<kebab-name>/SKILL.md, listed in
 *    src/skills/custom.generated.ts and mounted in every agent by useCustomSkills()
 *    (create-agent-starter --skill "Name=description" scaffolds both);
 *  - mcpServers: external MCP servers whose tools every agent mounts behind the firewall
 *    (tokenSecret = the NAME of a Worker secret holding the bearer token, never the token);
 *  - integrations: optional providers, each active only when its flag is true AND its key is set
 *    (sendraven: SENDRAVEN_API_KEY, pusher: PUSHER_*, langfuse: LANGFUSE_*, jina / firecrawl: web tools,
 *    boatdev: BOAT_DEV_API_KEY, composio: COMPOSIO_API_KEY, qdrant: QDRANT_URL replaces Vectorize memory).
 * Per-tenant limits and feature flags live in the TENANT_CONFIG KV namespace (synced from
 * your SaaS via /internal/tenants/:id/config; locally: pnpm seed:dev).
 */
export default defineAgentStarterConfig({
  name: "marketer-agents",
  targetDomain: "Marketer: an AI marketing department (strategy, short-form content, SEO articles, paid ads, distribution, analytics) that plans, makes, distributes and measures marketing for people and for other AI agents",
  primaryDatabase: "the Marketer REST API (/api/v1: workspace, playbooks, videos, carousels, articles, campaigns, calendar, ads, spend, metrics) reached with the agent service token as the signed-in account",
  modules: ["chat","in-app","background","multi-agent","persistent"],
  models: {
    frontier: "openai/gpt-6.1-terra",
    reasoningEffort: "medium",
    firstLine: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
    compaction: "cloudflare/@cf/openai/gpt-oss-20b",
    fallbacks: ["openai/gpt-5.5", "cloudflare/@cf/moonshotai/kimi-k2.6"],
    embedding: "@cf/baai/bge-base-en-v1.5",
    reranker: "@cf/baai/bge-reranker-base",
  },
  budget: { hardCeilingUsd: 1.5, maxReasoningTurnsPerJob: 25 },
  autonomy: { confidenceThreshold: 0.85, maxAutonomousTier: "MEDIUM" },
  authorizedTools: [],
  customSkills: [
    // src/skills/marketing-operating-procedure/SKILL.md
    { skillName: "marketing-operating-procedure", description: "How Marketer plans, makes, distributes and measures marketing work, which department owns what, how to report numbers, and when it must ask a person" },
    // src/skills/paid-media-safety/SKILL.md
    { skillName: "paid-media-safety", description: "Rules for spending real ad money: fail closed, never exceed caps, always a person's approval, small reversible changes, spend reported in dollars" },
  ],
  // e.g. { name: "linear", url: "https://mcp.linear.app/mcp", tokenSecret: "LINEAR_MCP_TOKEN", readOnly: ["list_*", "get_*"] }
  mcpServers: [],
  // A provider runs only when its flag is true AND its key is set (false turns it off even with a key).
  integrations: { composio: false, sendraven: true, boatdev: false, pusher: true, langfuse: true, firecrawl: true, jina: true, qdrant: false },
});
