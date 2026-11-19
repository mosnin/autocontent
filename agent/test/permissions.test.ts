/**
 * Workspace roles in the agent harness (docs/auth/agent.md): the catalog copy, who may decide approvals by id, the
 * actor on every backend call, and early permission checks on Marketer tools.
 */
import { readFileSync } from "node:fs";
import { agentInstanceId, ApprovalStore, type AnyAgentTool, CORE_MIGRATIONS, conversationInstanceId, createSessionToken, harnessSessionKey, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, type TenantSecurityContext, ToolExecutor } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { createApprovalRoutes } from "@agent-starter/flue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appApiTools } from "../src/in-app/app-api.ts";
import { APPROVAL_DECIDER_ROLES, OBSERVER_ROLES, OPERATOR_ROLES } from "../src/lib/access.ts";
import {
  ALL_PERMISSIONS,
  effectiveAgentPermissions,
  hasScope,
  isPermission,
  PERMISSION_CATALOG,
  PERMISSION_PHRASE,
  personPermissions,
  personRolesAndScopes,
  rolePermissions,
  rolesGranting,
  whoCan,
} from "../src/lib/permissions.ts";
import { type Actor, actorDispatch, actorPolicy, delegatedActor, personActor, toolDenial, withActor } from "../src/marketer/actor.ts";
import { DEPARTMENT_TOOLS, persistentReadTools } from "../src/marketer/tools/index.ts";
import { TOOL_PERMISSIONS } from "../src/marketer/tools/permissions.ts";
import { createProposeNextMovesTool } from "../src/marketer/tools/proposals.ts";
import { busConversationId, roomConversationId } from "../src/multi-agent/roster.ts";

const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
const PERSON_ROLES = ["owner", "admin", "marketer", "analyst", "billing"] as const;

/** Every tool defined under src/marketer/tools/** (departments, the autopilot's reads and its proposal tool). */
function marketerTools(): AnyAgentTool[] {
  const byName = new Map<string, AnyAgentTool>();
  for (const tools of Object.values(DEPARTMENT_TOOLS)) for (const tool of tools()) byName.set(tool.name, tool);
  for (const tool of [...persistentReadTools(), createProposeNextMovesTool(async () => ({ delivered: true }) as never), ...appApiTools().filter((t) => t.name !== "navigate_ui")]) byName.set(tool.name, tool);
  return [...byName.values()];
}

const actorFor = (role: string, id = `person_${role}`): Actor => personActor({ userId: id, ...personRolesAndScopes([role]), roles: [role] }) as Actor;

