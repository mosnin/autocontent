"use agent";
import { useAgentStarter, useAskPerson } from "@agent-starter/flue";
import { type AgentProps, useSkill } from "@flue/runtime";
import { appApiFirewall, appApiTools } from "../in-app/app-api.ts";
import { useCustomSkills } from "../lib/custom-skills.ts";
import { bindings, platform } from "../lib/platform.ts";
import { useTraceRun } from "../lib/braintrust/hooks.ts";
import { actorPolicy, withActor } from "../marketer/actor.ts";
import { usePersonActor } from "../marketer/actor-hooks.ts";
import { useRecall } from "../marketer/recall/wiring.ts";
import generativeUI from "../skills/generative-ui/SKILL.md";
import untrustedContent from "../skills/untrusted-content/SKILL.md";
import operatingProcedures from "../skills/operating-procedures/SKILL.md";

/**
 * The in-page Marketer copilot: lives in the Marketer web app's sidebar, sees the page the user is on ([APP CONTEXT]
 * from the first message + context lines in each message) and acts through typed Marketer tools as that user.
 * Reads are autonomous; making content (credits) is MEDIUM; deciding an inbox item publishes or discards and always
 * waits for the person's approval. Paid media, brand changes and multi-step plans go to Marketer (the main session).
 */
export function Copilot({ id }: AgentProps) {
  // ask_person: when a request is ambiguous ("which playbook?", "approve or reject?"), ask with a typed question card
  // in the sidebar instead of guessing; the run parks until the answer arrives (human-answer signal).
  const askPerson = useAskPerson({ id, secret: () => bindings().APPROVAL_SIGNING_SECRET, baseUrl: () => bindings().PUBLIC_BASE_URL });
  // The signed-in person: every Marketer call carries x-actor-id and is checked against agent ∩ their role first.
  const actor = usePersonActor();
  const ctx = useAgentStarter({ ...platform("copilot", id), tools: [...withActor(appApiTools(), actor), askPerson], policy: actorPolicy(actor), firewall: appApiFirewall, planning: true, memory: true });
  // Recall (Supermemory, off unless the workspace turned it on): personal + team into each turn; the person's own
  // turns into their personal memory.
  useRecall({ id, tenantId: ctx.tenant.tenantId, actor, write: true });
  // Braintrust: traceSpanId on delivered replies, the person on the trace, the approval score (src/lib/braintrust).
  useTraceRun({ id, actor });
  useSkill(operatingProcedures);
  // Voice calls (initialData.scopes includes "channel:voice") speak plain sentences: no generative UI there.
  if (!ctx.voice) useSkill(generativeUI);
  useSkill(untrustedContent);
  useCustomSkills();
  return `You are the Marketer copilot inside the Marketer web app. Help the person with the page they are on.
- Messages from the sidebar carry the current page as an "openui:context" JSON block (path, title, entity ids such as a playbook, video, article or campaign id): use it to resolve "this playbook / this video / this page".
- Ground every answer in account data from your tools (workspace overview, inbox, activity, playbooks, videos, carousels, articles, campaigns, metrics, spend). Never guess records or numbers; money in US dollars.
- You can start a video, carousel or article for the page's playbook (spends content credits: say what it costs first if you know) and decide an inbox item (decide_inbox_item publishes or discards; it waits for the person's approval).
- Paid ads, budgets, brand kit changes and multi-step plans belong to Marketer: say so and suggest opening a session with Marketer.
- Use navigate_ui to take the person to the relevant page when that is faster than explaining.
- If the request is ambiguous, call ask_person (choice / confirm / text) and stop until they answer.
- Present lists and metrics with generative UI (Table, Stat, List). Keep answers short.`;
}
Copilot.agentName = "copilot";
Copilot.durability = { maxAttempts: 5, timeoutMs: 600_000 };
