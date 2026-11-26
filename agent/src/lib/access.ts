import { type Permission, type PersonRole, rolesGranting } from "./permissions.ts";

/**
 * Every role-gated route of the agent Worker, expressed as ONE permission from the catalog (docs/auth/agent.md has
 * the table). Vendored routes take role lists, so they get `rolesGranting(permission)`; our own routes check
 * `hasScope(claims, permission)` (role AND scope). Machine roles (`agent`, `system`, `visitor`, ...) never appear here:
 * the catalog's `agent` role is not assignable, so `rolesGranting` never lists it.
 */

/** Decide a parked approval by id (`POST /approvals/by-id/...`): `agent:approve` (owner, admin, marketer). */
export const APPROVAL_DECIDE_PERMISSION: Permission = "agent:approve";
export const APPROVAL_DECIDER_ROLES: readonly PersonRole[] = Object.freeze(rolesGranting(APPROVAL_DECIDE_PERMISSION));

/**
 * Operator controls: background jobs (start, status, pause, resume, teardown), the dead-letter queue, any job
 * conversation of the tenant, and the autopilot console (create, manage, kill switch): `security:manage`.
 */
export const OPERATOR_PERMISSION: Permission = "security:manage";
export const OPERATOR_ROLES: readonly PersonRole[] = Object.freeze(rolesGranting(OPERATOR_PERMISSION));

/** Read-only oversight of everything agents do in the workspace (any room, any live channel, the autopilot audit log): `audit:read`. */
export const OBSERVER_PERMISSION: Permission = "audit:read";
export const OBSERVER_ROLES: readonly PersonRole[] = Object.freeze(rolesGranting(OBSERVER_PERMISSION));
