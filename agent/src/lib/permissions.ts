/**
 * The workspace permission catalog: a typed copy of `docs/auth/permissions.json` (the one catalog the web app, the
 * backend and this agent harness all enforce; see docs/auth/README.md and docs/auth/agent.md).
 *
 * `test/permissions.test.ts` asserts this object equals the JSON file. Change the JSON first, then this copy, in the
 * same commit. Pure module (no platform import), so routes, tools and Node tests share it.
 *
 * Two ways a check reads it:
 *  - role lists handed to vendored routes (approvals by id, persistent console, agentAuth admin roles):
 *    `rolesGranting(permission)`: the assignable roles whose grants include it;
 *  - checks in our own code (operator routes, room and channel observers, Marketer tools): `hasScope(claims,
 *    permission)`: the token must hold a catalog role that grants it AND carry it in `scopes`. A role the catalog does
 *    not know, or a scope its role does not grant, adds nothing.
 */
export const PERMISSION_CATALOG = {
  $comment:
    "The one permission catalog. web/, backend/ and agent/ each embed a copy and a test asserts it equals this file. Change it here first, then every copy, in the same commit. See docs/auth/README.md.",
  version: 1,
  resources: {
    workspace: ["read", "update", "delete"],
    member: ["read", "invite", "update_role", "remove"],
    billing: ["read", "manage"],
    security: ["read", "manage"],
    audit: ["read"],
    api_token: ["read", "create", "revoke"],
    integration: ["read", "connect", "disconnect"],
    webhook: ["read", "manage"],
    brand: ["read", "update"],
    playbook: ["read", "create", "update", "delete"],
    content: ["read", "create", "update", "delete", "approve", "publish"],
    campaign: ["read", "create", "update", "launch", "pause", "delete"],
    spend: ["read", "approve", "set_limits"],
    analytics: ["read"],
    agent: ["chat", "approve"],
    memory: ["read", "confirm", "forget"],
  },
  roles: {
    owner: {
      label: "Owner",
      description: "Everything, including deleting the workspace and transferring ownership.",
      assignable: true,
      rank: 100,
      grants: "*",
    },
    admin: {
      label: "Admin",
      description: "Runs the workspace: people, security, billing, integrations and all marketing work. Cannot delete the workspace or make owners.",
      assignable: true,
      rank: 80,
      grants: {
        workspace: ["read", "update"],
        member: ["read", "invite", "update_role", "remove"],
        billing: ["read", "manage"],
        security: ["read", "manage"],
        audit: ["read"],
        api_token: ["read", "create", "revoke"],
        integration: ["read", "connect", "disconnect"],
        webhook: ["read", "manage"],
        brand: ["read", "update"],
        playbook: ["read", "create", "update", "delete"],
        content: ["read", "create", "update", "delete", "approve", "publish"],
        campaign: ["read", "create", "update", "launch", "pause", "delete"],
        spend: ["read", "approve", "set_limits"],
        analytics: ["read"],
        agent: ["chat", "approve"],
        memory: ["read", "confirm", "forget"],
      },
    },
    marketer: {
      label: "Marketer",
      description: "Does the marketing: makes and approves content, launches and pauses campaigns within the caps an admin set, works with the agents.",
      assignable: true,
      rank: 60,
      grants: {
        workspace: ["read"],
        member: ["read"],
        integration: ["read", "connect"],
        webhook: ["read"],
        brand: ["read", "update"],
        playbook: ["read", "create", "update", "delete"],
        content: ["read", "create", "update", "delete", "approve", "publish"],
        campaign: ["read", "create", "update", "launch", "pause"],
        spend: ["read", "approve"],
        analytics: ["read"],
        agent: ["chat", "approve"],
        memory: ["read", "confirm"],
      },
    },
    analyst: {
      label: "Analyst",
      description: "Reads everything marketing and asks the agents questions. Changes nothing and approves nothing.",
      assignable: true,
      rank: 40,
      grants: {
        workspace: ["read"],
        member: ["read"],
        integration: ["read"],
        brand: ["read"],
        playbook: ["read"],
        content: ["read"],
        campaign: ["read"],
        spend: ["read"],
        analytics: ["read"],
        agent: ["chat"],
        memory: ["read"],
      },
    },
    billing: {
      label: "Billing",
      description: "Manages credits, plans and invoices, and sees spend. No marketing work.",
      assignable: true,
      rank: 20,
      grants: {
        workspace: ["read"],
        member: ["read"],
        billing: ["read", "manage"],
        spend: ["read"],
        analytics: ["read"],
      },
    },
    agent: {
      label: "Marketer agent",
      description:
        "System role for the agent harness acting on a workspace. Never assignable to a person. Its effective permissions are this set intersected with the role of the person who started the session.",
      assignable: false,
      rank: 0,
      grants: {
        workspace: ["read"],
        integration: ["read"],
        webhook: ["read"],
        brand: ["read"],
        playbook: ["read", "create", "update"],
        content: ["read", "create", "update", "approve", "publish"],
        campaign: ["read", "create", "update", "launch", "pause"],
        spend: ["read", "approve"],
        analytics: ["read"],
        agent: ["chat"],
        memory: ["read"],
      },
    },
  },
  rules: {
    grant_ceiling: "A person can invite someone with, or change someone to, only a role whose rank is at most their own. Only an owner can make an owner.",
    last_owner: "A workspace always has at least one owner: the last owner cannot leave, be removed or be demoted.",
    self_change: "Nobody can change their own role.",
    agent_intersection:
      "Delegated agent calls get agent ∩ the starting person's role. With no verified person, they get the agent role alone, minus anything that moves money (spend:approve, campaign:launch), which then needs a person through the rails.",
    platform_admin: "Marketer staff (auth.user.role = 'admin') is separate from workspace roles, grants nothing inside a workspace, and requires two-factor to reach /admin.",
    approval_deciders: "A person may decide an agent approval by id when their role grants agent:approve.",
  },
} as const;

