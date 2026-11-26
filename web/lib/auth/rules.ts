// The membership rules from docs/auth/permissions.json ("rules"), as pure
// functions. The organization hooks in server.ts call these; so do the Team
// screens, to offer only what the server will accept.
//
//   grant_ceiling  invite or change someone to a role of rank <= your own;
//                  only an owner can make an owner.
//   last_owner     a workspace always keeps at least one owner.
//   self_change    nobody changes their own role.

import { can, isAssignableRole, parseMemberRole, rankOf, ASSIGNABLE_ROLES, type AssignableRole } from "./catalog.ts";

export type RuleCode = "forbidden" | "unknown_role" | "grant_ceiling" | "owner_only" | "last_owner" | "self_change" | "not_member";

export type RuleResult = { ok: true } | { ok: false; code: RuleCode; message: string };

const OK: RuleResult = { ok: true };
const no = (code: RuleCode, message: string): RuleResult => ({ ok: false, code, message });

/** Whether someone holding `actorRole` may give `targetRole` to anyone (grant ceiling). */
export function canGrant(actorRole: unknown, targetRole: unknown): RuleResult {
  const actor = parseMemberRole(actorRole);
  if (!actor) return no("not_member", "You are not a member of this workspace.");
  const target = typeof targetRole === "string" ? targetRole.trim() : "";
  if (!isAssignableRole(target)) return no("unknown_role", "That role does not exist.");
  if (target === "owner" && actor !== "owner") return no("owner_only", "Only an owner can make someone an owner.");
  if (rankOf(target) > rankOf(actor)) return no("grant_ceiling", "You can only give a role at or below your own.");
  return OK;
}

/** The roles `actorRole` may grant, highest first, for invite and role pickers. */
export function grantableRoles(actorRole: unknown): AssignableRole[] {
  return ASSIGNABLE_ROLES.filter((r) => canGrant(actorRole, r).ok).sort((a, b) => rankOf(b) - rankOf(a));
}

export function checkInvite(input: { actorRole: unknown; role: unknown }): RuleResult {
  if (!can(parseMemberRole(input.actorRole), "member:invite")) return no("forbidden", "Your role can't invite people.");
  return canGrant(input.actorRole, input.role);
}

export interface MemberRef {
  memberId: string;
  userId: string;
  role: unknown;
}

export function checkRoleChange(input: { actor: MemberRef; target: MemberRef; newRole: unknown; ownerCount: number }): RuleResult {
  const { actor, target, newRole, ownerCount } = input;
  if (actor.memberId === target.memberId || actor.userId === target.userId) return no("self_change", "You can't change your own role.");
  if (!can(parseMemberRole(actor.role), "member:update_role")) return no("forbidden", "Your role can't change roles.");
  const grant = canGrant(actor.role, newRole);
  if (!grant.ok) return grant;
  const current = parseMemberRole(target.role);
  // Changing someone above you would be granting power over a higher role.
  if (rankOf(current) > rankOf(parseMemberRole(actor.role))) return no("grant_ceiling", "You can't change the role of someone above you.");
  if (current === "owner" && newRole !== "owner" && ownerCount <= 1) return no("last_owner", "A workspace needs at least one owner. Make someone else an owner first.");
  return OK;
}

export function checkRemoval(input: { actor: MemberRef; target: MemberRef; ownerCount: number }): RuleResult {
  const { actor, target, ownerCount } = input;
  const self = actor.memberId === target.memberId || actor.userId === target.userId;
  const current = parseMemberRole(target.role);
  if (current === "owner" && ownerCount <= 1) return no("last_owner", self ? "You are the last owner. Make someone else an owner before you leave." : "A workspace needs at least one owner.");
  if (self) return OK; // leaving is always allowed, last owner aside
  if (!can(parseMemberRole(actor.role), "member:remove")) return no("forbidden", "Your role can't remove people.");
  if (rankOf(current) > rankOf(parseMemberRole(actor.role))) return no("grant_ceiling", "You can't remove someone above you.");
  if (current === "owner" && parseMemberRole(actor.role) !== "owner") return no("owner_only", "Only an owner can remove an owner.");
  return OK;
}

export function countOwners(members: { role: unknown }[]): number {
  return members.filter((m) => parseMemberRole(m.role) === "owner").length;
}
