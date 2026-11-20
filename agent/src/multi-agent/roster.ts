import { agentInstanceId, harnessSessionKey, parseAgentInstanceId, parseHarnessSessionKey } from "@agent-starter/core";
import type { DelegationRosterEntry } from "@agent-starter/flue";
import { type Department, departmentToolNames } from "../marketer/tools/index.ts";

/**
 * Marketer's departments: one dispatch-only specialist per department, shared by Marketer (`assistant`), the
 * orchestrator (who to summon / delegate to) and the room (how to reach them).
 *
 * Identities: the analyst keeps the generated `analyst-agent` identity (its Durable Object class is in migration
 * v1); the five new departments are new identities with their classes in migration v2. The generated writer and
 * security-auditor agents are retired (no roster, room or bus entry) but stay exported until a later migration
 * deletes their classes (agent-starter-scaffold: rename = new class, drain, then `deleted_classes`).
 */
export const SPECIALISTS = [
  { id: "strategist", agent: "strategist", role: "Strategist", description: "Positioning, playbooks (audience, voice, platforms, posting windows), campaign plans and the brand kit." },
  { id: "content-producer", agent: "content-producer", role: "Content Producer", description: "Short-form videos, carousels and template remixes from the media library." },
  { id: "seo-editor", agent: "seo-editor", role: "SEO Editor", description: "SEO articles and repurposing finished articles into social posts." },
  { id: "media-buyer", agent: "media-buyer", role: "Media Buyer", description: "Paid ads: accounts, draft campaigns, budgets and activations, strictly governed (every money move needs a person)." },
  { id: "distribution-manager", agent: "distribution-manager", role: "Distribution Manager", description: "Calendar, campaigns, channel connection (Ayrshare) and approving what gets posted." },
  { id: "analyst", agent: "analyst-agent", role: "Analyst", description: "Performance across organic video, articles and paid ads; spend in dollars; what moved and why." },
] as const satisfies ReadonlyArray<{ id: Department; agent: string; role: string; description: string }>;

export type SpecialistId = (typeof SPECIALISTS)[number]["id"];

/**
 * Who Marketer / the orchestrator may delegate to with `delegate_task`. The model picks an `id`; the server resolves
 * `agent` (never model text). `tools` are the worker's own department tools: a delegation grant is the requester's
 * grant ∩ these (enforced on the worker at execution time), so a department can never act outside its own tools.
 */
export const DELEGATION_ROSTER: DelegationRosterEntry[] = SPECIALISTS.map((s) => ({ id: s.id, agent: s.agent, description: `${s.role}: ${s.description}`, tools: departmentToolNames(s.id) }));

/**
 * The authority Marketer and the orchestrator hand on through delegation: every department's tools. They hold the
 * grant, not the tools themselves: each department runs its own tools through its own guarded pipeline (risk tiers,
 * approvals, firewall), and the worker grant is still narrowed to that department's roster entry.
 */
export const DEPARTMENT_GRANT: readonly string[] = [...new Set(SPECIALISTS.flatMap((s) => departmentToolNames(s.id)))];

/**
 * Agents the message bus may deliver to (SEC-07): dispatch-only agents that have no HTTP mount, so a bus message can
 * never land in, or create, a conversation a person owns or reads. Add an agent here only if it is not HTTP-mounted.
 */
export const BUS_TARGETS: readonly string[] = SPECIALISTS.map((s) => s.agent);

/** Routing keys a sender may choose (the bus conversation of a target agent). */
export const BUS_ROUTING_KEY = /^[A-Za-z0-9_-]{1,60}$/;

/**
 * Bus conversation of a target agent: `<agent>--<tenant>---bus.<key>`. The session part is a harness key, so it can
 * never parse as a user-owned conversation (`isConversationOwner` is false for every user).
 */
export function busConversationId(agent: string, tenantId: string, routingKey: string): string {
  return agentInstanceId(agent, tenantId, harnessSessionKey("bus", BUS_ROUTING_KEY.test(routingKey) ? routingKey : "bus"));
}

/**
 * Specialist conversation for a room: `<agent>--<tenant>---room.<key>`, where the room id is `room--<tenant>--<key>`.
 * A harness session key (SEC-20): no user, whatever their id, can own, read or post to it.
 */
export function roomConversationId(agentName: string, config: { roomId: string; tenantId: string }): string {
  const key = config.roomId.split("--").pop() ?? config.roomId;
  return agentInstanceId(agentName, config.tenantId, harnessSessionKey("room", key));
}

/** How a department conversation was opened, read from its harness instance id (server-minted, never model text). */
export type DepartmentConversationKind = "delegated" | "bus" | "room" | "other";

export function departmentConversationKind(id: string): DepartmentConversationKind {
  const session = parseAgentInstanceId(id)?.sessionKey;
  const kind = session ? parseHarnessSessionKey(session)?.kind : undefined;
  return kind === "dlg" ? "delegated" : kind === "bus" ? "bus" : kind === "room" ? "room" : "other";
}

/**
 * The highest tier a department may run WITHOUT a person in this conversation.
 *
 * Only a delegated task carries authority: Marketer or the orchestrator, working for the signed-in person, handed it
 * a brief and a tool grant. A bus message or a room turn is INFORMATION from another agent (`authority:
 * information`): its text may have started in a webhook, a page or a caption, and the sender may be an agent that
 * holds no acting tools at all (the pipeline worker). If a department acted on it on its own, any agent that can
 * post a message could spend content credits through a department that can. So outside a delegated task nothing
 * above LOW runs without the account owner's approval; reads stay free. Unknown kinds fail closed to LOW.
 */
export function departmentAutonomyCap(id: string, departmentCap?: "LOW" | "MEDIUM"): "LOW" | "MEDIUM" | undefined {
  return departmentConversationKind(id) === "delegated" ? departmentCap : "LOW";
}
