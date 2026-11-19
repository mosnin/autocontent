import { type AnyAgentTool, defineAgentTool, type TenantSecurityContext, type ToolExecutionContext } from "@agent-starter/core";
import type { DelegationDispatch } from "@agent-starter/flue";
import { isHarnessIdentity } from "../lib/integrations.ts";
import { AGENT_ROLE, effectiveAgentPermissions, PERMISSION_PHRASE, type Permission, personPermissions, primaryRole, rolePermissions, roleLabel, UNATTENDED_WITHHELD, whoCan } from "../lib/permissions.ts";
import { departmentConversationKind } from "../multi-agent/roster.ts";
import { type Actor, BLOCKED_ACTOR, makeActor, servicesWithActor } from "./actor-context.ts";
import { MARKETER_ERROR_TAG, MarketerPermissionError } from "./errors.ts";
import { toolPermission } from "./tools/permissions.ts";

export { type Actor, actorFromServices } from "./actor-context.ts";

/**
 * Who a Marketer run acts for, and what that lets it do (docs/auth/agent.md).
 *
 * The actor comes from ONE place: the verified session token (`sub`, `roles`, `scopes`) that agentAuth turned into
 * the conversation's `initialData`. It reaches a department only through the delegation dispatch of the person's own
 * conversation (`actorDispatch`), and the department honours it only in a delegated-task conversation
 * (`delegatedActor`). The model, a tool argument, a bus message and a room turn cannot set or change it.
 *
 * Runs with no person (background jobs, the autopilot, bus and room conversations, the eval harness) have no actor: they
 * send no `x-actor-id`, and the backend gives them the agent role minus spend:approve and campaign:launch.
 */