describe("the permission catalog (docs/auth/permissions.json)", () => {
  it("is an exact copy of the shared JSON file", () => {
    const shared = JSON.parse(readFileSync(new URL("../../docs/auth/permissions.json", import.meta.url), "utf8")) as unknown;
    expect(JSON.parse(JSON.stringify(PERMISSION_CATALOG))).toEqual(shared);
  });

  it("derives role permissions, the roles granting a permission, and a phrase for every permission", () => {
    expect(ALL_PERMISSIONS).toHaveLength(Object.values(PERMISSION_CATALOG.resources).reduce((n, a) => n + a.length, 0));
    expect(rolePermissions("owner").size).toBe(ALL_PERMISSIONS.length);
    expect(rolePermissions("operator").size).toBe(0);
    expect(rolesGranting("agent:approve")).toEqual(["owner", "admin", "marketer"]);
    expect(rolesGranting("security:manage")).toEqual(["owner", "admin"]);
    expect(rolesGranting("workspace:delete")).toEqual(["owner"]);
    // The system role never shows up as a person who can be asked.
    expect(rolesGranting("agent:chat")).not.toContain("agent");
    for (const permission of ALL_PERMISSIONS) expect(PERMISSION_PHRASE[permission], permission).toMatch(/^[a-z]/);
    expect(Object.keys(PERMISSION_PHRASE).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(whoCan("campaign:launch")).toBe("an owner, admin or marketer");
    expect(whoCan("workspace:delete")).toBe("an owner");
  });

  it("hasScope needs a person role that grants it AND the scope in the token; unknown roles add nothing", () => {
    const marketer = personRolesAndScopes(["marketer"]);
    expect(hasScope(marketer, "campaign:launch")).toBe(true);
    expect(hasScope(marketer, "spend:set_limits")).toBe(false);
    // A scope the role does not grant is ignored, and a role without the scope gets nothing.
    expect(hasScope({ roles: ["analyst"], scopes: ["campaign:launch"] }, "campaign:launch")).toBe(false);
    expect(hasScope({ roles: ["admin"], scopes: [] }, "security:manage")).toBe(false);
    // Roles the catalog does not know (the old starter "operator", "security") and the agent system role give nothing.
    expect(hasScope({ roles: ["operator"], scopes: ["security:manage"] }, "security:manage")).toBe(false);
    expect(hasScope({ roles: ["agent"], scopes: ["content:read"] }, "content:read")).toBe(false);
    expect(hasScope(null, "content:read")).toBe(false);
    expect(personRolesAndScopes(["operator", "owner", 7])).toEqual({ roles: ["owner"], scopes: [...ALL_PERMISSIONS] });
  });

  it("caps delegated calls at agent ∩ the person, and withholds money moves when no person started the run", () => {
    const agent = rolePermissions("agent");
    for (const role of PERSON_ROLES) {
      const effective = effectiveAgentPermissions(personRolesAndScopes([role]));
      for (const p of effective) expect(agent.has(p) && rolePermissions(role).has(p), `${role} ${p}`).toBe(true);
    }
    expect(effectiveAgentPermissions(personRolesAndScopes(["analyst"])).has("campaign:launch")).toBe(false);
    expect(effectiveAgentPermissions(personRolesAndScopes(["marketer"])).has("campaign:launch")).toBe(true);
    const unattended = effectiveAgentPermissions(null);
    expect(unattended.has("spend:approve")).toBe(false);
    expect(unattended.has("campaign:launch")).toBe(false);
    expect(unattended.has("content:create")).toBe(true);
    expect(effectiveAgentPermissions({ roles: ["operator"], scopes: [...ALL_PERMISSIONS] }).size).toBe(0);
  });
});

describe("role-gated routes are catalog permissions", () => {
  it("maps decide-by-id to agent:approve, operator controls to security:manage, oversight to audit:read", () => {
    expect(APPROVAL_DECIDER_ROLES).toEqual(["owner", "admin", "marketer"]);
    expect(OPERATOR_ROLES).toEqual(["owner", "admin"]);
    expect(OBSERVER_ROLES).toEqual(["owner", "admin"]);
    for (const roles of [APPROVAL_DECIDER_ROLES, OPERATOR_ROLES, OBSERVER_ROLES]) {
      expect(roles).not.toContain("operator");
      expect(roles).not.toContain("agent");
      expect(roles).not.toContain("visitor");
    }
  });

  describe("decide an approval by id (finding 15)", () => {
    const SESSION = "session-secret-for-approval-tests";
    const APPROVAL = "approval-secret-for-approval-tests";
    const conversation = agentInstanceId("strategist", "tenant_a", harnessSessionKey("dlg", "abc123"));
    const sent: unknown[] = [];
    const routes = createApprovalRoutes({
      agents: [{ agentName: "strategist" } as never],
      operatorRoles: APPROVAL_DECIDER_ROLES,
      secret: () => APPROVAL,
      sessionSecret: () => [SESSION],
      dispatch: async (_agent, request) => void sent.push(request),
    });
    const decide = async (claims: { roles: string[]; scopes: string[] }, tid = "tenant_a") => {
      const token = await createSessionToken(SESSION, { sub: "person_1", tid, ...claims }, 600);
      return routes.request(`/approvals/by-id/${encodeURIComponent(conversation)}/apr_1`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
    };

    it("lets owners, admins and marketers decide, and refuses analysts, billing and roles outside the catalog", async () => {
      for (const role of ["owner", "admin", "marketer"]) {
        sent.length = 0;
        const res = await decide(personRolesAndScopes([role]));
        expect(res.status, role).toBe(202);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ id: conversation, message: { type: "tool-approval", attributes: { approver: "person_1", decision: "approve" } } });
      }
      sent.length = 0;
      for (const claims of [personRolesAndScopes(["analyst"]), personRolesAndScopes(["billing"]), { roles: ["operator"], scopes: [] }, { roles: ["agent"], scopes: [] }, { roles: [], scopes: [] }]) {
        expect((await decide(claims)).status, claims.roles.join() || "none").toBe(403);
      }
      // An owner of another workspace never decides this one.
      expect((await decide(personRolesAndScopes(["owner"]), "tenant_b")).status).toBe(403);
      expect(sent).toHaveLength(0);
    });
  });
});

