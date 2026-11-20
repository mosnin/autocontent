/**
 * Braintrust observability, agent side (docs/observability/braintrust.md): the exporter is off unless configured,
 * sends OTLP to the documented endpoint with the documented headers, masks every attribute with one function (secrets,
 * emails, phones, cards, secret-named attributes; personal memory never leaves), honours the content mode and the
 * workspace override, never throws or blocks a reply, and the feedback route authorizes thumbs by conversation and
 * tenant. Fetch is stubbed everywhere: no network.
 */
import { conversationInstanceId, createSessionToken, MemoryKeyValueStore, type SpanData } from "@agent-starter/core";
import { FlueTraceRecorder } from "@agent-starter/flue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentTraceSpanId, recordDecisionCall, recordRunScore, resetRunAnnotations, setRunIdentity, takeRunAnnotations, trackObservation, traceSpanIdFor } from "../src/lib/braintrust/annotations.ts";
import { braintrustConfig, braintrustHeaders, parseContentMode, tracesEndpoint } from "../src/lib/braintrust/config.ts";
import { BraintrustSpanExporter, braintrustExportStats, resetBraintrustExportStats } from "../src/lib/braintrust/exporter.ts";
import { createFeedbackRoute, rememberRunSpan, runSpanKey } from "../src/lib/braintrust/feedback.ts";
import { isSecretKey, maskSpan, maskString, maskText, MEMORY_TOOL_PLACEHOLDER } from "../src/lib/braintrust/mask.ts";
import { clearWorkspaceContentCache, SETTINGS_PATH, workspaceContentMode } from "../src/lib/braintrust/settings.ts";
import { decide } from "../src/marketer/decisions/run.ts";
import { renderRecall } from "../src/marketer/recall/recall.ts";
import { personRolesAndScopes } from "../src/lib/permissions.ts";
import { promptfooRows, runConformanceSuite, SUITE, uploadExperiment } from "../scripts/braintrust-evals.ts";