/** The identity fields of a tenant context or a conversation's initialData. */
interface IdentityLike {
  userId?: unknown;
  roles?: unknown;
  scopes?: unknown;
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/**
 * The person behind a conversation opened with their own session (assistant, copilot, orchestrator, MCP): its
 * `userId` is the token's `sub`. Null for harness identities (system, agent, room, service, cron), widget visitors and
 * eval runs. A person whose id we would not send gets `BLOCKED_ACTOR` (every Marketer tool refused), never null:
 * null means the broader unattended permissions.
 */
export function personActor(identity: IdentityLike | null | undefined): Actor | null {
  if (!identity || typeof identity.userId !== "string") return null;
  const userId = identity.userId;
  const roles = list(identity.roles);
  if (isHarnessIdentity({ userId, roles })) return null;
  if (roles.includes("visitor") || userId.startsWith("visitor_") || userId.startsWith("eval:") || userId === "anonymous") return null;
  return makeActor({ id: userId, roles, scopes: list(identity.scopes) }) ?? BLOCKED_ACTOR;
}

/**
 * The person a department works for: only inside a delegated task (`-dlg.` harness conversation), only when the
 * conversation was created by an agent's delegation (`userId` = `agent:<requester>`, role `agent`), and only from the
 * `actor` that the requester's delegation dispatch stamped on it. Bus and room conversations never have one.
 */
export function delegatedActor(conversationId: string, initialData: (IdentityLike & { actor?: unknown }) | null | undefined): Actor | null {
  if (!initialData || departmentConversationKind(conversationId) !== "delegated") return null;
  if (typeof initialData.userId !== "string" || !initialData.userId.startsWith("agent:") || !list(initialData.roles).includes(AGENT_ROLE)) return null;
  const stamped = initialData.actor;
  if (!stamped || typeof stamped !== "object") return null;
  return personActor({ ...(stamped as { roles?: unknown; scopes?: unknown }), userId: (stamped as { id?: unknown }).id });
}

/**
 * A delegation dispatch that stamps the requester's actor on the worker conversation it creates. The actor is fixed
 * when the requester renders (from its own verified initialData), never taken from the message. Flue applies
 * initialData only when the worker conversation is created, and a worker conversation belongs to exactly one
 * requester conversation, so the stamp cannot change hands.
 */
export function actorDispatch(base: DelegationDispatch, actor: Actor | null): DelegationDispatch {
  if (!actor) return base;
  return (target, request) =>
    base(target, request.initialData && request.message.type === "delegation" ? { ...request, initialData: { ...request.initialData, actor: { id: actor.id, roles: [...actor.roles], scopes: [...actor.scopes] } } as typeof request.initialData } : request);
}

/** What this run may do through Marketer tools: agent ∩ the actor's permissions, or the unattended set. */
export function actorPermissions(actor: Actor | null): Set<Permission> {
  return effectiveAgentPermissions(actor);
}

/**
 * Null when the tool may run for this actor (or is not a Marketer tool), else the sentence the model and the person
 * read. It names the role and what it can't do, and who can.
 */
export function toolDenial(tool: string, actor: Actor | null): string | null {
  const permission = toolPermission(tool);
  if (!permission) return null;
  if (actorPermissions(actor).has(permission)) return null;
  const phrase = PERMISSION_PHRASE[permission];
  const tail = " Nothing was sent. Do not retry; tell the person.";
  const agentMay = rolePermissions(AGENT_ROLE).has(permission);
  if (!actor) {
    if (!agentMay) return `${MARKETER_ERROR_TAG.denied}: The Marketer agent can't ${phrase}; a person has to do it in the Marketer app.${tail}`;
    const money = UNATTENDED_WITHHELD.includes(permission);
    return `${MARKETER_ERROR_TAG.denied}: No signed-in person started this run, so the agent can't ${phrase}${money ? " (it moves money)" : ""}. Ask ${whoCan(permission)} to do it from their own session.${tail}`;
  }
  const role = primaryRole(actor.roles);
  if (!role) return `${MARKETER_ERROR_TAG.denied}: Your session has no workspace role, so you can't ${phrase}. Ask ${whoCan(permission)}.${tail}`;
  if (!personPermissions(actor).has(permission)) return `${MARKETER_ERROR_TAG.denied}: Your role (${roleLabel(role)}) can't ${phrase}. Ask ${whoCan(permission)}.${tail}`;
  return `${MARKETER_ERROR_TAG.denied}: The Marketer agent can't ${phrase} for anyone, whatever their role; do it yourself in the Marketer app.${tail}`;
}

type Policy = (toolName: string, args: unknown) => { allowed: boolean; reason?: string };

/**
 * The executor policy for a run: Marketer tools the actor's permissions do not cover are denied before the firewall's
 * next step, before an approval parks, before anything is sent. Other tools fall through to `inner`.
 */
export function actorPolicy(actor: Actor | null, inner?: Policy): Policy {
  return (toolName, args) => {
    const denial = toolDenial(toolName, actor);
    if (denial) return { allowed: false, reason: denial };
    return inner?.(toolName, args) ?? { allowed: true };
  };
}

type ActorSource = Actor | null | ((ctx: ToolExecutionContext) => Actor | null);

/**
 * Wrap tools so every call (1) re-checks the actor's permission at execution time (defense in depth for hosts that do
 * not compose `actorPolicy`) and (2) carries the actor to the API client, which sends it as `x-actor-id`. A null actor
 * is set explicitly, so nothing upstream can slip one in. `source` may read the call's own context (MCP: the OAuth
 * caller), never its arguments.
 */
export function withActor(tools: readonly AnyAgentTool[], source: ActorSource): AnyAgentTool[] {
  return tools.map(
    (tool) =>
      defineAgentTool({
        ...tool,
        execute: async (args: unknown, ctx: ToolExecutionContext) => {
          const actor = typeof source === "function" ? source(ctx) : source;
          const denial = toolDenial(tool.name, actor);
          if (denial) throw new MarketerPermissionError(denial, tool.sideEffect !== "read" && tool.sideEffect !== "none");
          return tool.execute(args as never, { ...ctx, services: servicesWithActor(ctx.services, actor) });
        },
      }) as unknown as AnyAgentTool,
  );
}

/** MCP callers: the OAuth grant's tenant context, whose roles came from the consenting session. */
export const tenantActor = (ctx: { tenant: TenantSecurityContext }): Actor | null => personActor(ctx.tenant);