describe("Marketer tools → permissions", () => {
  it("maps every tool under src/marketer/tools to a catalog permission, with no stale entries", () => {
    const names = marketerTools().map((t) => t.name);
    for (const name of names) expect(TOOL_PERMISSIONS[name], `${name} has no permission`).toBeDefined();
    for (const [tool, permission] of Object.entries(TOOL_PERMISSIONS)) {
      expect(isPermission(permission), `${tool}: ${permission}`).toBe(true);
      expect(names, `${tool} is mapped but no such tool exists`).toContain(tool);
    }
  });

  it("names the tools the agent role can never run (they need a person in the app)", () => {
    const agent = rolePermissions("agent");
    const outside = Object.entries(TOOL_PERMISSIONS).filter(([, p]) => !agent.has(p)).map(([t]) => t).sort();
    // A deliberate list: changing it is a decision about the agent role (docs/auth/agent.md, "Tools the agent can't run").
    expect(outside).toEqual(["connect_ad_account", "set_playbook_spend_cap", "start_channel_connection", "update_brand_kit"]);
  });

  it("maps writes to the permission that guards them", () => {
    expect(TOOL_PERMISSIONS).toMatchObject({
      start_campaign: "campaign:launch",
      activate_ad_campaign: "campaign:launch",
      set_ad_budget: "spend:approve",
      decide_ad_approval: "spend:approve",
      approve_video: "content:approve",
      decide_inbox_item: "content:approve",
      update_brand_kit: "brand:update",
      create_video: "content:create",
      set_playbook_spend_cap: "spend:set_limits",
    });
  });
});

describe("the actor", () => {
  it("is the person behind their own conversation, never a harness identity, visitor or eval run", () => {
    expect(personActor({ userId: "usr_123", roles: ["analyst"], scopes: ["content:read"] })).toEqual({ id: "usr_123", roles: ["analyst"], scopes: ["content:read"] });
    for (const userId of ["agent:assistant", "system:dispatch", "room:room--t--k", "visitor_abc", "eval:case-1", "anonymous"]) expect(personActor({ userId, roles: [] }), userId).toBeNull();
    expect(personActor({ userId: "usr_1", roles: ["agent"] })).toBeNull();
    expect(personActor({ userId: "usr_1", roles: ["visitor"] })).toBeNull();
    // Not a safe header value: no actor at all.
    expect(personActor({ userId: "usr 1\r\nx-evil: 1", roles: ["owner"] })).toBeNull();
  });

  it("reaches a department only in a delegated task created by an agent's dispatch", () => {
    const stamped = { tenantId: "tenant_a", userId: "agent:assistant", roles: ["agent"], actor: { id: "usr_9", roles: ["marketer"], scopes: ["campaign:launch"] } };
    const delegated = agentInstanceId("distribution-manager", "tenant_a", harnessSessionKey("dlg", "abc123"));
    expect(delegatedActor(delegated, stamped)).toEqual({ id: "usr_9", roles: ["marketer"], scopes: ["campaign:launch"] });
    // Bus and room conversations never carry a person, whatever their initialData says.
    expect(delegatedActor(busConversationId("distribution-manager", "tenant_a", "k"), stamped)).toBeNull();
    expect(delegatedActor(roomConversationId("distribution-manager", { roomId: "room--tenant_a--k", tenantId: "tenant_a" }), stamped)).toBeNull();
    // Only a conversation the harness created for an agent; never a person-owned id.
    expect(delegatedActor(delegated, { ...stamped, userId: "usr_evil", roles: ["owner"] })).toBeNull();
    expect(delegatedActor(conversationInstanceId("distribution-manager", "tenant_a", "usr_9", "main"), stamped)).toBeNull();
    // A stamped actor still has to look like a person.
    expect(delegatedActor(delegated, { ...stamped, actor: { id: "agent:assistant", roles: ["owner"] } })).toBeNull();
    expect(delegatedActor(delegated, { ...stamped, actor: undefined })).toBeNull();
  });

  it("is stamped by the requester's dispatch on delegation signals only, from its render, not from the message", async () => {
    const seen: unknown[] = [];
    const dispatch = actorDispatch(async (_t, request) => void seen.push(request), actorFor("marketer", "usr_9"));
    const target = { agent: "strategist", conversationId: "x" };
    await dispatch(target, { message: { kind: "signal", type: "delegation", body: "b", attributes: { actor: '{"id":"evil"}' } }, initialData: { tenantId: "tenant_a", userId: "agent:assistant", roles: ["agent"] }, idempotencyKey: "k" });
    await dispatch(target, { message: { kind: "signal", type: "delegation-result", body: "b", attributes: {} }, initialData: { tenantId: "tenant_a", userId: "agent:assistant", roles: ["agent"] }, idempotencyKey: "k2" });
    expect((seen[0] as { initialData: { actor: Actor } }).initialData.actor).toMatchObject({ id: "usr_9", roles: ["marketer"] });
    expect((seen[1] as { initialData: Record<string, unknown> }).initialData.actor).toBeUndefined();
    // No person: the dispatch is passed through untouched.
    const base = async () => undefined;
    expect(actorDispatch(base, null)).toBe(base);
  });
});