// Obviously fake values: none of these is a real credential or a real person.
const FAKE_KEY = "bt-test-key-not-real";
const PROJECT = "11111111-2222-3333-4444-555555555555";
const ENV = { BRAINTRUST_API_KEY: FAKE_KEY, BRAINTRUST_PROJECT_ID: PROJECT };
const CONFIG = braintrustConfig(ENV)!;
const TENANT = "tenant_a";
const PERSON = "person_1";
const CONVERSATION = conversationInstanceId("assistant", TENANT, PERSON, "s1");
const SUBMISSION = "sub_1";
const PERSONAL_NOTE = "PERSONAL-NOTE-likes-hiking-with-dog-rex";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function okFetch(body: unknown = {}, status = 200) {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function span(partial: Partial<SpanData> & Pick<SpanData, "spanId" | "name" | "kind">): SpanData {
  return { traceId: "a".repeat(32), startTime: 1_000, endTime: 2_000, status: "ok", attributes: {}, events: [], ...partial };
}

/** A run trace as the Flue trace recorder writes it: root, a model turn, a tool call, a memory tool call. */
function runTrace(extra: { prompt?: string; toolResult?: string } = {}): SpanData[] {
  const base = { "agent.tenant_id": TENANT, "agent.run_id": CONVERSATION, "agent.name": "assistant" };
  return [
    span({
      spanId: "b".repeat(16),
      parentSpanId: "1".repeat(16),
      name: "chat openai/test-model",
      kind: "llm",
      attributes: {
        ...base,
        "gen_ai.system": "openai",
        "gen_ai.request.model": "openai/test-model",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 30,
        "agent.cost_usd": 0.0012,
        "gen_ai.prompt":
          extra.prompt ??
          JSON.stringify({
            system: "You are Marketer.",
            messages: [
              { role: "user", content: "Email me at jane.doe@example.com or call +1 415 555 0134. Card 4242 4242 4242 4242." },
              { role: "user", content: renderRecall([{ scope: "personal", text: PERSONAL_NOTE, score: 0.9 }]) },
              { role: "assistant", content: "", toolCalls: [{ name: "recall_memory", arguments: { query: "hobbies of the person" } }] },
              { role: "tool", name: "recall_memory", content: JSON.stringify({ facts: [], recalled: [{ scope: "personal", text: PERSONAL_NOTE }] }) },
            ],
            tools: ["get_workspace_overview", "recall_memory"],
          }),
        "gen_ai.completion": "Here is the plan.",
      },
    }),
    span({
      spanId: "c".repeat(16),
      parentSpanId: "1".repeat(16),
      name: "tool:get_workspace_overview",
      kind: "tool",
      attributes: {
        ...base,
        "gen_ai.tool.name": "get_workspace_overview",
        "gen_ai.tool.arguments": JSON.stringify({ window: "7d", api_key: "fake-value-not-a-key", nested: { authorization: "Basic not-real" } }),
        "gen_ai.tool.result": extra.toolResult ?? JSON.stringify({ spend: 12.5, owner: "owner@example.com", note: "password: correct-horse-battery" }),
        authorization: "Bearer not-a-real-token-value",
        "http.cookie": "session=abc",
      },
    }),
    span({
      spanId: "d".repeat(16),
      parentSpanId: "1".repeat(16),
      name: "tool:recall_memory",
      kind: "tool",
      attributes: { ...base, "gen_ai.tool.name": "recall_memory", "gen_ai.tool.arguments": JSON.stringify({ query: "hobbies" }), "gen_ai.tool.result": JSON.stringify({ facts: [{ id: "f1" }], recalled: [{ scope: "personal", text: PERSONAL_NOTE }, { scope: "team", text: "team fact" }] }) },
    }),
    span({
      spanId: "1".repeat(16),
      name: "agent assistant",
      kind: "agent",
      attributes: { ...base, "flue.submission_id": SUBMISSION, "agent.event.payload": "What did I tell you about my weekend? I'm at jane.doe@example.com", "gen_ai.completion": "You mentioned hiking." },
    }),
  ];
}

const attr = (s: { attributes: Array<{ key: string; value: Record<string, unknown> }> }, key: string) => {
  const v = s.attributes.find((a) => a.key === key)?.value;
  return v ? (v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue) : undefined;
};
type OtlpSpan = { spanId: string; parentSpanId?: string; name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> };
const otlpSpans = (body: string): OtlpSpan[] => (JSON.parse(body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: OtlpSpan[] }> }> }).resourceSpans[0]!.scopeSpans[0]!.spans;

beforeEach(() => {
  resetRunAnnotations();
  resetBraintrustExportStats();
  clearWorkspaceContentCache();
});
afterEach(() => vi.restoreAllMocks());

describe("configuration", () => {
  it("is off unless both the key and the project id are set", () => {
    expect(braintrustConfig({})).toBeUndefined();
    expect(braintrustConfig({ BRAINTRUST_API_KEY: FAKE_KEY })).toBeUndefined();
    expect(braintrustConfig({ BRAINTRUST_PROJECT_ID: PROJECT })).toBeUndefined();
    expect(braintrustConfig({ BRAINTRUST_API_KEY: " ", BRAINTRUST_PROJECT_ID: PROJECT })).toBeUndefined();
    expect(braintrustConfig(ENV)).toEqual({ apiUrl: "https://api.braintrust.dev", apiKey: FAKE_KEY, projectId: PROJECT, content: "redacted" });
  });

  it("builds the documented endpoint and headers, for any region", () => {
    expect(tracesEndpoint(CONFIG)).toBe("https://api.braintrust.dev/otel/v1/traces");
    expect(tracesEndpoint(braintrustConfig({ ...ENV, BRAINTRUST_API_URL: "https://api-eu.braintrust.dev/" })!)).toBe("https://api-eu.braintrust.dev/otel/v1/traces");
    expect(braintrustHeaders(CONFIG)).toEqual({ authorization: `Bearer ${FAKE_KEY}`, "x-bt-parent": `project_id:${PROJECT}` });
  });

  it("reads the content mode fail-safe: unknown values mean metadata", () => {
    expect(parseContentMode(undefined)).toBe("redacted");
    expect(parseContentMode("")).toBe("redacted");
    expect(parseContentMode("Redacted")).toBe("redacted");
    expect(parseContentMode("metadata")).toBe("metadata");
    expect(parseContentMode("full")).toBe("metadata");
  });
});

