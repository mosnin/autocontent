/**
 * The actor through the real Flue runtime (scripted model): a person's conversation and a delegated department task
 * mount Marketer tools with `withActor` + `actorPolicy`, exactly as src/agents/* do, and the backend call carries
 * x-actor-id; a role that lacks the permission is refused before an approval parks or anything is sent.
 */
import { type AnyAgentTool, agentInstanceId, conversationInstanceId, defineAgentTool, harnessSessionKey } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { useAgentStarter } from "@agent-starter/flue";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { type AgentProps, init } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { personRolesAndScopes } from "../src/lib/permissions.ts";
import { actorPolicy, withActor } from "../src/marketer/actor.ts";
import { useDelegatedActor, usePersonActor } from "../src/marketer/actor-hooks.ts";
import { DEPARTMENT_TOOLS } from "../src/marketer/tools/index.ts";

const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const sql = new NodeSqlStore();

/** Node has no Worker env: hand the tools the API settings the way the MCP guard does. */
const withEnv = (tools: AnyAgentTool[]): AnyAgentTool[] =>
  tools.map((tool) => defineAgentTool({ ...tool, execute: (args: unknown, ctx) => tool.execute(args as never, { ...ctx, services: { ...ctx.services, env: ENV } }) }) as unknown as AnyAgentTool);
const marketing = () => withEnv([...DEPARTMENT_TOOLS.strategist(), ...DEPARTMENT_TOOLS["distribution-manager"]()]);
const common = { model: { primary: "faux/faux-1", firstLine: "faux/faux-1", compaction: false as const }, approvals: { secret: () => "test-approval-secret", baseUrl: () => "https://agents.test" }, toolMasking: false as const, confidence: false, sql: () => sql };

function PersonAgent({ id }: AgentProps) {
  const actor = usePersonActor();
  useAgentStarter({ id, agentName: "person-agent", ...common, tools: withActor(marketing(), actor), policy: actorPolicy(actor) });
  return "You help with marketing.";
}
PersonAgent.agentName = "person-agent";

function DepartmentAgent({ id }: AgentProps) {
  const actor = useDelegatedActor(id);
  useAgentStarter({ id, agentName: "department-agent", ...common, tools: withActor(marketing(), actor), policy: actorPolicy(actor) });
  return "You are a department.";
}
DepartmentAgent.agentName = "department-agent";

const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
let flue: Awaited<ReturnType<typeof start>>;
const calls: Array<{ url: string; headers: Record<string, string> }> = [];
beforeAll(async () => {
  flue = await start({ agents: [PersonAgent, DepartmentAgent], providers: [faux.provider] });
});
afterAll(async () => {
  await flue.stop();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return Response.json([]);
    }),
  );
});

const person = (role: string, userId: string) => ({ tenantId: "tenant_a", userId, environment: "test" as const, ...personRolesAndScopes([role]) });

describe("actor in the Flue runtime", () => {
  it("sends x-actor-id from the person's verified session", async () => {
    faux.setResponses([fauxAssistantMessage([fauxToolCall("list_playbooks", {}, { id: "c1" })], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("You have no playbooks."))]);
    const agent = init(PersonAgent, { id: conversationInstanceId("person-agent", "tenant_a", "usr_42", "s1") });
    await agent.read(await agent.dispatch({ message: "Which playbooks do we have?", initialData: person("analyst", "usr_42") }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({ "x-actor-id": "usr_42", "x-tenant-id": "tenant_a" });
  });

  it("refuses an analyst's campaign launch before it parks or sends anything", async () => {
    faux.setResponses([fauxAssistantMessage([fauxToolCall("start_campaign", { campaignId: UUID, reason: "Launch it now please" }, { id: "c2" })], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("I can't launch it."))]);
    const id = conversationInstanceId("person-agent", "tenant_a", "usr_43", "s1");
    const agent = init(PersonAgent, { id });
    await agent.read(await agent.dispatch({ message: "Launch the spring campaign", initialData: person("analyst", "usr_43") }));
    expect(calls).toHaveLength(0);
    expect(Number(sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM as_approvals WHERE run_id = ?`, id)[0]?.n ?? 0)).toBe(0);
    // Denied at the policy step (the analyst's role), not an argument error or a parked approval.
    const audit = sql.exec<{ action: string; target: string }>(`SELECT action, target FROM as_audit_log WHERE run_id = ?`, id);
    expect(audit).toContainEqual({ action: "tool.denied", target: "start_campaign" });
  });

  it("carries the stamped person in a delegated department task, and nobody in a bus conversation", async () => {
    const stamped = { tenantId: "tenant_a", userId: "agent:assistant", roles: ["agent"], actor: { id: "usr_9", ...personRolesAndScopes(["marketer"]) } };
    faux.setResponses([fauxAssistantMessage([fauxToolCall("list_playbooks", {}, { id: "c3" })], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("Done."))]);
    const delegated = init(DepartmentAgent, { id: agentInstanceId("department-agent", "tenant_a", harnessSessionKey("dlg", "t1")) });
    await delegated.read(await delegated.dispatch({ message: "List playbooks", initialData: stamped }));
    faux.setResponses([fauxAssistantMessage([fauxToolCall("list_playbooks", {}, { id: "c4" })], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("Done."))]);
    const bus = init(DepartmentAgent, { id: agentInstanceId("department-agent", "tenant_a", harnessSessionKey("bus", "k")) });
    await bus.read(await bus.dispatch({ message: "List playbooks", initialData: stamped }));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["x-actor-id"]).toBe("usr_9");
    expect(calls[1]?.headers["x-actor-id"]).toBeUndefined();
  });
});
