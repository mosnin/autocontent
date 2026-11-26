---
name: agent-starter-scaffold
description: Create Agent Starter projects with the create-agent-starter CLI (run from a checkout), choose modules (chat, widget, in-app, background, multi-agent, computer-use, coding, voice, persistent), add or remove agents and modules in an existing project, custom skills and MCP servers in agent-starter.config.ts, and keep wrangler.jsonc bindings, project-scoped resource names and Durable Object migrations correct. Use when scaffolding a new agent backend, adding a new agent or module, renaming agents, or editing wrangler.jsonc / src/app.ts / src/cloudflare.ts / src/agents.generated.ts / the infra script.
---

# Scaffolding and wiring

## When to use
- Starting a project, or deciding which modules a product needs.
- Adding, renaming or removing an agent, a queue consumer, a cron job or a Durable Object.
- Anything that edits `wrangler.jsonc`, `src/app.ts`, `src/cloudflare.ts`, `src/agents.generated.ts`, `agent-starter.config.ts` or `scripts/init-cloudflare-infra.sh`.

## 1. Pick modules

| Module | Title | Use when the product needs… | Agents (identity · mount) | Extra infra |
|---|---|---|---|---|
| `chat` | Agent chat | A ChatGPT-class assistant page | `Assistant` (`assistant` · `/agents/assistant`) | `userId` metadata index on the memory index |
| `widget` | Support chat widget | An embeddable customer-support bubble on a public site | `SupportAgent` (`support-agent` · `/agents/support-agent`, the only mount that accepts widget visitor tokens) | `WIDGET_KEYS` KV (`widget:<key>` + `origin:<origin>` index), `pnpm build:widget` IIFE bundle |
| `in-app` | In-app copilot | A sidebar copilot that sees the current page and acts through your SaaS API; also exposes an OAuth 2.1 MCP server | `Copilot` (`copilot` · `/agents/copilot`) | `OAUTH_KV`, `SAAS_SERVICE_TOKEN` |
| `background` | Background jobs | Agents that run on events/schedules with no chat | `BackgroundWorker` (`background-worker` · `/agents/background-worker`, operators only) | `<name>-events` queue + `<name>-events-dlq` (DLQ consumer, `pnpm dlq:replay`), daily report cron |
| `multi-agent` | Multi-agent collaboration | Grok-style teams: an orchestrator plus specialists in a group-chat room | `Orchestrator` (`/agents/orchestrator`), `AnalystAgent`, `WriterAgent`, `SecurityAuditorAgent` (dispatch-only) | `SwarmRoom` DO, `<name>-bus` queue + DLQ |
| `computer-use` | Computer use (boat.dev VMs) | Agents that operate a browser/desktop in a VM | `ComputerOperator` (`computer-operator` · `/agents/computer-operator`) | `BOAT_DEV_API_KEY`, golden snapshot |
| `coding` | Coding agent | A Cursor-class agent that edits, tests and ships code in a VM | `Coder` (`coder` · `/agents/coder`) | VM provider (boat.dev), `worker_loaders` |
| `voice` | Voice (LiveKit) | Voice calls with an agent in the browser or an embeddable widget | `VoiceAssistant` (`voice-assistant` · `/agents/voice-assistant`); calls go to `Assistant` first when `chat` is present (`VOICE_AGENTS`) | `VOICE_SESSIONS` DO, LiveKit Cloud project, `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`VOICE_AGENT_SECRET`, `voice-agent/` deployed with `lk agent create` |
| `persistent` | Persistent agents | Always-on agents that wake on a heartbeat or schedule and act without a prompt, under a trusted control plane | `PersistentAgent` (`persistent-agent`, no HTTP mount: only the control plane dispatches it) | `PERSISTENT_CONTROL` DO, `PERSISTENT_EGRESS_ALLOW`/`PERSISTENT_EGRESS_DENY`/`PERSISTENT_REVIEW_MODEL` vars, `PERSISTENT_ASSERTION_SECRET`; routes under `/api/persistent/:agentId` |

Every project also gets the **base** platform:
- tenant-config cache with the `agent-starter.config.ts` policy applied (models, budget ceilings, autonomy, `authorizedTools`, `mcpServers`, `integrations`), retrieval, approvals and telemetry (signed webhooks, Pusher, Langfuse / OTLP when configured);
- the `AgentRunRegistry` DO plus a heartbeat sentinel cron (`* * * * *`) with recovery hooks (`src/lib/recovery.ts`) and a submission ledger (`src/lib/submissions.ts`);
- the dev tenant seed (`scripts/seed-dev-tenant.mjs`, `pnpm seed:dev`), AI Gateway, residency and alert vars (`CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_CACHE_TTL`, `DO_JURISDICTION`, `DO_LOCATION_HINT`, `OPS_ALERT_EMAIL`, `OTLP_TRACES_ENDPOINT`);
- the eval harness + Promptfoo suites (`evals/`), ESLint (`pnpm lint`), CI workflow (typecheck, web typecheck, lint, prod dependency audit, coverage, evals before deploy), infra/deploy scripts, the default test suite and these skills.

Valid combinations include a single module, any subset, or `--all`. For example, `--modules background` gives a headless agent backend with no chat UI.

## 2. Create a project

The CLI is **not published to npm yet**: run it from an agent-starter checkout (Node ≥ 22.19 runs its TypeScript source directly).

```bash
git clone <agent-starter repo> && cd agent-starter && pnpm install
node packages/create-agent-starter/bin/create-agent-starter.mjs my-agents --modules chat,background --domain "Billing assistant for Acme" --dir ../my-agents
pnpm run create my-agents --all --yes --dir ../my-agents      # same thing via the root script
```

Do not use `npx create-agent-starter` (the npm name is unclaimed) or `pnpm create my-agents` (pnpm's built-in `create` fetches `create-my-agents` from npm).

| Flag | Meaning |
|---|---|
| `--modules a,b` / `-m` | Modules to include (their `requires` are added). If omitted in a TTY you are prompted. |
| `--all` | Every module. |
| `--deps vendor` (default) | Copies `@agent-starter/*` source into `./vendor/agent-starter/*` (and `voice-agent/vendor/agent-starter/*`) with `file:` links. The project is self-contained. |
| `--deps link` | Links to this checkout (`link:` for the Worker, `file:` for `voice-agent/`, which uses npm). Framework development. |
| `--deps npm` | Uses the published `@agent-starter/*` packages (`^0.1.0`, not published yet). |
| `--deps workspace` | `workspace:*` (and relative `file:` links for `voice-agent/`), only for examples inside the monorepo (that is how `examples/full` is built). |
| `--domain "…"` | One-line description written to `agent-starter.config.ts`. |
| `--skill "Name=description"` | A custom domain skill (repeatable): added to `customSkills` and scaffolded as `src/skills/<kebab-name>/SKILL.md`. |
| `--dir path` | Target directory (default: `./<name>`). It must be empty or not exist. |
| `--yes` / `-y` | Non-interactive. |

The name must be kebab-case. Composition is **atomic**: everything is written to a staging directory next to the target and moved into place only when every step (including vendoring) succeeded, so a failed run leaves nothing behind and a retry into the same directory works.

Then, in the new project:
```bash
pnpm install                          # commit pnpm-lock.yaml (the generated CI uses pnpm and its cache)
cp .dev.vars.example .dev.vars        # fill OPENAI_API_KEY, SESSION/APPROVAL/WEBHOOK signing secrets…
pnpm seed:dev --token                 # LOCAL dev tenant with generous limits + a dev session token (see below)
AGENT_STARTER_LOCAL_ONLY=1 pnpm dev   # local bindings only, no Cloudflare credentials needed
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm infra:init                       # creates KV/R2/Vectorize(+tenantId index)/queues, prompts for secrets; re-runnable
# paste the printed KV namespace ids over REPLACE_WITH_*_KV_ID in wrangler.jsonc (npx wrangler kv namespace list)
pnpm run deploy                       # refuses placeholders → typecheck → test → build → wrangler deploy → canary
```

**Do not skip `pnpm seed:dev`.** A tenant without stored config gets the secure freemium defaults (5 turns,
$0.15, every feature flag off), so an unseeded app stops chatting after a few replies and VM/code tools refuse.
The script writes a generous `TenantConfig` for `dev_tenant` into the **local** `TENANT_CONFIG` KV and, with
`--token`, prints a 12 h session token for `dev_user` (roles `admin,operator`). Options: `--tenant`, `--user`,
`--roles`, `--email`, `--print`. It refuses `--remote`; production tenants are configured by your SaaS via the
signed `PUT /internal/tenants/:tenantId/config`. The `budget` ceilings in `agent-starter.config.ts` still apply.

**Resource names are project-scoped.** Queue, R2 bucket and Vectorize index names are global per Cloudflare
account, so the generator prefixes them with the project name (`<name>-workspaces`, `<name>-memory`,
`<name>-events`, `<name>-bus`, …) in `wrangler.jsonc`, the queue-name vars, the infra script, the CI R2 path and the
README. Two projects in one account never share a memory index or a workspace bucket. Every `npx wrangler … create`
line in the infra script ends in `|| echo …`, so re-running it after a partial failure skips what exists.

### What the generator writes
- `templates/base/files/**` plus each selected `templates/modules/<m>/files/**` are copied verbatim. A `_dot_` prefix becomes `.`; `{{name}}` and `__FIRST_AGENT__` are filled in `README.md` and the CI workflow, and `<!-- if:<module>[,<module>] -->…<!-- endif -->` blocks in them are kept only when one of those modules is composed (`moduleBlocks()`; the README's "Background jobs" section uses it).
- These files are **generated** from the module manifests (`packages/create-agent-starter/src/compose.ts`). Manifest strings may use `{{name}}`, and the queue/bucket/index names a manifest's `wrangler` fragment declares are renamed to project-scoped names automatically (`resourceRenames()` / `applyRenames()`):
  - `package.json`: dependencies, overrides pinning pi-ai/pi-agent-core `1.4.0` and the patched `@modelcontextprotocol/client` `2.3.1` (Flue 2.3.0 pulls a vulnerable 2.0.0), devDependencies (incl. `promptfoo`, `@vitest/coverage-v8`, ESLint), scripts (`dev`, `build`, `deploy`, `typecheck`, `lint`, `test`, `test:coverage`, `evals`, `evals:view`, `seed:dev`, `infra:init`, `cf-typegen`), plus `typecheck:web` with the React package, `dlq:replay` with background and `build:widget` with widget;
  - `wrangler.jsonc`: merged module fragments, project-scoped resource names, vars, crons, DO bindings, migration `v1`;
  - `src/app.ts`: `registerExtendedModels(modelGateway())` + the observer at module top level; CORS (`agentCors(WIDGET_PATHS)`: credentials only for `ALLOWED_ORIGINS`, registered widget sites on widget routes without credentials); the auth-wrapped mounts (see §3 for the exact line: rate limits, edge `classify`, cookie-CSRF `trustedOrigins`, `seedInitialData`, `appContextFromRequest` for in-app agents, `allowVisitors: true` on the widget agent's mount and conversation API only); approval routes with `sessionSecret`; tenant sync verified with `signingSecret(env, "tenantSync")` (`TENANT_SYNC_SECRET`, else `WEBHOOK_SIGNING_SECRET`); `integrationRoutes` (Composio account connections); `artifactRoutes` (signed artifact downloads, `GET /artifacts/:tenantId/*`); `pusherAuthRoutes` (`POST /api/pusher/auth`, 404 until Pusher is configured); the eval harness; module routes. `classifyDelivery` is imported from `src/lib/platform.ts` (the events queue uses the same classifier);
  - `promptfoo.config.yaml`: the default eval agent (first HTTP agent) and the default cost / turn caps (`DEFAULT_BUDGET`, the same ceilings written to the config: 1.5 / 25) filled in; `evals/module-<m>.yaml` kept only for selected modules;
  - `src/cloudflare.ts`: DO exports plus the queue/cron switch;
  - `src/agents.generated.ts`: an identity → agent map;
  - `scripts/init-cloudflare-infra.sh` (re-runnable; tenantId/documentId/userId metadata indexes; module lines the base already runs are not repeated; optional per-purpose secrets and AI Search steps; KV-id paste reminder), `.dev.vars.example`, `agent-starter.config.ts` (`budget` from `DEFAULT_BUDGET`, `customSkills`, `mcpServers: []`, `integrations` from `defaultIntegrations(modules)`: a provider runs only when its flag is true AND its key is set; key-gated providers start on, `composio` and `qdrant` off, `boatdev` on with computer-use or coding), `AGENTS.md`;
  - `src/skills/<kebab-name>/SKILL.md` stubs for `--skill` entries, and `src/skills/custom.generated.ts` (always; static imports of every stub as `CUSTOM_SKILLS`, mounted in each agent by `useCustomSkills()` from `src/lib/custom-skills.ts`, which also adds the `targetDomain` / `primaryDatabase` line);
  - `src/lib/bus.generated.ts` (always): with multi-agent it re-exports `busTools` from `src/multi-agent/bus.ts`, otherwise a stub returning no tools, so the background worker can call `busTools("background-worker", id)` in every combination;
  - `voice-agent/package.json` rewritten per deps mode (its `@agent-starter/*` devDependencies), plus `voice-agent/vendor/` (always present so the Dockerfile can copy it);
  - `.agents/skills` and `.claude/skills`.
- `vitest.config.ts` stubs `cloudflare:workers` / `cloudflare:email` and loads `SKILL.md` imports with Flue's markdown plugin, so Node tests can import routes and queue handlers (background projects get `test/ingestion.e2e.test.ts`: signed event → 202 → queue consumer → dispatch).
- All generated files say "safe to edit". After generation **you own them**. There is no regeneration step, so later changes are manual edits following the rules below.

## 3. Add an agent to an existing project

1. **Write the agent.** Create `src/agents/<file>.ts` with `"use agent"` as the first statement. Export a synchronous, Capitalized function, e.g. `export function InvoiceAgent({ id }: AgentProps)`:
   - Call `useAgentStarter({ ...platform("invoice-agent", id), tools: [...] })` first.
   - Then `useSkill(...)` any runtime skills.
   - Return the instructions string.
   - Identity resolves from the binding stamp, then `Fn.agentName`, then the function name. It must match `^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$`. Keep the kebab-case identity identical everywhere below.
2. **Register it** in `src/agents.generated.ts`: add `"invoice-agent": InvoiceAgent`. The heartbeat sentinel and the eval harness resolve agents through this map. Also add it to the `agents: [...]` list passed to `createApprovalRoutes` in `src/app.ts`, otherwise approval links for it 404.
3. **Mount it (only if it has an HTTP surface).** Copy the generated mount line exactly (this is what `compose.ts` writes):
   ```ts
   app.use("/agents/invoice-agent/*", agentAuth({ secret: sessionSecrets, agentName: "invoice-agent", mount: "/agents/invoice-agent", rateLimiter: chatRateLimiter, tenantConfig: tenantRateLimit, classify: classifyDelivery, trustedOrigins, extraInitialData: (_c, claims) => seedInitialData(claims) }));
   app.route("/agents/invoice-agent", createAgentRouter(InvoiceAgent));
   app.route("/api/invoice-agent", createConversationRoute({ agentName: "invoice-agent", secret: sessionSecrets }));
   ```
   - The `agentAuth` must come **before** the router. `createAgentRouter` has no auth.
   - `rateLimiter` + `tenantConfig` give per-tenant chat 429s; `extraInitialData: seedInitialData` makes the first reply use the tenant's stored config instead of the freemium defaults.
   - `classify: classifyDelivery` stamps the trusted `route` attribute (edge routing); `trustedOrigins` lets cookie-authenticated POSTs come only from `ALLOWED_ORIGINS`.
   - Operator-only agents add `adminRoles: ["admin", "operator"]` after `mount`.
   - A page-aware copilot uses `extraInitialData: async (c, claims) => ({ ...(await seedInitialData(claims)), ...appContextFromRequest(c) })`.
   - Only a widget-facing agent adds `allowVisitors: true` (on both `agentAuth` and `createConversationRoute`); every other mount must reject visitor tokens.
   - Dispatch-only agents, such as specialists or workers that a queue triggers, are not mounted.
4. **Add a migration.** Append a **new** entry to `wrangler.jsonc` and never edit an existing tag:
   ```jsonc
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["FlueAssistantAgent", "AgentRunRegistry"] },
     { "tag": "v2", "new_sqlite_classes": ["FlueInvoiceAgentAgent"] }
   ]
   ```
   - The class name is `Flue` + PascalCase(identity) + `Agent`, which is `flueClassName()` in `compose.ts`. So `support-agent` becomes `FlueSupportAgentAgent`, and the doubled "Agent" is correct.
   - Flue adds the Durable Object **binding** automatically through `flueWorkerConfig()` in `vite.config.ts`. You only add the migration.
5. **Test it.** Add a test under `test/` using the faux-provider pattern in `test/harness.test.ts`, and add eval cases (with `vars.agent: invoice-agent` and a first-tool assertion) in a new `evals/<name>.yaml`; Promptfoo loads `evals/*.yaml`.
6. **Verify:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Then run `AGENT_STARTER_LOCAL_ONLY=1 pnpm dev`, mint a conversation with `POST /api/invoice-agent/conversations` and talk to it.

### Rename or remove an agent
A rename changes the identity and therefore the Durable Object class, and existing conversations live in the old class. To rename:
1. Add the new class in a new migration.
2. Leave the old class running until its conversations drain.
3. Then add a migration with `"deleted_classes": ["FlueOldAgent"]`.

Never reuse a deleted class name.

## 4. Add a queue consumer, cron, Durable Object, skill or MCP server by hand

| Thing | Steps |
|---|---|
| Queue consumer | 1. Add `queues.producers` + `queues.consumers` (with `max_retries` and `dead_letter_queue`) to `wrangler.jsonc`, named `<project>-<queue>`.<br>2. Add a var holding the queue name, e.g. `MY_QUEUE_NAME`.<br>3. Add a `case env.MY_QUEUE_NAME:` branch in `src/cloudflare.ts` `queue()`.<br>4. Add `npx wrangler queues create … \|\| echo "exists"` lines (queue + DLQ) to the infra script. |
| Cron | 1. Append the expression to `triggers.crons`.<br>2. Add an `if (controller.cron === "…")` branch in `scheduled()`. Cron strings must match exactly. |
| Custom DO | 1. Export the class from `src/cloudflare.ts`.<br>2. Add `durable_objects.bindings` `{ name, class_name }`.<br>3. Add it to a **new** migration's `new_sqlite_classes`. |
| KV / R2 / Vectorize | 1. Add the binding to `wrangler.jsonc` (R2/Vectorize names prefixed with the project name).<br>2. Add its type to `src/env.ts`.<br>3. Add the create command to `scripts/init-cloudflare-infra.sh`.<br>For Vectorize, also create a `tenantId` metadata index. |
| Secret | 1. Add it to `.dev.vars.example` and `src/env.ts`.<br>2. Add `npx wrangler secret put NAME` to the infra script.<br>3. Read it with `bindings().NAME` at use time. |
| Custom runtime skill | 1. Add `{ skillName, description }` to `customSkills` in `agent-starter.config.ts`.<br>2. Create `src/skills/<kebab-name>/SKILL.md` (frontmatter `name` = directory, `description` ≤ 1024 chars; the CLI's `--skill` writes this stub).<br>3. Add `import xSkill from "./<kebab-name>/SKILL.md";` and the entry to `CUSTOM_SKILLS` in `src/skills/custom.generated.ts`: every agent that calls `useCustomSkills()` mounts it. (A skill for one agent only: `useSkill(x)` in that agent instead.) |
| External MCP server | 1. Add `{ name, url, tokenSecret?, tools?, readOnly?, risk?, defaultRisk?, timeoutMs? }` to `mcpServers` in `agent-starter.config.ts` (`McpServerConfigSchema` in `packages/core/src/config.ts`: https only; `tokenSecret` is the NAME of a Worker secret).<br>2. `npx wrangler secret put <tokenSecret>` (and `.dev.vars`).<br>3. Every agent mounts its tools as `mcp__<name>__<tool>` behind the firewall (`platform.ts`). |

## 5. Add a module to an existing project
There is no in-place "add module" command. Use the reference output as a diff source:
1. In a temp directory, generate the same project name with the old modules plus the new one.
2. Copy the new module's files (`src/<module>/`, `src/agents/<agent>.ts`, `src/skills/<skill>/`, `web/*`, `test/*`, `evals/module-<m>.yaml`).
3. Hand-merge the generated deltas in `wrangler.jsonc`, `src/app.ts`, `src/cloudflare.ts`, `src/agents.generated.ts`, `package.json`, `.dev.vars.example` and the infra script.
4. Turn the new module's classes into a **new** migration tag. Do not reuse `v1` from the temp project.
5. Run the full gate set. Re-run `pnpm infra:init` (it skips existing resources) or only the new module's lines.

## 6. Framework development (inside the agent-starter monorepo)
- The packages live in `packages/*`, and templates in `packages/create-agent-starter/templates/{base,modules/<m>}`. Each module has a `module.json` manifest; its `ModuleManifest` type is in `compose.ts` and covers agents (`mount`, `auth`, `appContext`, `visitors`), durableObjects, routes, queueConsumers, scheduled, wrangler, vars, secrets, infra, packages, dependencies and skills.
- Builder skills (these files) live in `skills/` at the repo root. The CLI copies them into every generated project.
- To regenerate the reference app (the target must be empty; compose is atomic):
  ```bash
  cp examples/full/.dev.vars /tmp/full.dev.vars 2>/dev/null; rm -rf examples/full
  node packages/create-agent-starter/bin/create-agent-starter.mjs full-stack-agents --all --deps workspace --dir examples/full --yes
  cp /tmp/full.dev.vars examples/full/.dev.vars 2>/dev/null; pnpm install
  pnpm --filter full-stack-agents typecheck && pnpm --filter full-stack-agents test && pnpm --filter full-stack-agents build
  ```
- Root CI (`.github/workflows/ci.yml`, job "Generated projects") fails when `examples/full` differs from a fresh compose, when any module composed alone fails `tsc` / `tsc -p web/tsconfig.json` / `eslint`, or when `voice-agent/` does not install, typecheck and build.
- Packaging: `pnpm pack` in `packages/create-agent-starter` runs `prepack` (`pnpm run build` → `dist/` compiled JS, then `node src/pack.ts bundle` → `skills/` + `bundled/packages/<pkg>`), and `postpack` cleans them. Under `node_modules` the bin runs `dist/cli.js` (a checkout always runs `src/`), and `defaultRepoRoot()` / `skillsDir()` prefer the bundled copies, so an installed CLI works outside the monorepo with the default `--deps vendor`.
- The CLI tests in `packages/create-agent-starter/test/` compose every module alone and in combinations and check that agents, migrations, bindings, crons, consumers, resource names, scripts and docs line up.

## Checklist
- [ ] The identity, `agentName` passed to `platform()` / `agentAuth` / `createConversationRoute`, `agents.generated.ts` key and migration class all agree. Verify by grepping the identity across `src/` and `wrangler.jsonc`.
- [ ] Every mounted agent has `agentAuth` (with `rateLimiter`, `tenantConfig`, `classify`, `trustedOrigins`, `extraInitialData`) registered before `createAgentRouter`. Verify: `project-ops.test.ts` › "classifies every mounted agent's deliveries with the Workers AI utility model".
- [ ] Only the widget agent accepts visitor tokens. Verify: `project-ops.test.ts` › "accepts visitor tokens only on the widget agent's mount and conversation API".
- [ ] New classes appear only in a **new** migration tag. Verify: the diff of `wrangler.jsonc` shows no edits to existing tags.
- [ ] Every queue has a DLQ and `max_retries`, and every queue name var matches a `case` in `src/cloudflare.ts`.
- [ ] Queue, bucket and index names carry the project name and the infra script re-runs cleanly. Verify: `project-ops.test.ts` › "prefixes every queue, bucket and index with the project name and keeps vars, infra, CI and README in sync" and "re-runs the generated create lines after a resource already exists".
- [ ] Every cron string in `triggers.crons` has an exact-match branch in `scheduled()`.
- [ ] Every new binding is in `src/env.ts`, `wrangler.jsonc` and the infra script. Every new secret is in `.dev.vars.example` and the infra script.
- [ ] `package.json` still has `overrides` and `pnpm.overrides` pinning `@earendil-works/pi-ai` and `pi-agent-core` to `1.4.0` and `@modelcontextprotocol/client` to `2.3.1`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass (`pnpm test:coverage` for coverage).
- [ ] A fresh clone works locally after `pnpm seed:dev --token` (chat continues past 5 replies). Verify: `compose.test.ts` › "ships the dev tenant seed, wires it into scripts, docs and next steps".
- [ ] The quick start runs in a working order (seed before dev, KV ids pasted before deploy). Verify: `project-ops.test.ts` › "prints the steps in a working order: install, secrets, seed, local dev, infra, paste KV ids, deploy" and "stops deploy.sh before any build when KV ids are still placeholders".
- [ ] Custom skills from `--skill` / `customSkills` have valid stubs that every agent mounts (`custom.generated.ts` + `useCustomSkills()`), and the config passes the core schema. Verify: `project-ops.test.ts` › "writes customSkills to the config and scaffolds a valid runtime SKILL.md per skill" and "generates a config the core schema accepts, including mcpServers"; `grep -n "useCustomSkills()" src/agents/*.ts`.
- [ ] Generated links and switches are coherent: the bus link matches the composed modules, README module blocks are resolved, and the integration flags match the modules. Verify: `compose.test.ts` › "generates the message bus link: the multi-agent bus when composed, a no-op otherwise", "documents background-only features only in projects that have the background module", "writes integration switches that a provider needs on top of its key"; `project-ops.test.ts` › "leaves no template placeholder in any generated file".
- [ ] `PUBLIC_BASE_URL` is the deployed origin before the first deploy. Verify: `project-ops.test.ts` › "refuses a localhost or placeholder PUBLIC_BASE_URL before deploying, and accepts a public one (R-OPS-13)".
- [ ] `voice-agent/` installs in every deps mode and its secrets file is gitignored. Verify: `project-ops.test.ts` › "vendors core + livekit inside voice-agent/ for the Docker / LiveKit Cloud build context" and "gitignores voice-agent/env.voice (it holds VOICE_AGENT_SECRET and LiveKit keys)".
- [ ] A failed compose leaves nothing behind. Verify: `project-ops.test.ts` › "leaves nothing behind when vendoring fails, so a retry into the same directory works".
- [ ] The packed CLI runs from `node_modules`. Verify: `project-ops.test.ts` › "runs from node_modules with the compiled build, bundled sources and skills (default --deps vendor)".
- [ ] New modules' eval suites live in `templates/base/files/evals/module-<m>.yaml` (pruned per project) and target only that module's agents. Verify: `project-ops.test.ts` › "ships a suite for every module whose cases only target that module's agents".

## Pitfalls
- `npx create-agent-starter` / `pnpm create <name>`: neither runs this CLI today (unpublished; pnpm's `create` downloads `create-<name>`). Run the bin from a checkout.
- Hardcoding account-global names (`agent-events`, `my-bucket`) in a template or by hand: a second project in the same account then shares the queue or bucket, and tenants of both apps share memories.
- Running `pnpm run deploy` before pasting the KV ids, or with `PUBLIC_BASE_URL` still `http://localhost:5173`: `scripts/canary.sh preflight` (first step of `deploy.sh` and of the CI deploy job) stops early and says which one.
- Turning an `integrations` flag off in `agent-starter.config.ts` disables that provider even when its secret is set (SendRaven email, Pusher, Langfuse, Jina / Firecrawl, boat.dev, Composio, Qdrant).
- Forgetting the approval-routes list. The tool parks for approval, but the link returns `AGENT_NOT_FOUND`.
- Async agent functions. Flue throws `Agent functions must be synchronous`; do async work in hooks or tools.
- Reading `env` at module scope in agents or `src/lib/*`. Bindings are only available at request time, so use `bindings()`. The one deliberate exception is `registerExtendedModels(modelGateway())` at the top of `src/app.ts`: it must run at module scope, reads only plain vars, and falls back to direct OpenAI on any error.
- Removing `registerExtendedModels(...)` from the top of `src/app.ts`: `openai/gpt-6.1-terra` then fails with "Unknown model ID".
- Copying a module from a temp project including its `v1` migration. That re-declares existing classes and the deploy fails.
- Putting an MCP token in `agent-starter.config.ts`: the schema only accepts a secret NAME (`tokenSecret`); the value lives in `wrangler secret`.

## Related skills
`agent-starter` (architecture) · `agent-starter-security` (auth on mounts) · `agent-starter-background-jobs` (consumers, crons) · `agent-starter-evals-and-ops` (CI, lint, evals) · `agent-starter-definition-of-done`.
