# Integrations as guarded tools

Every integration ends up as an `AgentToolDefinition`, so the `ToolExecutor` pipeline applies to all of them:
firewall, tenant checks, approvals, idempotency, untrusted-output wrapping and telemetry.

## Composio (`packages/integrations/src/composio.ts`)

What the toolset gives you:
- `createComposioClient({ apiKey, baseURL?, allowTracking? = false, disableVersionCheck? = true })` returns a client whose sessions hand back raw tools, which schema adaptation needs. Tracking and the npm version check are off, so the SDK makes no stray subrequests in Workers.
- `new ComposioToolset({ client, session?, firewall?, allowMetaTools? = false, promptInjectionHook?, riskOverrides?, userIdFor?, account?, timeoutMs?, maxOutputChars? })`. The options do the following:
  - `session` is forwarded to `composio.create(userId, config)`. It defaults to `sessionPreset: DIRECT_TOOLS`, so every real slug is visible to the firewall. Put Composio-native allow/deny here: `toolkits`, `tools: { github: { disable: [...] } }`, `tags`, `hooks`.
  - `firewall` accepts a `ToolFirewall` or a `ToolFirewallPolicy`. It is checked when listing tools **and** before every `session.execute()`.
  - `allowMetaTools: false` hides `COMPOSIO_*` meta tools such as multi-execute, which would run slugs the firewall never saw.
  - `promptInjectionHook: true` adds Composio's server-side `after_execute` prompt-injection check, which blocks a result.
  - `userIdFor` maps the tenant to the Composio user. The default is `${tenantId}:${userId}`. Tools are bound to that user, and executing them for a different tenant context throws `TenantIsolationError`.
- `classifyComposioTool(slug, tags)` assigns risk; the most dangerous verb wins:

  | Verb in the slug | Risk | Side effect |
  |---|---|---|
  | `DELETE`, `REMOVE`, `DESTROY` | `CRITICAL` | destructive |
  | `SEND`, `CREATE`, `POST`, `UPDATE` | `HIGH` | external |
  | `GET`, `LIST`, `SEARCH`, `FETCH` | `LOW` | read |
  | anything else | `MEDIUM` | external |

  `riskOverrides` can raise or lower a tier, but a destructive tool never drops below `MEDIUM`.
- `toolset.authorize(tenant, "gmail", { callbackUrl })` returns `{ url, connectionRequestId }`. Send the user to `url` to connect the account.
- Composio's `ComposioToolInputRequiredError` maps to `AgentError("APPROVAL_REQUIRED")`.

**In a Flue agent:** pass the toolset to `useAgentStarter`. Renders are synchronous and `toolset.tools()` is
async, so the hook calls `toolset.describeTools(tenant, tenantConfig)` in `useAgentStart`, keeps the JSON
descriptors in persistent state (`as:externalTools`, refreshed every `refreshMs`, default 10 min) and rebuilds
guarded tools on every render with `toolset.toolsFromDescriptors(descriptors, tenant)`. Every call then runs
through the hook's `ToolExecutor` (durable quotas, approvals for HIGH/CRITICAL slugs, budgets, audit).
```ts
// src/agents/assistant.ts — add COMPOSIO_API_KEY with `wrangler secret put` (already typed in src/env.ts)
import { ComposioToolset, createComposioClient } from "@agent-starter/integrations";
import { bindings, platform } from "../lib/platform.ts";

const composio = () => {
  const apiKey = bindings().COMPOSIO_API_KEY;
  return apiKey ? new ComposioToolset({ client: createComposioClient({ apiKey }), session: { toolkits: ["github"] }, firewall: { deny: ["*_DELETE_*"] }, promptInjectionHook: true }) : undefined;
};

const ctx = useAgentStarter({ ...platform("assistant", id), tools, composio: { toolset: composio } });
```
Tools appear from the second model call of a new conversation (after the first preload). Email toolkits
(`toolkit:gmail`, `outlook`, `sendgrid`, …) also need `TenantConfig.features.outboundEmail`.
Static wrappers (`defineAgentTool` whose `execute` calls `composio().execute(ctx.tenant, "SLUG", args, ctx.tenantConfig)`)
still work when you want a hand-written schema or description.

**In `AgentRuntime` (Node, evals, custom DOs):**
`const tools = await toolset.tools(tenant, tenantConfig)` gives you adapted, firewall-filtered tools. Pass
them in `new AgentRuntime({ ..., tools })`.

Verify with `pnpm --filter @agent-starter/integrations test` (`composio.test.ts`). It covers classification,
the firewall, meta-tool blocking and tenant binding.

