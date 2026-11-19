// The permission catalog as functions. Pure: no Next, no database, safe in
// client components and in the Node test runner. The server stays the
// authority; `can()` in a component only hides or disables a control.

import { CATALOG } from "./catalog.data.ts";

export { CATALOG };

type Resources = typeof CATALOG.resources;
export type Resource = keyof Resources;
/** "resource:action", e.g. "campaign:launch". */
export type Permission = { [R in Resource]: `${R}:${Resources[R][number]}` }[Resource];
export type Role = keyof typeof CATALOG.roles;
/** Roles a person can hold. `agent` is a system role. */
export type AssignableRole = Exclude<Role, "agent">;

export const RESOURCES = Object.keys(CATALOG.resources) as Resource[];
export const ROLES = Object.keys(CATALOG.roles) as Role[];
export const ASSIGNABLE_ROLES = ROLES.filter((r) => CATALOG.roles[r].assignable) as AssignableRole[];

/** Every permission in the catalog, in catalog order. */
export const ALL_PERMISSIONS: Permission[] = RESOURCES.flatMap((r) => (CATALOG.resources[r] as readonly string[]).map((a) => `${r}:${a}` as Permission));
const ALL = new Set<string>(ALL_PERMISSIONS);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(CATALOG.roles, value);
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return isRole(value) && CATALOG.roles[value].assignable === true;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && ALL.has(value);
}

/** The role's grants as { resource: actions[] }, with "*" expanded. */
export function grantsOf(role: Role): Partial<Record<Resource, readonly string[]>> {
  const grants = CATALOG.roles[role].grants;
  if (grants === "*") return { ...CATALOG.resources };
  return grants as Partial<Record<Resource, readonly string[]>>;
}

const cache = new Map<Role, Permission[]>();

/** The role's permissions as "resource:action" strings, in catalog order. Unknown role: none. */
export function permissionsFor(role: unknown): Permission[] {
  if (!isRole(role)) return [];
  const hit = cache.get(role);
  if (hit) return hit;
  const g = grantsOf(role);
  const out = ALL_PERMISSIONS.filter((p) => {
    const [r, a] = p.split(":") as [Resource, string];
    return (g[r] ?? []).includes(a);
  });
  cache.set(role, out);
  return out;
}

/** Whether `role` grants `permission`. Unknown role or permission: false. */
export function can(role: unknown, permission: string): boolean {
  if (!isRole(role) || !ALL.has(permission)) return false;
  return permissionsFor(role).includes(permission as Permission);
}

export function rankOf(role: unknown): number {
  return isRole(role) ? CATALOG.roles[role].rank : -1;
}

export function roleLabel(role: unknown): string {
  return isRole(role) ? CATALOG.roles[role].label : "No access";
}

export function roleDescription(role: unknown): string {
  return isRole(role) ? CATALOG.roles[role].description : "";
}

/**
 * A membership's role as stored by Better Auth. The organization plugin allows
 * a comma-separated list; Marketer gives one role per workspace, so anything
 * else (several roles, an unknown or system role) is treated as no role.
 */
export function parseMemberRole(raw: unknown): AssignableRole | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 1) return null;
  return isAssignableRole(parts[0]) ? parts[0] : null;
}
