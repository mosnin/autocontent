# Planning and cognition recipes

## 1. A custom FSM workflow with a context-guarded transition
```ts
// src/agents/onboarding.ts
"use agent";
import { type AnyAgentTool, defineAgentTool, type MachineDefinition, StateMachine } from "@agent-starter/core";
import { resolveSql, useAgentStarter } from "@agent-starter/flue";
import type { AgentProps } from "@flue/runtime";
import * as v from "valibot";
import { platform } from "../lib/platform.ts";

type Stage = "COLLECT" | "VERIFY" | "PROVISION" | "DONE" | "FAILED";

export const ONBOARDING: MachineDefinition<Stage, Record<string, unknown>> = {
  id: "onboarding", // never rename once live: state rows are keyed by `${id}:${conversationId}`
  initial: "COLLECT",
  states: {
    COLLECT: { instructions: "Gather the account details you need. Do not change anything.", tools: ["get_account"], transitions: { VERIFY: true, FAILED: true } },
    VERIFY: { instructions: "Run the KYC check. Move on only if it passed.", tools: ["get_account", "check_kyc"], transitions: { PROVISION: (ctx) => ctx.kycPassed === true, FAILED: true } },
    PROVISION: { instructions: "Create the workspace, then finish.", tools: ["create_workspace"], transitions: { DONE: true, FAILED: true } },
    DONE: { instructions: "Onboarding is complete. Do nothing further.", tools: [], transitions: {}, terminal: true },
    FAILED: { instructions: "Explain what blocked onboarding.", tools: [], transitions: {}, terminal: true },
  },
};

// transition_state never patches context, so tools that establish facts must do it themselves.
const checkKyc = defineAgentTool({
  name: "check_kyc",
  description: "Run the KYC check for the account and record the result in the workflow.",
  input: v.object({ accountId: v.string() }),
  risk: "LOW",
  sideEffect: "read",
  execute: async ({ accountId }, ctx) => {
    const passed = accountId.length > 0; // call your KYC provider here
    new StateMachine(ONBOARDING, { instanceId: ctx.runId, sql: resolveSql(), initialContext: {} }).patchContext({ kycPassed: passed });
    return { passed };
  },
});

export function OnboardingAgent({ id }: AgentProps) {
  const tools: AnyAgentTool[] = [checkKyc /*, getAccount, createWorkspace */];
  useAgentStarter({ ...platform("onboarding-agent", id), tools, workflow: ONBOARDING, planning: true });
  return "You onboard new business accounts. Follow the workflow state instructions exactly; use transition_state to advance.";
}
OnboardingAgent.agentName = "onboarding-agent";
```
A new agent needs registration, a mount and a migration. See `agent-starter-scaffold`.

## 2. Execution-time rules on top of the workflow (`policy`)
`useAgentStarter` already denies tools outside the active FSM state at execution time (fresh state per call,
batches run in order). Add business rules with the `policy` hook; it runs after the firewall and the state
check, for every call, including names the model was never shown:
```ts
useAgentStarter({
  ...platform("background-worker", id),
  tools,
  workflow: JOB_WORKFLOW,
  policy: (tool, args) =>
    tool === "trigger_customer_message" && (args as { channel?: string }).channel === "sms" && new Date().getUTCHours() < 8
      ? { allowed: false, reason: "No SMS before 08:00 UTC." }
      : { allowed: true },
});
```
A denial reaches the model as a `TOOL_NOT_ALLOWED` tool error with the critic's critique appended to it.

## 3. Tune reflection, drift and autonomy per agent
```ts
useAgentStarter({
  ...platform("copilot", id),
  tools: appApiTools(),
  maxReflectionsPerResponse: 1,                      // at most one in-result critique (and one extra cycle) per response
  planning: true,                                    // the planner pre-pass and per-goal tool gating come with it (planner: false opts out)
  drift: { everyTurns: 5, embedder: () => new WorkersAIEmbedder(bindings().AI, "@cf/baai/bge-small-en-v1.5") }, // spec cosine check
  replanModel: () => frontierProvider(),             // e.g. new OpenAIResponsesProvider({ apiKey }) on gpt-6.1-terra; budget-gated
  // Defaults you no longer pass: confidence (non-LOW tools take an optional _confidence; < threshold → approval),
  // scratchpad (every tool result folded into a [WORKING MEMORY] frame), argumentHealing: "lenient".
  autonomy: { maxAutonomousTier: "LOW", forbidden: ["app_api_delete"] }, // every mutation needs a human; deletes never run
  // utilityModel: () => undefined,                  // disables model critic, drift AND the injection classifier; leave on in prod
});
```
Tenant config can only make autonomy stricter: `TenantConfig.autonomy.confidenceThreshold` /
`maxAutonomousTier`.