describe("x-actor-id on backend calls", () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return Response.json({ ok: true });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const tenant: TenantSecurityContext = { tenantId: "tenant_a", userId: "agent:assistant", environment: "test", roles: ["agent"], scopes: [] };
  let seq = 0;
  async function run(tools: AnyAgentTool[], name: string, args: Record<string, unknown>, options: { policy?: ReturnType<typeof actorPolicy>; services?: Record<string, unknown>; tenant?: TenantSecurityContext } = {}) {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const executor = new ToolExecutor({ tools, approvals: new ApprovalStore(sql, "approval-secret"), idempotency: new SqlIdempotencyStore(sql), ...(options.policy ? { policy: options.policy } : {}) });
    seq++;
    return executor.execute(
      { id: `call_${seq}`, name, arguments: JSON.stringify(args) },
      { tenant: options.tenant ?? tenant, tenantConfig: SECURE_DEFAULT_TENANT_CONFIG, runId: "run_1", signal: new AbortController().signal, mode: "live", log: () => {}, services: { env: ENV, ...options.services } },
    );
  }
  const strategy = () => DEPARTMENT_TOOLS.strategist();

  it("is sent for a run a person started, with the service token and the tenant", async () => {
    const outcome = await run(withActor(strategy(), actorFor("analyst", "usr_42")), "list_playbooks", {});
    expect(outcome.status).toBe("ok");
    expect(calls[0]?.headers).toMatchObject({ "x-actor-id": "usr_42", "x-tenant-id": "tenant_a", authorization: `Bearer ${ENV.SAAS_SERVICE_TOKEN}` });
  });

  it("is absent for background, autopilot, bus and room runs (no person)", async () => {
    await run(withActor(strategy(), null), "list_playbooks", {});
    await run(strategy(), "list_playbooks", {});
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call.headers["x-actor-id"]).toBeUndefined();
  });

  it("cannot be chosen by tool arguments or a forged services key", async () => {
    const tools = withActor(strategy(), actorFor("marketer", "usr_real"));
    await run(tools, "get_playbook", { playbookId: UUID, actor: "usr_evil", actorId: "usr_evil", "x-actor-id": "usr_evil" });
    expect(calls[0]?.headers["x-actor-id"]).toBe("usr_real");
    // A string key on services (anything a caller could serialise) is not the actor.
    await run(strategy(), "list_playbooks", {}, { services: { marketerActor: { id: "usr_evil", roles: ["owner"], scopes: [] }, actor: "usr_evil" } });
    expect(calls[1]?.headers["x-actor-id"]).toBeUndefined();
    // And the mounted actor replaces whatever an upstream wrapper (the MCP guard, a host) put on services.
    await run(withActor(strategy(), null), "list_playbooks", {}, { services: { marketerActor: "usr_evil" } });
    expect(calls[2]?.headers["x-actor-id"]).toBeUndefined();
  });
});