describe("masking (one function for every exported attribute)", () => {
  it("drops secret-named attributes and keys, keeps token counters", () => {
    for (const key of ["authorization", "cookie", "http.cookie", "token", "auth_token", "x-api-key", "api_key", "apiKey", "client_secret", "password", "clientSecret"]) expect(isSecretKey(key), key).toBe(true);
    for (const key of ["gen_ai.usage.input_tokens", "gen_ai.request.max_tokens", "agent.cost_usd", "gen_ai.prompt"]) expect(isSecretKey(key), key).toBe(false);
  });

  it("replaces secrets, emails, phone numbers and card numbers in text and JSON", () => {
    const text = maskText("mail jane.doe@example.com, call +1 415 555 0134, card 4242 4242 4242 4242, password: correct-horse-battery");
    expect(text).not.toMatch(/jane\.doe|555 0134|4242 4242|correct-horse/);
    const json = JSON.parse(maskString(JSON.stringify({ api_key: "fake-value-not-a-key", deep: { password: "x", note: "write to a@b.example" }, count: 3 }))) as Record<string, unknown>;
    expect(json).toEqual({ deep: { note: "write to [REDACTED_EMAIL]" }, count: 3 });
  });

  it("masks JSON cut by truncation too", () => {
    const cut = `${JSON.stringify({ api_key: "fake-value-not-a-key", mail: "jane.doe@example.com", filler: "x".repeat(50) })}`.slice(0, 70);
    const out = maskString(cut);
    expect(out).not.toContain("fake-value-not-a-key");
    expect(out).not.toContain("jane.doe@example.com");
  });

  it("never exports recall or personal memory content, in any shape", () => {
    const exported = runTrace().map((s) => maskSpan(s, "redacted"));
    const all = JSON.stringify(exported);
    expect(all).not.toContain(PERSONAL_NOTE);
    expect(all).not.toContain("hobbies of the person");
    // Recall spans carry counts and scope kinds only.
    const recallTool = exported.find((s) => s.name === "tool:recall_memory")!;
    expect(JSON.parse(String(recallTool.attributes["gen_ai.tool.result"]))).toEqual({ omitted: "memory", facts: 1, recalled: { personal: 1, team: 1 } });
    expect(recallTool.attributes["gen_ai.tool.arguments"]).toBe(MEMORY_TOOL_PLACEHOLDER);
  });

  it("drops a truncated prompt that references a memory tool or holds an unterminated memory block", () => {
    const cut = JSON.stringify({ system: "s", messages: [{ role: "tool", name: "recall_memory", content: PERSONAL_NOTE.repeat(20) }] }).slice(0, 120);
    expect(maskString(cut)).toBe(MEMORY_TOOL_PLACEHOLDER);
    const block = renderRecall([{ scope: "personal", text: PERSONAL_NOTE, score: 1 }]);
    expect(maskText(`before ${block.slice(0, block.length - 30)}`)).not.toContain(PERSONAL_NOTE);
  });

  it("metadata mode keeps no prompt, output, payload, tool input or output, or error text", () => {
    const trace = runTrace();
    trace[1]!.status = "error";
    trace[1]!.statusMessage = "tool failed: jane.doe@example.com";
    const exported = trace.map((s) => maskSpan(s, "metadata"));
    const all = JSON.stringify(exported);
    for (const text of ["Marketer", "plan", "hiking", "weekend", "spend", "window", PERSONAL_NOTE, "tool failed"]) expect(all, text).not.toContain(text);
    const llm = exported[0]!;
    expect(llm.attributes).toMatchObject({ "gen_ai.request.model": "openai/test-model", "gen_ai.usage.input_tokens": 120, "gen_ai.usage.output_tokens": 30, "agent.cost_usd": 0.0012 });
    expect(exported[1]!.attributes["gen_ai.tool.name"]).toBe("get_workspace_overview");
  });
});