## MCP: consuming remote servers (client) — `packages/flue/src/mcp-client.ts`
Never mount remote tools with Flue's raw `useMcpConnection`: those skip `ToolExecutor` (no firewall,
approvals, budget, idempotency or untrusted wrapping) and the security lock cannot unmount them. Use the
`mcp` option instead:
```ts
const ctx = useAgentStarter({
  ...platform("assistant", id),
  tools,
  mcp: [
    {
      name: "docs",                                   // tools mount as mcp__docs__<tool>
      url: "https://mcp.example.com/mcp",             // Streamable HTTP endpoint
      headers: () => ({ authorization: `Bearer ${bindings().DOCS_MCP_TOKEN ?? ""}` }), // resolved per tenant/user at connect
      tools: ["search_docs", "get_page", "delete_page"], // allowlist (exact names or globs)
      readOnly: ["search_*", "get_*"],                // LOW, read, idempotent
      risk: { "delete_*": "CRITICAL" },               // explicit tiers
      // trustAnnotations: true,                      // only for servers you control
    },
  ],
});
```
How risk is assigned (`assessMcpTool`): `destructiveHint` always → CRITICAL/destructive (a server can only
raise risk); then `readOnly` globs → LOW; then `risk` overrides; then, only with `trustAnnotations`,
`readOnlyHint` → LOW; otherwise `defaultRisk` (MEDIUM, external). Output is always `untrusted`. The hook lists
tools in `useAgentStart` (cached in `as:externalTools`, `refreshMs` default 10 min) and mounts them from the
next render; an unreachable server is logged and its tools stay unmounted. For `AgentRuntime` or scripts:
`await createMcpTools(server, tenant)`. `createMcpHttpClient({ url, headers, fetch?, timeoutMs? })` is the
fetch-only client; pass `client: (tenant) => myClient` for other transports or tests.

## MCP: exposing your tools (server)
`createToolMcpHandler` in `packages/cloudflare/src/mcp.ts` sits behind OAuth 2.1. Every `tools/call` goes
through `ToolExecutor`. See `agent-starter-security` → `references/oauth-mcp.md`.

## Codemode sandbox (`createCodeExecutionTool`, `packages/cloudflare/src/codemode.ts`)
- Model-written JavaScript runs in a throwaway Dynamic Worker isolate, configured with:
  - `globalOutbound: null`: no network;
  - no bindings or env;
  - a hard `timeoutMs` (default 30 000).
- The isolate can only call `codemode.<tool>(args)`. Each of those calls goes through a second `ToolExecutor` that you configure with `executor`.
- It needs the `worker_loaders` binding `LOADER`, which the coding module adds to `wrangler.jsonc`.
```ts
import { createCodeExecutionTool } from "@agent-starter/cloudflare";
import { type AnyAgentTool, ToolFirewall } from "@agent-starter/core";

const loader = bindings().LOADER;
const tools: AnyAgentTool[] = [lookupOrder];
if (loader) tools.push(createCodeExecutionTool({ loader, tools: [lookupOrder], timeoutMs: 30_000, executor: { firewall: new ToolFirewall({ maxTotalCalls: 50 }) } }));
```
Rules:
- Pass only read/none tools into `tools:`. `run_code` is declared `sideEffect: "none"`, so the outer executor retries it on transient errors. Inner calls get random ids, which means no idempotency or resumable approvals.
- Output is `untrusted`, and logs are captured.
- Escape eval: code that reads `process.env` or `fetch`es must fail. Add it to your adversarial dataset (`agent-starter-evals-and-ops`).

## Web reading and proxied headless fetching
- `createWebTools({ jina?: JinaReader, firecrawl?: FirecrawlClient })` provides `fetch_url_markdown`:
  - `LOW`, `read`, `idempotent`, `timeoutMs` 60 000, `maxOutputChars` 40 000;
  - output is `untrusted` and wrapped twice: by the reader, then by the executor;
  - every target passes `assertPublicHttpUrl`, which blocks credentials, localhost/intranet names, private/loopback/link-local/CGNAT/multicast IPv4 and IPv6, and v4-mapped/NAT64 addresses.
- `new JinaReader()` works without a key. Firecrawl needs `new FirecrawlClient({ apiKey })`: add `FIRECRAWL_API_KEY` to `src/env.ts` and store it with `wrangler secret put`.
- `createBrowsePageTool(new BrowserRenderingClient({ accountId, apiToken, cache }))` provides `browse_page`: Cloudflare Browser Rendering returns rendered markdown. It needs `CF_ACCOUNT_ID` and `CF_API_TOKEN`. The KV cache avoids paying twice for the same URL. Its SSRF guard is `assertPublicUrl` in `browser.ts`, a weaker regex than `assertPublicHttpUrl`.
- Use boat.dev VMs only for interactive, multi-step browsing (`agent-starter-computer-use`).
```ts
import { BrowserRenderingClient, createBrowsePageTool, KVStore } from "@agent-starter/cloudflare";
import { createWebTools, JinaReader } from "@agent-starter/integrations";

const b = bindings();
const tools = [...createWebTools({ jina: new JinaReader() })];
if (b.CF_ACCOUNT_ID && b.CF_API_TOKEN) tools.push(createBrowsePageTool(new BrowserRenderingClient({ accountId: b.CF_ACCOUNT_ID, apiToken: b.CF_API_TOKEN, cache: new KVStore(b.AGENT_CACHE) })));
```

## Tool masking (large tool sets)
- `maskTools(tools, query, { maxTools = 8, alwaysInclude })`: keyword scoring, zero cost. `alwaysInclude` tools are kept on top of the `maxTools` best others.
- `selectRelevantTools(tools, task, { provider, maxTools = 6, alwaysInclude })`: a first-line model picks up to `maxTools` tools (plus `alwaysInclude`), falling back to keyword scoring.

`useAgentStarter` masks to `toolMasking.maxTools` (default 4) per delivered message, with the built-ins, `halt_job`,
`ask_person` and `always-mounted` tools on top (see SKILL.md). `AgentRuntime` masks to 16 tools per turn. Split
large tool sets across specialists (`agent-starter-multi-agent`).
