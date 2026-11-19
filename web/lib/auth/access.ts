// Better Auth access control, built from the catalog.
//
// The organization plugin checks its own statements (organization:update,
// member:update, invitation:create, …) before running an endpoint. They are
// derived here from catalog permissions so that a role can do through Better
// Auth exactly what the catalog says, and nothing more:
//
//   organization:update  ← workspace:update      organization:delete ← workspace:delete
//   member:create        ← member:invite          member:update       ← member:update_role
//   member:delete        ← member:remove          invitation:create   ← member:invite
//   invitation:cancel    ← member:invite          team:*, ac:*        ← nobody (teams and
//                                                                       dynamic roles are off)
//
// The grant ceiling, last-owner and self-change rules need more than a role
// (who the target is), so they are enforced in the hooks in server.ts.

import { createAccessControl } from "better-auth/plugins/access";
import { CATALOG, RESOURCES, ROLES, grantsOf, type Role } from "./catalog.ts";

/** Better Auth's own organization statements, merged into the catalog's. */
const BA_STATEMENTS = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

type Statements = Record<string, string[]>;

export function buildStatements(): Statements {
  const out: Statements = {};
  for (const r of RESOURCES) out[r] = [...(CATALOG.resources[r] as readonly string[])];
  for (const [r, actions] of Object.entries(BA_STATEMENTS)) out[r] = [...new Set([...(out[r] ?? []), ...actions])];
  return out;
}

/** A role's statements: its catalog grants plus the Better Auth statements they imply. */
export function roleStatements(role: Role): Statements {
  const g = grantsOf(role);
  const out: Statements = {};
  for (const [r, actions] of Object.entries(g)) if (actions && actions.length) out[r] = [...actions];
  const has = (r: keyof typeof CATALOG.resources, a: string) => (g[r] ?? []).includes(a);
  const add = (r: string, a: string) => (out[r] = [...new Set([...(out[r] ?? []), a])]);
  if (has("workspace", "update")) add("organization", "update");
  if (has("workspace", "delete")) add("organization", "delete");
  if (has("member", "invite")) (add("member", "create"), add("invitation", "create"), add("invitation", "cancel"));
  if (has("member", "update_role")) add("member", "update");
  if (has("member", "remove")) add("member", "delete");
  return out;
}

export const ac = createAccessControl(buildStatements() as never);

/**
 * One Better Auth role per assignable catalog role. `agent` is a system role
 * and is deliberately absent, so it can never be stored on a membership.
 */
export const roles = Object.fromEntries(ROLES.filter((r) => CATALOG.roles[r].assignable).map((r) => [r, ac.newRole(roleStatements(r) as never)])) as Record<Exclude<Role, "agent">, ReturnType<typeof ac.newRole>>;