describe("Braintrust exporter", () => {
  it("is not in traceExporters while unconfigured, and is once configured", async () => {
    const { traceExporters } = await import("../src/lib/platform.ts");
    const base = { SERVICE_NAME: "marketer-agents-test", CODE_VERSION: "1.2.3" };
    expect(traceExporters(base as never).some((e) => e instanceof BraintrustSpanExporter)).toBe(false);
    expect(traceExporters({ ...base, BRAINTRUST_API_KEY: FAKE_KEY } as never).some((e) => e instanceof BraintrustSpanExporter)).toBe(false);
    expect(traceExporters({ ...base, ...ENV } as never).filter((e) => e instanceof BraintrustSpanExporter)).toHaveLength(1);
  });

  it("POSTs masked OTLP to the endpoint with the headers, the deterministic root id, identity and scores", async () => {
    const { fetch, calls } = okFetch({});
    setRunIdentity(CONVERSATION, { actorId: PERSON, role: "marketer" });
    trackObservation({ type: "submission_running", submissionId: SUBMISSION }, CONVERSATION);
    recordRunScore(CONVERSATION, "approval", 1);
    const exporter = new BraintrustSpanExporter({ config: CONFIG, serviceName: "marketer-agents-test", release: "1.2.3", annotations: takeRunAnnotations, fetch });
    await exporter.export(runTrace());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.braintrust.dev/otel/v1/traces");
    expect(calls[0]!.headers).toMatchObject({ authorization: `Bearer ${FAKE_KEY}`, "x-bt-parent": `project_id:${PROJECT}`, "content-type": "application/json" });
    expect(calls[0]!.body).not.toContain(PERSONAL_NOTE);
    expect(calls[0]!.body).not.toContain("jane.doe@example.com");
    expect(calls[0]!.body).not.toContain("fake-value-not-a-key");
    expect(calls[0]!.body).not.toContain("not-a-real-token-value");

    const spans = otlpSpans(calls[0]!.body);
    const root = spans.find((s) => !s.parentSpanId)!;
    const expectedId = traceSpanIdFor(CONVERSATION, SUBMISSION);
    expect(root.spanId).toBe(expectedId);
    expect(currentTraceSpanId(CONVERSATION)).toBe(expectedId);
    expect(spans.filter((s) => s.parentSpanId).every((s) => s.parentSpanId === expectedId)).toBe(true);
    expect({ agent: attr(root, "agent"), tenant: attr(root, "tenant_id"), actor: attr(root, "actor_id"), conversation: attr(root, "conversation_id"), role: attr(root, "role"), env: attr(root, "env"), release: attr(root, "release") }).toEqual({
      agent: "assistant",
      tenant: TENANT,
      actor: PERSON,
      conversation: CONVERSATION,
      role: "marketer",
      env: "marketer-agents-test",
      release: "1.2.3",
    });
    expect(JSON.parse(String(attr(root, "braintrust.scores")))).toEqual({ approval: 1, rails_blocked: 0 });
    expect(attr(root, "braintrust.input")).toContain("[REDACTED_EMAIL]");

    const llm = spans.find((s) => s.name.startsWith("chat"))!;
    expect(attr(llm, "gen_ai.operation.name")).toBe("chat");
    expect(attr(llm, "gen_ai.request.model")).toBe("openai/test-model");
    const messages = JSON.parse(String(attr(llm, "gen_ai.prompt_json"))) as Array<{ role: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "You are Marketer." });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "user", "assistant", "tool"]);
    const tool = spans.find((s) => s.name === "tool:get_workspace_overview")!;
    expect(attr(tool, "gen_ai.operation.name")).toBe("execute_tool");
    expect(tool.attributes.some((a) => a.key === "authorization" || a.key === "http.cookie")).toBe(false);
    expect(JSON.parse(String(attr(tool, "braintrust.input_json")))).toEqual({ window: "7d", nested: {} });
  });

  it("scores rails_blocked when a call was parked or refused, and decision_fallback with a GenAI span per decision call", async () => {
    const { fetch, calls } = okFetch({});
    trackObservation({ type: "submission_running", submissionId: SUBMISSION }, CONVERSATION);
    recordDecisionCall(CONVERSATION, { point: "routing", mode: "shadow", model: "vendor/decision-model-20260101", latencyMs: 300, cost: 0.0004, tokens: 90, fallbackUsed: true, failure: "timeout", at: 1_900 });
    const exporter = new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", annotations: takeRunAnnotations, fetch });
    await exporter.export(runTrace({ toolResult: JSON.stringify({ status: "PENDING_APPROVAL", approvalId: "apr_1" }) }));
    const spans = otlpSpans(calls[0]!.body);
    const root = spans.find((s) => !s.parentSpanId)!;
    expect(JSON.parse(String(attr(root, "braintrust.scores")))).toEqual({ decision_fallback: 1, rails_blocked: 1 });
    const decision = spans.find((s) => s.name === "decision routing")!;
    expect(decision.parentSpanId).toBe(root.spanId);
    expect({ op: attr(decision, "gen_ai.operation.name"), model: attr(decision, "gen_ai.request.model"), tokens: attr(decision, "gen_ai.usage.total_tokens"), point: attr(decision, "decision.point") }).toEqual({ op: "chat", model: "vendor/decision-model-20260101", tokens: "90", point: "routing" });
  });

  it("exports in metadata mode when the workspace says so, whatever the global setting", async () => {
    const { fetch, calls } = okFetch({});
    const workspace = vi.fn(async () => "metadata" as const);
    await new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", workspaceContent: workspace, fetch }).export(runTrace());
    expect(workspace).toHaveBeenCalledWith(TENANT);
    expect(calls[0]!.body).not.toContain("Here is the plan");
    expect(calls[0]!.body).not.toContain("You are Marketer");
    expect(calls[0]!.body).toContain("gen_ai.usage.input_tokens");
    const root = otlpSpans(calls[0]!.body).find((s) => !s.parentSpanId)!;
    expect(attr(root, "marketer.content_mode")).toBe("metadata");
    // A failing setting lookup means metadata too.
    const failing = okFetch({});
    await new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", workspaceContent: async () => Promise.reject(new Error("down")), fetch: failing.fetch }).export(runTrace());
    expect(failing.calls[0]!.body).not.toContain("Here is the plan");
  });

  it("never throws: network errors, HTTP errors and timeouts are logged once and dropped", async () => {
    const log = vi.fn();
    const down = vi.fn(async () => Promise.reject(new Error("connection refused"))) as unknown as typeof fetch;
    const exporter = new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch: down, log });
    await expect(exporter.export(runTrace())).resolves.toBeUndefined();
    await expect(exporter.export(runTrace())).resolves.toBeUndefined();
    const http = okFetch({ error: "nope" }, 500);
    await expect(new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch: http.fetch, log }).export(runTrace())).resolves.toBeUndefined();
    const hanging = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timed out"))))) as unknown as typeof fetch;
    await expect(new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch: hanging, log, timeoutMs: 20 }).export(runTrace())).resolves.toBeUndefined();
    expect(braintrustExportStats.failures).toBe(4);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain(FAKE_KEY);
  });

  it("counts spans rejected in a 200 (partialSuccess)", async () => {
    const log = vi.fn();
    const { fetch } = okFetch({ partialSuccess: { rejectedSpans: "2", errorMessage: "bad span" } });
    await new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch, log }).export(runTrace());
    await new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch, log }).export(runTrace());
    expect(braintrustExportStats.rejectedSpans).toBe(4);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never blocks the run: the recorder hands the export to waitUntil and returns", () => {
    const pending: Promise<unknown>[] = [];
    const hanging = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const recorder = new FlueTraceRecorder({ exporters: () => [new BraintrustSpanExporter({ config: CONFIG, serviceName: "svc", fetch: hanging })], waitUntil: (p) => void pending.push(p) });
    const context = { instanceId: CONVERSATION, agentName: "assistant", tenantId: TENANT, env: {} };
    recorder.record({ type: "submission_running", submissionId: SUBMISSION }, context);
    recorder.record({ type: "submission_settled", outcome: "completed" }, context);
    expect(recorder.openRuns()).toBe(0);
    expect(pending).toHaveLength(1);
  });
});