## 4. Deep research with parallel subagents
```ts
// src/agents/researcher.ts
"use agent";
import { createWebTools, JinaReader } from "@agent-starter/integrations";
import { useAgentStarter } from "@agent-starter/flue";
import { type AgentProps, useSubagent } from "@flue/runtime";
import { platform } from "../lib/platform.ts";

function SourceAnalyst() {
  return "You analyse the source excerpts you are given for ONE question. Return: key findings with [n] citations, confidence (high/medium/low), and open gaps. Never invent sources.";
}
function Skeptic() {
  return "You review a draft research answer. List unsupported claims, contradictions between sources, and missing perspectives, ordered by severity.";
}

export function DeepResearch({ id }: AgentProps) {
  useAgentStarter({ ...platform("deep-research", id), tools: [...createWebTools({ jina: new JinaReader() })], planning: true, maxReflectionsPerResponse: 2 });
  useSubagent({ name: "source_analyst", description: "Analyses fetched sources for one sub-question.", agent: SourceAnalyst });
  useSubagent({ name: "skeptic", description: "Stress-tests the synthesized answer.", agent: Skeptic });
  return `You are a research lead.
1. plan_goals: one goal per sub-question (max 6).
2. For each goal, fetch 2-4 sources with fetch_url_markdown, then delegate analysis to source_analyst (several task calls in one turn run in parallel). Pass the excerpts in the task prompt.
3. Synthesize, ask skeptic to review, fix the issues, update_goal as you go.
4. Answer with citations [n] → URLs. Say what remains uncertain.`;
}
DeepResearch.agentName = "deep-research";
DeepResearch.durability = { maxAttempts: 5, timeoutMs: 1_200_000 };
```
The subagents have no tools: the root fetches, the subagents reason. That keeps every side effect, and every
web read, behind the guarded pipeline.

## 5. `AgentRuntime` with the intent Planner and the full cognitive stack (Node/tests/custom DO)
```ts
import { WorkersAIEmbedder, WorkersAIProvider } from "@agent-starter/cloudflare";
import { AgentRuntime, createJobStateMachineDefinition, type MachineDefinition, OpenAIResponsesProvider, Planner, singleProviderRouter, StateMachine } from "@agent-starter/core";

const utility = new WorkersAIProvider(env.AI);
const frontier = singleProviderRouter(new OpenAIResponsesProvider({ apiKey: env.OPENAI_API_KEY })); // gpt-6.1-terra, medium effort
const workflow = createJobStateMachineDefinition({ ingest: ["get_contact_profile"], evaluate: ["get_contact_profile"], execute: ["update_contact_fields"], report: ["save_artifact"] }) as MachineDefinition<string, Record<string, unknown>>;

const runtime = new AgentRuntime({
  agent: "job-runner", runId, tenant, tenantConfig, sql, tools,
  instructions: "You process CRM events for this tenant.",
  model: frontier,
  utilityModel: utility,                       // compactor, critic, healer repair model, drift fallback
  embedder: new WorkersAIEmbedder(env.AI),     // drift sentinel by cosine similarity
  planner: new Planner({
    intentModel: utility,
    availableTools: tools.map((t) => t.name),
    policy: { allowedTools: { manychat_contact_updated: ["get_contact_profile", "update_contact_fields"] }, defaultAllowed: ["get_contact_profile"] },
    maxReplans: 3,
  }),
  stateMachine: new StateMachine(workflow, { instanceId: runId, sql, initialContext: {} }),
  driftCheckEvery: 5,
  approvalSecret: env.APPROVAL_SIGNING_SECRET,
});
const result = await runtime.run({ events: turn.events });   // COMPLETED | PENDING_APPROVAL | HALTED | FAILED | TERMINATED
```
