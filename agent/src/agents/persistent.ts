"use agent";
import { agentIdentity, AutoReviewer, createEgressGuard, createPersistentControlTools, DEFAULT_PERSISTENT_CONFIG, type PersistentAgentConfig, type PersistentControlPort } from "@agent-starter/core";
import { WorkersAIProvider } from "@agent-starter/cloudflare";
import { useAgentStarter } from "@agent-starter/flue";
import { type AgentProps, useInitialData, useSkill } from "@flue/runtime";
import { useCustomSkills } from "../lib/custom-skills.ts";
import { approvals, bindings, modelOptions, platform, sendToSaas } from "../lib/platform.ts";
import { workersAiModel } from "../lib/policy.ts";
import { MARKETER_HEARTBEAT } from "../marketer/heartbeat.ts";
import { persistentReadTools } from "../marketer/tools/index.ts";
import { createProposeNextMovesTool } from "../marketer/tools/proposals.ts";
import { credentialBroker, managedEgress } from "../persistent/credentials.ts";
import { persistentEnv } from "../persistent/env.ts";
import { controlStub, type PersistentInitialData } from "../persistent/instance.ts";
import { sandboxControlPort } from "../persistent/sandbox.ts";
import operatingProcedures from "../skills/operating-procedures/SKILL.md";
import persistentOperation from "../skills/persistent-operation/SKILL.md";
import untrustedContent from "../skills/untrusted-content/SKILL.md";

/** RPC surface of the PersistentAgentControl stub this agent uses (it can read and propose, never set). */
interface ControlRpc extends PersistentControlPort {
  getConfig(): Promise<PersistentAgentConfig | null>;
  isKilled(): Promise<boolean>;
  recordTurn(summary: unknown): Promise<void>;
  recordReview(entry: unknown): Promise<void>;
}

/**
 * Always-on agent (one Flue instance per persistent agent: `persistent-agent--<tenantId>--<agentId>`). It has no HTTP
 * mount: its control plane (src/persistent/control.ts) wakes it with `heartbeat` / `schedule` signals, and the
 * approval routes wake it with decisions. Everything it may do comes from the control plane's config, which it can
 * only PROPOSE to change (propose_config_change, propose_skill):
 *  - fetches go through the managed egress allowlist (PERSISTENT_EGRESS_ALLOW, narrowed by the config) and the
 *    credential broker (src/persistent/credentials.ts), so secrets never reach the model;
 *  - every tool call is auto-reviewed by a second model first (fail closed: escalate to a human);
 *  - HIGH / CRITICAL calls and escalations park on recipient-bound approvals the OWNER decides;
 *  - the kill switch locks render and execution and stops the heartbeat; a daily budget and a tool-call cap per tick apply;
 *  - memory carries provenance: its own notes and anything from tools are untrusted and expire.
 * Without the `persistent` initialData (the eval harness, a test conversation) it runs on the secure defaults with a
 * sandbox port: no egress, no credentials, nothing stored.
 */
export function PersistentAgent({ id }: AgentProps) {
  const initial = useInitialData<Partial<PersistentInitialData> | undefined>();
  const env = persistentEnv(bindings());
  const tenantId = initial?.tenantId ?? "unknown";
  const wired = Boolean(initial?.persistent && env.PERSISTENT_CONTROL);
  const agentId = initial?.persistent?.agentId ?? "sandbox";
  const ownerUserId = initial?.persistent?.ownerUserId ?? initial?.userId ?? "unknown";
  const identity = agentIdentity(tenantId, agentId, ownerUserId);
  const control = (): ControlRpc | undefined => (wired ? controlStub<ControlRpc>(env, tenantId, agentId) : undefined);
  const port = (): PersistentControlPort => control() ?? sandboxControlPort();
  const fallbackConfig: PersistentAgentConfig = { ...DEFAULT_PERSISTENT_CONFIG, agentId, name: "Marketer autopilot", ownerUserId, heartbeat: MARKETER_HEARTBEAT };
  // A wired agent whose control plane has no config (deleted, not created yet) stays disabled.
  const loadConfig = async (): Promise<PersistentAgentConfig> => (await control()?.getConfig()) ?? { ...fallbackConfig, enabled: false };
  const reviewModelId = (config: PersistentAgentConfig) => workersAiModel(config.autoReview.model || env.PERSISTENT_REVIEW_MODEL || modelOptions().firstLine);

  const base = platform("persistent-agent", id);
  const ctx = useAgentStarter({
    ...base,
    // Approvals go to the owner, bound to them: the agent can never approve its own calls.
    approvals: approvals({ bindToRecipient: true, approverId: () => ownerUserId }),
    // Read the account (brokered `saas` credential + egress allowlist), propose; never act on its own.
    tools: [...createPersistentControlTools({ control: port, principal: identity.principal }), ...persistentReadTools(), createProposeNextMovesTool(sendToSaas)],
    persistent: {
      identity,
      // The control plane's config (read each delivery); without one, the secure defaults.
      config: wired ? loadConfig : fallbackConfig,
      killSwitch: async () => (await control()?.isKilled()) ?? false,
      egress: (config: PersistentAgentConfig) => createEgressGuard({ ...managedEgress(env), agentAllow: config.egress.allow, agentDeny: config.egress.deny }),
      broker: (config: PersistentAgentConfig) => credentialBroker(env, config.credentials),
      reviewer: (config: PersistentAgentConfig) =>
        new AutoReviewer({
          model: () => new WorkersAIProvider(env.AI, reviewModelId(config) ? { model: reviewModelId(config) as string } : {}),
          onDecision: (call, decision) => control()?.recordReview({ tool: call.tool, decision: decision.decision, reason: decision.reason, by: decision.by }),
        }),
      onTurnSummary: async (summary) => {
        await control()?.recordTurn(summary);
      },
    },
  });
  useSkill(operatingProcedures);
  useSkill(untrustedContent);
  useSkill(persistentOperation);
  // Skills the owner approved (self-authored ones land in quarantine as proposals first).
  for (const skill of ctx.persistent?.config?.skills ?? []) useSkill({ name: skill.name, description: skill.description, instructions: skill.body });
  useCustomSkills();

  return `You are ${ctx.persistent?.config?.name ?? "Marketer autopilot"}, Marketer's always-on loop acting on behalf of ${identity.actingFor} in ${tenantId}.
- You are woken by heartbeat and schedule signals; nobody is chatting with you. Follow the persistent-operation skill and the HEARTBEAT checklist.
- Read the account with get_workspace_overview, get_workspace_inbox, get_workspace_activity and get_spend_today. Never invent numbers; money in US dollars.
- You never spend, publish, approve or make content yourself. When the checklist calls for action, call propose_next_moves ONCE with every move (department, action, why, expected cost in USD); it waits for the owner's approval and then goes to Marketer.
- If nothing needs doing, reply exactly HEARTBEAT_OK and call no tools.
- You cannot change your own configuration; propose changes with propose_config_change or propose_skill.`;
}
PersistentAgent.agentName = "persistent-agent";
PersistentAgent.durability = { maxAttempts: 3, timeoutMs: 300_000 };