describe("workspace content setting", () => {
  const env = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "service-token-not-real" };

  it("reads the backend setting with the service token and the tenant, cached for 60 s", async () => {
    const { fetch, calls } = okFetch({ content: "redacted" });
    let now = 0;
    expect(await workspaceContentMode(env, TENANT, { fetch, now: () => now })).toBe("redacted");
    expect(await workspaceContentMode(env, TENANT, { fetch, now: () => now })).toBe("redacted");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.marketer.test${SETTINGS_PATH}`);
    expect(calls[0]!.headers).toMatchObject({ "x-tenant-id": TENANT, authorization: "Bearer service-token-not-real" });
    now = 61_000;
    await workspaceContentMode(env, TENANT, { fetch, now: () => now });
    expect(calls).toHaveLength(2);
  });

  it("treats anything unreadable as metadata", async () => {
    expect(await workspaceContentMode(env, "t_metadata", { fetch: okFetch({ content: "metadata" }).fetch })).toBe("metadata");
    expect(await workspaceContentMode(env, "t_500", { fetch: okFetch({ content: "redacted" }, 500).fetch })).toBe("metadata");
    expect(await workspaceContentMode(env, "t_body", { fetch: okFetch({ content: "full" }).fetch })).toBe("metadata");
    expect(await workspaceContentMode({}, "t_unconfigured", { fetch: okFetch({ content: "redacted" }).fetch })).toBe("metadata");
    const down = vi.fn(async () => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    expect(await workspaceContentMode(env, "t_down", { fetch: down })).toBe("metadata");
  });
});

describe("run annotations", () => {
  it("derives the delivered traceSpanId from the submission in flight", () => {
    expect(currentTraceSpanId(CONVERSATION)).toBeUndefined();
    expect(trackObservation({ type: "turn" }, CONVERSATION)).toBeUndefined();
    const started = trackObservation({ type: "submission_running", submissionId: SUBMISSION }, CONVERSATION)!;
    expect(started.traceSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(currentTraceSpanId(CONVERSATION)).toBe(started.traceSpanId);
    expect(traceSpanIdFor(CONVERSATION, "sub_2")).not.toBe(started.traceSpanId);
  });

  it("hands scores and decision calls to one export only", () => {
    trackObservation({ type: "submission_running", submissionId: SUBMISSION }, CONVERSATION);
    recordRunScore(CONVERSATION, "approval", 0);
    recordRunScore(CONVERSATION, "bogus", 7);
    recordDecisionCall(CONVERSATION, { point: "memory_gate", mode: "shadow", model: "m", latencyMs: 10, cost: 0, fallbackUsed: true, failure: null, at: 1 });
    expect(takeRunAnnotations(CONVERSATION, SUBMISSION).scores).toEqual({ approval: 0, decision_fallback: 0 });
    expect(takeRunAnnotations(CONVERSATION, SUBMISSION).scores).toEqual({});
  });

  it("decision calls report what may go on a trace (no state, no answers)", async () => {
    const calls: unknown[] = [];
    const failing = okFetch({ error: "upstream" }, 500);
    await decide({ env: { OPENROUTER_API_KEY: "test-key-not-real" }, fetch: failing.fetch, onCall: (c) => calls.push(c), logger: { write: () => undefined } }, "routing", { state: { message: "secret plan for jane.doe@example.com" }, tenantId: TENANT });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ point: "routing", fallbackUsed: true, failure: expect.any(String) });
    expect(JSON.stringify(calls[0])).not.toContain("jane.doe");
    // An off point (no key) calls nothing.
    await decide({ env: {}, onCall: (c) => calls.push(c) }, "routing", { state: { message: "x" }, tenantId: TENANT });
    expect(calls).toHaveLength(1);
  });
});

describe("POST /api/marketer/feedback", () => {
  const SECRET = "session-secret-for-tests-0123456789";
  const SPAN = traceSpanIdFor(CONVERSATION, SUBMISSION);

  async function token(claims: { sub?: string; tid?: string; role?: string; cid?: string } = {}) {
    const { roles, scopes } = personRolesAndScopes([claims.role ?? "marketer"]);
    return createSessionToken(SECRET, { sub: claims.sub ?? PERSON, tid: claims.tid ?? TENANT, roles, scopes, ...(claims.cid ? { cid: claims.cid } : {}) });
  }

  function app(options: { configured?: boolean; limited?: boolean } = {}) {
    const kv = new MemoryKeyValueStore();
    const sent = okFetch({});
    const pending: Promise<unknown>[] = [];
    const route = createFeedbackRoute<Record<string, never>>({
      sessionSecrets: () => [SECRET],
      config: () => (options.configured === false ? undefined : CONFIG),
      runs: () => kv,
      limiter: () => ({ take: async () => (options.limited ? { allowed: false, remaining: 0, retryAfterMs: 5_000 } : { allowed: true, remaining: 9, retryAfterMs: 0 }) }),
      fetch: sent.fetch,
      waitUntil: (p) => void pending.push(p),
    });
    const post = async (body: unknown, bearer?: string) =>
      route.request("/api/marketer/feedback", { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
    return { kv, sent, pending, post };
  }

  const body = (extra: Record<string, unknown> = {}) => ({ conversationId: CONVERSATION, traceSpanId: SPAN, score: 1, ...extra });

  it("records user_rating for a run of the caller's own conversation (204), comment masked", async () => {
    const t = app();
    await rememberRunSpan(t.kv, CONVERSATION, SPAN);
    const response = await t.post(body({ comment: "Great, but email me at jane.doe@example.com" }), await token());
    expect(response.status).toBe(204);
    await Promise.all(t.pending);
    expect(t.sent.calls).toHaveLength(1);
    expect(t.sent.calls[0]!.url).toBe(`https://api.braintrust.dev/v1/project_logs/${PROJECT}/feedback`);
    expect(t.sent.calls[0]!.headers).toMatchObject({ authorization: `Bearer ${FAKE_KEY}` });
    const sent = JSON.parse(t.sent.calls[0]!.body) as { feedback: Array<Record<string, unknown>> };
    expect(sent.feedback[0]).toMatchObject({ id: SPAN, scores: { user_rating: 1 }, metadata: { user_id: PERSON, tenant_id: TENANT, conversation_id: CONVERSATION }, source: "external" });
    expect(String(sent.feedback[0]!.comment)).toContain("[REDACTED_EMAIL]");
  });

  it("refuses without a session (401) or without agent:chat (403)", async () => {
    const t = app();
    await rememberRunSpan(t.kv, CONVERSATION, SPAN);
    expect((await t.post(body())).status).toBe(401);
    expect((await t.post(body(), "not.a-token")).status).toBe(401);
    expect((await t.post(body(), await token({ role: "billing" }))).status).toBe(403);
    expect((await t.post(body(), await token({ cid: "another-conversation" }))).status).toBe(403);
    expect(t.sent.calls).toHaveLength(0);
  });

  it("answers 404 for a span that is not one of the conversation's runs, another person's or another tenant's conversation", async () => {
    const t = app();
    await rememberRunSpan(t.kv, CONVERSATION, SPAN);
    expect((await t.post(body({ traceSpanId: "0123456789abcdef" }), await token())).status).toBe(404);
    expect((await t.post(body(), await token({ sub: "person_2" }))).status).toBe(404);
    expect((await t.post(body(), await token({ tid: "tenant_b" }))).status).toBe(404);
    const other = conversationInstanceId("assistant", TENANT, PERSON, "s2");
    expect((await t.post(body({ conversationId: other }), await token())).status).toBe(404);
    expect(await t.kv.get(runSpanKey(CONVERSATION, SPAN))).toBe("1");
    expect(t.sent.calls).toHaveLength(0);
  });

  it("validates the body (400), rate limits (429) and is 404 while Braintrust is off", async () => {
    const t = app();
    for (const bad of [body({ score: 2 }), body({ traceSpanId: "XYZ" }), body({ comment: "x".repeat(1_001) }), { traceSpanId: SPAN, score: 1 }]) expect((await t.post(bad, await token())).status).toBe(400);
    const limited = app({ limited: true });
    const response = await limited.post(body(), await token());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect((await app({ configured: false }).post(body(), await token())).status).toBe(404);
  });

  it("a Braintrust failure never reaches the person", async () => {
    const kv = new MemoryKeyValueStore();
    await rememberRunSpan(kv, CONVERSATION, SPAN);
    const pending: Promise<unknown>[] = [];
    const route = createFeedbackRoute<Record<string, never>>({ sessionSecrets: () => [SECRET], config: () => CONFIG, runs: () => kv, fetch: okFetch({}, 503).fetch, waitUntil: (p) => void pending.push(p) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await route.request("/api/marketer/feedback", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` }, body: JSON.stringify(body()) });
    expect(response.status).toBe(204);
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("evals as a Braintrust experiment (scripts/braintrust-evals.ts)", () => {
  it("runs the offline suite with no model key and no network", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const rows = await runConformanceSuite();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => r.scores.conformance === 1)).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });

  it("maps promptfoo results to rows, emails replaced", () => {
    const rows = promptfooRows({ results: { results: [{ success: true, score: 1, testCase: { description: "grounds first" }, vars: { eventPayload: "ping jane.doe@example.com" }, response: { output: { finalText: "ok" } } }, { success: false, testCase: { description: "asks first" } }] } }, "marketer");
    expect(rows.map((r) => r.scores)).toEqual([{ pass: 1, score: 1 }, { pass: 0, score: 0 }]);
    expect(JSON.stringify(rows)).not.toContain("jane.doe@example.com");
  });

  it("creates the experiment against the newest main baseline, inserts rows and asks for the comparison", async () => {
    const calls: Captured[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
      const u = String(url);
      if (u.includes("/v1/experiment?")) {
        return Response.json({ objects: [
          { id: "exp-main-old", created: "2026-11-01T00:00:00Z", metadata: { suite: SUITE, branch: "main" } },
          { id: "exp-main-new", created: "2026-11-10T00:00:00Z", metadata: { suite: SUITE, branch: "main" } },
          { id: "exp-feature", created: "2026-11-12T00:00:00Z", metadata: { suite: SUITE, branch: "feature" } },
          { id: "exp-other", created: "2026-11-13T00:00:00Z", metadata: { suite: "other", branch: "main" } },
        ] });
      }
      if (u.endsWith("/v1/experiment")) return Response.json({ id: "exp-new" });
      if (u.includes("/insert")) return Response.json({ row_ids: [] });
      return Response.json({ scores: {} });
    }) as unknown as typeof globalThis.fetch;
    const rows = await runConformanceSuite();
    const result = await uploadExperiment({ apiUrl: "https://api.braintrust.dev", apiKey: FAKE_KEY, projectId: PROJECT, name: "agent-evals feature@abc1234", branch: "feature", commit: "abc1234", baseBranch: "main", fetch }, rows);
    expect(result).toMatchObject({ experimentId: "exp-new", baselineId: "exp-main-new" });
    const create = calls.find((c) => c.url.endsWith("/v1/experiment"))!;
    expect(JSON.parse(create.body)).toMatchObject({ project_id: PROJECT, base_exp_id: "exp-main-new", metadata: { suite: SUITE, branch: "feature", commit: "abc1234" } });
    expect(create.headers).toMatchObject({ authorization: `Bearer ${FAKE_KEY}` });
    const inserted = calls.filter((c) => c.url.includes("/v1/experiment/exp-new/insert")).flatMap((c) => (JSON.parse(c.body) as { events: unknown[] }).events);
    expect(inserted).toHaveLength(rows.length);
    expect(calls.at(-1)!.url).toContain("/v1/experiment/exp-new/summarize?summarize_scores=true&comparison_experiment_id=exp-main-new");
  });
});