describe("early permission checks on Marketer tools", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return Response.json({ ok: true });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const tenant: TenantSecurityContext = { tenantId: "tenant_a", userId: "agent:distribution-manager", environment: "test", roles: ["agent"], scopes: [] };
  async function run(actor: Actor | null, name: string, args: Record<string, unknown>) {
    const sql = new NodeSqlStore();
    new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
    const all = Object.values(DEPARTMENT_TOOLS).flatMap((tools) => tools());
    const executor = new ToolExecutor({ tools: withActor(all, actor), approvals: new ApprovalStore(sql, "approval-secret"), idempotency: new SqlIdempotencyStore(sql), policy: actorPolicy(actor) });
    return executor.execute(
      { id: `call_${name}_${Math.random()}`, name, arguments: JSON.stringify(args) },
      { tenant, tenantConfig: SECURE_DEFAULT_TENANT_CONFIG, runId: "run_1", signal: new AbortController().signal, mode: "live", log: () => {}, services: { env: ENV } },
    );
  }

  it("denies a write the role lacks with a plain sentence, before any approval parks, and sends nothing", async () => {
    const outcome = await run(actorFor("analyst"), "start_campaign", { campaignId: UUID, reason: "Launch the spring campaign" });
    expect(outcome.status).toBe("denied");
    expect(outcome.text).toContain("DENIED: Your role (Analyst) can't launch campaigns. Ask an owner, admin or marketer.");
    expect(calls).toHaveLength(0);
  });

  it("lets a role that holds the permission through to the normal pipeline (HIGH still parks for approval)", async () => {
    expect((await run(actorFor("marketer"), "start_campaign", { campaignId: UUID, reason: "Launch the spring campaign" })).status).toBe("approval_required");
    expect((await run(actorFor("marketer"), "create_video", { playbookId: UUID, platform: "tiktok" })).status).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("denies per role, reads included", async () => {
    const cases: Array<[string, string, Record<string, unknown>, string | null]> = [
      ["analyst", "get_spend_today", {}, null],
      ["analyst", "create_video", { playbookId: UUID, platform: "tiktok" }, "Your role (Analyst) can't make content."],
      ["analyst", "approve_video", { videoId: UUID, reason: "Looks good to post" }, "Your role (Analyst) can't approve or reject content."],
      ["billing", "list_playbooks", {}, "Your role (Billing) can't read playbooks. Ask an owner, admin, marketer or analyst."],
      ["billing", "get_spend_today", {}, null],
      // The agent role has brand:read only, so nobody changes the brand kit through the agent (a marketer can in the app).
      ["marketer", "update_brand_kit", { brandName: "A", tagline: "B", toneOfVoice: "C", targetAudience: "D", bannedWords: [], preferredHashtags: [], reason: "Rebrand for spring" }, "The Marketer agent can't change the brand kit for anyone"],
      ["marketer", "set_ad_budget", { campaignId: UUID, dailyBudgetUsd: 20, currentDailyBudgetUsd: 10, reason: "Scale the winner" }, null],
      ["admin", "set_playbook_spend_cap", { playbookId: UUID, dailySpendCapUsd: 50, reason: "More output" }, "The Marketer agent can't change spend limits for anyone"],
      ["owner", "start_channel_connection", {}, "The Marketer agent can't connect channels or ad accounts for anyone"],
    ];
    for (const [role, tool, args, denial] of cases) {
      const outcome = await run(actorFor(role), tool, args);
      if (denial === null) expect(["ok", "approval_required"], `${role} ${tool}: ${outcome.text}`).toContain(outcome.status);
      else {
        expect(outcome.status, `${role} ${tool}`).toBe("denied");
        expect(outcome.text, `${role} ${tool}`).toContain(denial);
      }
    }
  });

  it("gives a session with no catalog role nothing, and an unattended run no money moves", async () => {
    const legacy = personActor({ userId: "usr_old", roles: ["operator"], scopes: [...ALL_PERMISSIONS] });
    const read = await run(legacy, "list_playbooks", {});
    expect(read.status).toBe("denied");
    expect(read.text).toContain("Your session has no workspace role, so you can't read playbooks.");
    const money = await run(null, "set_ad_budget", { campaignId: UUID, dailyBudgetUsd: 20, currentDailyBudgetUsd: 10, reason: "Scale the winner" });
    expect(money.status).toBe("denied");
    expect(money.text).toContain("No signed-in person started this run, so the agent can't approve spending (it moves money).");
    expect((await run(null, "start_campaign", { campaignId: UUID, reason: "Launch the spring campaign" })).text).toContain("can't launch campaigns");
    expect((await run(null, "create_video", { playbookId: UUID, platform: "tiktok" })).status).toBe("ok");
    expect((await run(null, "list_playbooks", {})).status).toBe("ok");
  });

  it("re-checks inside the tool when no policy is composed (defense in depth)", async () => {
    const [tool] = withActor(DEPARTMENT_TOOLS["distribution-manager"]().filter((t) => t.name === "start_campaign"), actorFor("analyst"));
    await expect(
      tool?.execute({ campaignId: UUID, reason: "Launch the spring campaign" } as never, { tenant, tenantConfig: SECURE_DEFAULT_TENANT_CONFIG, runId: "r", toolCallId: "c", idempotencyKey: "k", signal: new AbortController().signal, mode: "live", log: () => {}, services: { env: ENV } } as never),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED", kind: "denied" });
    expect(calls).toHaveLength(0);
    expect(toolDenial("navigate_ui", actorFor("billing"))).toBeNull();
  });

  it("checks person permissions as role AND scope", () => {
    expect(personPermissions({ roles: ["marketer"], scopes: ["campaign:launch", "security:manage"] })).toEqual(new Set(["campaign:launch"]));
  });
});