type Resources = typeof PERMISSION_CATALOG.resources;
export type Resource = keyof Resources;
/** A `resource:action` string from the catalog. */
export type Permission = { [R in Resource]: `${R}:${Resources[R][number]}` }[Resource];
export type RoleName = keyof typeof PERMISSION_CATALOG.roles;
/** Roles a person can hold in a workspace (everything but the `agent` system role). */
export type PersonRole = { [R in RoleName]: (typeof PERMISSION_CATALOG.roles)[R]["assignable"] extends true ? R : never }[RoleName];

type GrantMap = Readonly<Partial<Record<Resource, readonly string[]>>>;

/** The system role the harness acts as on a workspace. */
export const AGENT_ROLE = "agent" satisfies RoleName;

/** What an unattended run (no verified person) never gets: anything that moves money (`rules.agent_intersection`). */
export const UNATTENDED_WITHHELD: readonly Permission[] = Object.freeze(["spend:approve", "campaign:launch"] as const);

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  (Object.entries(PERMISSION_CATALOG.resources) as [Resource, readonly string[]][]).flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}` as Permission)),
);
const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export const ROLE_NAMES: readonly RoleName[] = Object.freeze(Object.keys(PERMISSION_CATALOG.roles) as RoleName[]);

const own = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

export function isCatalogRole(role: unknown): role is RoleName {
  return typeof role === "string" && own(PERMISSION_CATALOG.roles, role);
}

/** True for a role a person can hold (owner, admin, marketer, analyst, billing); false for `agent` and unknown roles. */
export function isPersonRole(role: unknown): role is PersonRole {
  return isCatalogRole(role) && PERMISSION_CATALOG.roles[role].assignable === true;
}

const ROLE_PERMISSIONS: ReadonlyMap<RoleName, ReadonlySet<Permission>> = new Map(
  ROLE_NAMES.map((role) => {
    const grants = PERMISSION_CATALOG.roles[role].grants as "*" | GrantMap;
    if (grants === "*") return [role, new Set(ALL_PERMISSIONS)];
    const set = new Set<Permission>();
    for (const [resource, actions] of Object.entries(grants) as [Resource, readonly string[]][]) {
      for (const action of actions) {
        const permission = `${resource}:${action}`;
        if (isPermission(permission)) set.add(permission);
      }
    }
    return [role, set];
  }),
);
const EMPTY: ReadonlySet<Permission> = new Set();

/** The permissions a catalog role grants; empty for a role the catalog does not know. */
export function rolePermissions(role: string): ReadonlySet<Permission> {
  return isCatalogRole(role) ? (ROLE_PERMISSIONS.get(role) ?? EMPTY) : EMPTY;
}

/** The assignable roles that grant `permission`, highest rank first (the `agent` system role is never listed). */
export function rolesGranting(permission: Permission): PersonRole[] {
  return ROLE_NAMES.filter((role): role is PersonRole => isPersonRole(role) && rolePermissions(role).has(permission)).sort((a, b) => PERMISSION_CATALOG.roles[b].rank - PERMISSION_CATALOG.roles[a].rank);
}

/** The subset of a session's claims a permission check reads. */
export interface PermissionClaims {
  roles?: readonly string[] | undefined;
  scopes?: readonly string[] | undefined;
}

/**
 * The permissions a person's session holds: granted by one of their PERSON roles in the catalog AND listed in their
 * scopes. Unknown roles, the `agent` system role, and scopes their role does not grant all add nothing.
 */
export function personPermissions(claims: PermissionClaims): Set<Permission> {
  const scopes = new Set((claims.scopes ?? []).filter((s): s is string => typeof s === "string"));
  const out = new Set<Permission>();
  for (const role of claims.roles ?? []) {
    if (!isPersonRole(role)) continue;
    for (const permission of rolePermissions(role)) if (scopes.has(permission)) out.add(permission);
  }
  return out;
}

/** Does this session hold `permission` (a person role grants it and it is in the token's scopes)? */
export function hasScope(claims: PermissionClaims | null | undefined, permission: Permission): boolean {
  if (!claims) return false;
  return personPermissions(claims).has(permission);
}

/** The person's highest-ranked catalog role, or undefined when they hold none. */
export function primaryRole(roles: readonly string[] | undefined): PersonRole | undefined {
  return (roles ?? []).filter(isPersonRole).sort((a, b) => PERMISSION_CATALOG.roles[b].rank - PERMISSION_CATALOG.roles[a].rank)[0];
}

export function roleLabel(role: RoleName): string {
  return PERMISSION_CATALOG.roles[role].label;
}

/**
 * What a delegated agent call may do (`rules.agent_intersection`): the agent role ∩ the starting person's permissions,
 * or, with no verified person, the agent role minus `UNATTENDED_WITHHELD`.
 */
export function effectiveAgentPermissions(person: PermissionClaims | null): Set<Permission> {
  const agent = rolePermissions(AGENT_ROLE);
  if (!person) return new Set([...agent].filter((p) => !UNATTENDED_WITHHELD.includes(p)));
  const held = personPermissions(person);
  return new Set([...agent].filter((p) => held.has(p)));
}

/** "can't …" phrases for denial messages, one per catalog permission (test/permissions.test.ts checks coverage). */
export const PERMISSION_PHRASE: Readonly<Record<Permission, string>> = Object.freeze({
  "workspace:read": "see this workspace",
  "workspace:update": "change workspace settings",
  "workspace:delete": "delete the workspace",
  "member:read": "see the team",
  "member:invite": "invite people",
  "member:update_role": "change people's roles",
  "member:remove": "remove people",
  "billing:read": "see billing",
  "billing:manage": "manage billing",
  "security:read": "see security settings",
  "security:manage": "manage security and agent operations",
  "audit:read": "read the audit log",
  "api_token:read": "see API tokens",
  "api_token:create": "create API tokens",
  "api_token:revoke": "revoke API tokens",
  "integration:read": "see connected channels and accounts",
  "integration:connect": "connect channels or ad accounts",
  "integration:disconnect": "disconnect channels or ad accounts",
  "webhook:read": "see webhooks",
  "webhook:manage": "manage webhooks",
  "brand:read": "read the brand kit",
  "brand:update": "change the brand kit",
  "playbook:read": "read playbooks",
  "playbook:create": "create playbooks",
  "playbook:update": "change playbooks",
  "playbook:delete": "delete playbooks",
  "content:read": "see content",
  "content:create": "make content",
  "content:update": "change or retry content",
  "content:delete": "delete content",
  "content:approve": "approve or reject content",
  "content:publish": "publish content",
  "campaign:read": "see campaigns",
  "campaign:create": "create campaigns",
  "campaign:update": "change campaigns",
  "campaign:launch": "launch campaigns",
  "campaign:pause": "pause campaigns",
  "campaign:delete": "delete campaigns",
  "spend:read": "see spend",
  "spend:approve": "approve spending",
  "spend:set_limits": "change spend limits",
  "analytics:read": "read analytics",
  "agent:chat": "work with the agents",
  "agent:approve": "decide agent approvals",
  "memory:read": "read what Marketer remembers",
  "memory:confirm": "confirm what Marketer remembers",
  "memory:forget": "make Marketer forget things",
});

/** "an owner, admin or marketer": who to ask for `permission`. */
export function whoCan(permission: Permission): string {
  const labels = rolesGranting(permission).map((role) => roleLabel(role).toLowerCase());
  if (labels.length === 0) return "a workspace owner";
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  return `${/^[aeiou]/.test(list ?? "") ? "an" : "a"} ${list}`;
}
