import { AutoReviewer, type KnowledgeRetriever, type MemoryHit, type ReviewCall, type ReviewDecision, type TelemetryEvent, type TenantSecurityContext } from "@agent-starter/core";
import { describe, expect, it, vi } from "vitest";
import { requestDecision, toWireQuestions } from "../src/marketer/decisions/client.ts";
import { type AutopilotCheck, MarketerReviewer, observeTurns, turnHooks } from "../src/marketer/decisions/hooks.ts";
import { createDecisionLogger, type DecisionLogEntry, stateHash } from "../src/marketer/decisions/log.ts";
import { approvalRiskQuestions, AUTOPILOT_QUESTIONS, DEFAULT_DECISION_MODEL, DEFAULT_DECISIONS_URL, MEMORY_GATE_QUESTIONS, ROUTING_QUESTIONS, type DecisionAnswer } from "../src/marketer/decisions/questions.ts";
import { decide, type DecisionRuntime, resolveMode } from "../src/marketer/decisions/run.ts";
import { approvalRiskTable, autopilotTable, memoryGateTable, overSpendPace, routingTable, tightenVerdict } from "../src/marketer/decisions/tables.ts";
import { autopilotDecision, spendFrom } from "../src/marketer/heartbeat.ts";

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

const KEY = "test-key-not-real";
const yes = (p: number): DecisionAnswer => ({ type: "yesno", probability: p });
const pick = (choice: string, confidence: number, probabilities: Record<string, number> = { [choice]: confidence }): DecisionAnswer => ({ type: "choice", choice, confidence, probabilities });

/** The API stamps every answer with its type; the short wire literals below leave it out. */
function typed(wire: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(wire).map(([name, a]) => {
      const answer = a as Record<string, unknown>;
      const type = "type" in answer ? answer.type : "noul" in answer ? "noul" : "choice" in answer ? "choice" : "score";
      return [name, { type, ...answer }];
    }),
  );
}
/** A decisions endpoint that answers every question it is asked. */
function answeringFetch(wire: Record<string, unknown>, extra: Record<string, unknown> = { usage: { cost: 0.0002, input_tokens: 120, output_tokens: 8 }, model: "typesafe/jev-1.13-20260917" }) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ answers: typed(wire), ...extra }), { status: 200, headers: { "content-type": "application/json" } }));
}
/** A transport that only settles when aborted (a hung model). */
const hangingFetch = vi.fn(
  (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    }),
);
const failingFetch = vi.fn(async () => {
  throw new TypeError("network down");
});

function runtime(env: Record<string, unknown>, fetchImpl?: typeof fetch, entries: DecisionLogEntry[] = []): DecisionRuntime {
  return { env, ...(fetchImpl ? { fetch: fetchImpl } : {}), logger: { write: (e) => entries.push(e) }, agent: "test" };
}
const flush = () => new Promise((r) => setTimeout(r, 10));

const ROUTING_WIRE = { department: { choice: "media-buyer", confidence: 0.9, probabilities: { "media-buyer": 0.9 } }, multi_department: { noul: 0.1 }, ad_money: { noul: 0.8 } };
const RISK_WIRE_CLEAN = { regulated_claim: { noul: 0.05 }, names_competitor: { noul: 0.05 }, verdict: { choice: "approve", confidence: 0.95, probabilities: { approve: 0.95, escalate: 0.04, block: 0.01 } } };
const RISK_WIRE_CLAIM = { ...RISK_WIRE_CLEAN, regulated_claim: { noul: 0.9 } };

// ── client ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("decision client", () => {
  it("with no key returns a typed failure and never calls the network", async () => {
    const f = answeringFetch(ROUTING_WIRE);
    const r = await requestDecision({ env: {}, fetch: f as unknown as typeof fetch }, { message: "hi" }, ROUTING_QUESTIONS, { timeoutMs: 100 });
    expect(r).toMatchObject({ ok: false, kind: "no_key" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps a mocked success, reads usage.cost and sends the pinned model with the key only in the header", async () => {
    const f = answeringFetch(ROUTING_WIRE);
    const r = await requestDecision({ env: { OPENROUTER_API_KEY: KEY }, fetch: f as unknown as typeof fetch }, { message: "raise my ad budget" }, ROUTING_QUESTIONS, { timeoutMs: 500 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cost).toBe(0.0002);
    expect(r.tokens).toBe(128);
    expect(r.answers.department).toMatchObject({ type: "choice", choice: "media-buyer", confidence: 0.9 });
    expect(r.answers.ad_money).toEqual({ type: "yesno", probability: 0.8 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(DEFAULT_DECISIONS_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEFAULT_DECISION_MODEL);
    expect(body.model).not.toMatch(/latest/);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.questions.ad_money).toEqual({ type: "noul", instructions: ROUTING_QUESTIONS.ad_money.instructions });
  });

  it("treats a response without usage.cost as a failure", async () => {
    const f = answeringFetch(ROUTING_WIRE, { model: "m" });
    const r = await requestDecision({ env: { OPENROUTER_API_KEY: KEY }, fetch: f as unknown as typeof fetch }, {}, ROUTING_QUESTIONS, { timeoutMs: 500 });
    expect(r).toMatchObject({ ok: false, kind: "no_cost" });
  });

  it("times out instead of hanging", async () => {
    const r = await requestDecision({ env: { OPENROUTER_API_KEY: KEY }, fetch: hangingFetch as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("times out even when the transport ignores the abort signal", async () => {
    const deaf = vi.fn(() => new Promise<Response>(() => undefined));
    const r = await requestDecision({ env: { OPENROUTER_API_KEY: KEY }, fetch: deaf as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("returns typed failures for HTTP errors, network errors and malformed answers", async () => {
    const env = { OPENROUTER_API_KEY: KEY };
    const http = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await requestDecision({ env, fetch: http as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "http", status: 503 });
    expect(await requestDecision({ env, fetch: failingFetch as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "network" });
    const bad = answeringFetch({ department: { choice: "not-a-department", confidence: 0.9 }, multi_department: { noul: 0.1 }, ad_money: { noul: 0.1 } });
    expect(await requestDecision({ env, fetch: bad as unknown as typeof fetch }, {}, ROUTING_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "invalid" });
    const missing = answeringFetch({ lasting_fact: { noul: 3 } });
    expect(await requestDecision({ env, fetch: missing as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("a refused question fails the call as `refused`, and an untyped answer as `invalid`", async () => {
    const env = { OPENROUTER_API_KEY: KEY };
    const refused = answeringFetch({ lasting_fact: { type: "refusal" } });
    expect(await requestDecision({ env, fetch: refused as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "refused" });
    const untyped = vi.fn(async () => new Response(JSON.stringify({ answers: { lasting_fact: { noul: 0.9 } }, usage: { cost: 0.0001 } }), { status: 200 }));
    expect(await requestDecision({ env, fetch: untyped as unknown as typeof fetch }, {}, MEMORY_GATE_QUESTIONS, { timeoutMs: 100 })).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("maps every question type to the wire format", () => {
    expect(toWireQuestions({ s: { type: "score", instructions: "x", levels: ["a", "b"] }, c: { type: "choice", instructions: "y", options: { a: null, b: "B" } } })).toEqual({
      s: { type: "score", instructions: "x", criteria: ["a", "b"] },
      c: { type: "choice", instructions: "y", criteria: { a: null, b: "B" } },
    });
  });
});

// ── modes ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe("per-point mode", () => {
  it("is off without a key, whatever the overrides say", () => {
    expect(resolveMode({ DECISION_MODES: "routing=enforce", DECISION_MODE_ROUTING: "enforce" }, "routing")).toBe("off");
  });
  it("defaults every point to shadow with a key", () => {
    for (const p of ["routing", "approval_risk", "memory_gate", "autopilot"] as const) expect(resolveMode({ OPENROUTER_API_KEY: KEY }, p)).toBe("shadow");
  });
  it("honours DECISION_MODES, then DECISION_MODE_<POINT>, and ignores junk", () => {
    const env = { OPENROUTER_API_KEY: KEY, DECISION_MODES: "routing=enforce, memory_gate=off, autopilot=yolo" };
    expect(resolveMode(env, "routing")).toBe("enforce");
    expect(resolveMode(env, "memory_gate")).toBe("off");
    expect(resolveMode(env, "autopilot")).toBe("shadow");
    expect(resolveMode({ ...env, DECISION_MODE_ROUTING: "shadow" }, "routing")).toBe("shadow");
    expect(resolveMode({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "*=enforce" }, "approval_risk")).toBe("enforce");
  });
});

// ── decide ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("decide()", () => {
  it("with no key acts on the rule, calls nothing and logs nothing", async () => {
    const f = answeringFetch(ROUTING_WIRE);
    const log: DecisionLogEntry[] = [];
    const o = await decide(runtime({}, f as unknown as typeof fetch, log), "routing", { state: { message: "x" }, tenantId: "t1" });
    expect(o).toMatchObject({ mode: "off", action: { action: "frontier", department: null, skill: null }, fallbackUsed: true });
    expect(f).not.toHaveBeenCalled();
    await flush();
    expect(log).toHaveLength(0);
  });

  it("shadow: calls the model, logs the answer and the proposal, acts on the rule", async () => {
    const log: DecisionLogEntry[] = [];
    const o = await decide(runtime({ OPENROUTER_API_KEY: KEY }, answeringFetch(ROUTING_WIRE) as unknown as typeof fetch, log), "routing", { state: { message: "raise my ad budget to $50" }, tenantId: "t1" });
    expect(o.mode).toBe("shadow");
    expect(o.action).toEqual({ action: "frontier", department: null, skill: null });
    expect(o.proposed).toEqual({ action: "hint", department: "media-buyer", skill: "paid-media-safety" });
    await flush();
    expect(log).toHaveLength(1);
    const entry = log[0]!;
    expect(entry).toMatchObject({ point: "routing", mode: "shadow", questionsVersion: "marketer-decisions-v1", cost: 0.0002, failure: null, tenantId: "t1" });
    expect(entry.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("$50");
  });

  it("enforce: acts on the table", async () => {
    const o = await decide(runtime({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "approval_risk=enforce" }, answeringFetch(RISK_WIRE_CLAIM) as unknown as typeof fetch), "approval_risk", { state: { call: { tool: "approve_post" } }, tenantId: "t1" });
    expect(o.action).toEqual({ action: "escalate", reasons: ["makes a health, finance or legal claim"] });
    expect(o.fallbackUsed).toBe(false);
  });

  it("enforce + timeout: a fail-closed point escalates, a fail-open point takes the rule", async () => {
    const env = { OPENROUTER_API_KEY: KEY, DECISION_MODES: "*=enforce" };
    const log: DecisionLogEntry[] = [];
    const risk = await decide(runtime(env, hangingFetch as unknown as typeof fetch, log), "approval_risk", { state: { call: {} }, tenantId: "t1" });
    expect(risk).toMatchObject({ action: { action: "escalate" }, fallbackUsed: true, failure: "timeout" });
    const memory = await decide(runtime(env, hangingFetch as unknown as typeof fetch), "memory_gate", { state: { message: "x" }, tenantId: "t1" });
    expect(memory).toMatchObject({ action: { action: "skip" }, fallbackUsed: true, failure: "timeout" });
    await flush();
    expect(log[0]).toMatchObject({ fallbackUsed: true, failure: "timeout", cost: 0, answers: null });
  });

  it("enforce + error: takes the fallback (routing → rule, approval → escalate)", async () => {
    const env = { OPENROUTER_API_KEY: KEY, DECISION_MODES: "*=enforce" };
    const routing = await decide(runtime(env, failingFetch as unknown as typeof fetch), "routing", { state: { message: "x" }, tenantId: "t1" });
    expect(routing).toMatchObject({ action: { action: "frontier" }, fallbackUsed: true, failure: "network" });
    const risk = await decide(runtime(env, failingFetch as unknown as typeof fetch), "approval_risk", { state: { call: {} }, tenantId: "t1" });
    expect(risk.action.action).toBe("escalate");
  });

  it("shadow + error: acts on the rule, even for a fail-closed point", async () => {
    const risk = await decide(runtime({ OPENROUTER_API_KEY: KEY }, failingFetch as unknown as typeof fetch), "approval_risk", { state: { call: {} }, tenantId: "t1" });
    expect(risk.action).toEqual({ action: "keep", reasons: [] });
  });
});

// ── truth tables ───────────────────────────────────────────────────────────────────────────────────────────────

describe("routing table", () => {
  const dept = (choice: string, confidence: number) => ({ department: pick(choice, confidence) });
  it.each([
    ["clear single department", { ...dept("seo-editor", 0.9), multi_department: yes(0.1), ad_money: yes(0.1) }, { action: "hint", department: "seo-editor", skill: null }],
    ["clear + ad money forces the skill", { ...dept("media-buyer", 0.9), multi_department: yes(0.1), ad_money: yes(0.7) }, { action: "hint", department: "media-buyer", skill: "paid-media-safety" }],
    ["multi-department → frontier plans", { ...dept("strategist", 0.9), multi_department: yes(0.8), ad_money: yes(0.1) }, { action: "frontier", department: null, skill: null }],
    ["low confidence → frontier", { ...dept("analyst", 0.4), multi_department: yes(0.1), ad_money: yes(0.1) }, { action: "frontier", department: null, skill: null }],
    ["low confidence + ad money keeps the skill", { ...dept("analyst", 0.4), multi_department: yes(0.1), ad_money: yes(0.9) }, { action: "frontier", department: null, skill: "paid-media-safety" }],
    ["missing department answer → frontier", { multi_department: yes(0.1), ad_money: yes(0.1) }, { action: "frontier", department: null, skill: null }],
    ["unknown department → frontier", { ...dept("finance", 0.99), multi_department: yes(0.1), ad_money: yes(0.1) }, { action: "frontier", department: null, skill: null }],
  ])("%s", (_name, answers, expected) => {
    expect(routingTable(answers as Record<string, DecisionAnswer>)).toEqual(expected);
  });
});

describe("approval risk table (tighten only)", () => {
  const clean = { regulated_claim: yes(0.05), names_competitor: yes(0.05), verdict: pick("approve", 0.95, { approve: 0.95, escalate: 0.04, block: 0.01 }) };
  it.each([
    ["clean → keep", clean, "keep", []],
    ["regulated claim → escalate", { ...clean, regulated_claim: yes(0.6) }, "escalate", ["makes a health, finance or legal claim"]],
    ["competitor → escalate", { ...clean, names_competitor: yes(0.5) }, "escalate", ["names a competitor"]],
    ["brand rule broken → escalate", { ...clean, brand_rule_0: yes(0.1), brand_rule_1: yes(0.7) }, "escalate", ["breaks brand rule 1"]],
    ["P(approve) ≤ 0.1 → escalate", { ...clean, verdict: pick("block", 0.92, { approve: 0.05, escalate: 0.03, block: 0.92 }) }, "escalate", ["reviewer judgment: block"]],
    ["unsure verdict (between gates) → keep", { ...clean, verdict: pick("escalate", 0.5, { approve: 0.4, escalate: 0.5, block: 0.1 }) }, "keep", []],
    ["missing verdict → keep (never read as approval)", { regulated_claim: yes(0.05), names_competitor: yes(0.05) }, "keep", []],
  ])("%s", (_name, answers, action, reasons) => {
    expect(approvalRiskTable(answers as Record<string, DecisionAnswer>)).toEqual({ action, reasons });
  });

  it("asks one question per brand rule, capped", () => {
    const q = approvalRiskQuestions(Array.from({ length: 20 }, (_, i) => `rule ${i}`));
    expect(Object.keys(q).filter((k) => k.startsWith("brand_rule_"))).toHaveLength(10);
  });

  it("tightenVerdict never loosens", () => {
    const verdicts = ["approve", "escalate", "block"] as const;
    const rank = { approve: 0, escalate: 1, block: 2 };
    for (const base of verdicts) {
      for (const action of ["keep", "escalate"] as const) {
        const out = tightenVerdict(base, { action, reasons: [] });
        expect(rank[out]).toBeGreaterThanOrEqual(rank[base]);
      }
    }
    expect(tightenVerdict("approve", { action: "escalate", reasons: [] })).toBe("escalate");
    expect(tightenVerdict("approve", { action: "keep", reasons: [] })).toBe("approve");
    expect(tightenVerdict("block", { action: "escalate", reasons: [] })).toBe("block");
  });
});

describe("memory gate table", () => {
  it.each([
    [0.9, "extract"],
    [0.6, "extract"],
    [0.59, "skip"],
    [0, "skip"],
  ])("P(lasting fact) %s → %s", (p, action) => {
    expect(memoryGateTable({ lasting_fact: yes(p) })).toEqual({ action });
  });
  it("missing answer → skip", () => expect(memoryGateTable({})).toEqual({ action: "skip" }));
});

describe("autopilot table", () => {
  const calm = { inbox_waiting: yes(0.1) };
  it.each([
    ["over pace always proceeds", { ...calm, goal_status: pick("met", 0.99) }, true, "proceed", "spend above pace"],
    ["stale inbox proceeds", { inbox_waiting: yes(0.7), goal_status: pick("met", 0.99) }, false, "proceed", "inbox item waiting more than a day"],
    ["goal blocked proceeds", { ...calm, goal_status: pick("blocked", 0.7) }, false, "proceed", "goal blocked: a person is needed"],
    ["goal met (confident) holds", { ...calm, goal_status: pick("met", 0.85) }, false, "hold", "goal met: nothing worth proposing"],
    ["goal met (unsure) proceeds", { ...calm, goal_status: pick("met", 0.6) }, false, "proceed", "goal continues"],
    ["goal continues proceeds", { ...calm, goal_status: pick("continue", 0.9) }, false, "proceed", "goal continues"],
    ["blocked but unsure proceeds", { ...calm, goal_status: pick("blocked", 0.3) }, false, "proceed", "goal continues"],
  ])("%s", (_name, answers, overPace, action, reason) => {
    expect(autopilotTable(answers as Record<string, DecisionAnswer>, { overPace })).toEqual({ action, reason });
  });

  it.each([
    [3, 24, 11, false], // noon pace = 12, spent 3
    [13, 24, 11, true], // noon pace = 12, spent 13
    [2, 24, 0, true], // first hour pace = 1
    [24, 24, 23, false], // end of day: exactly the cap
    [5, undefined, 12, false], // no cap
    [5, 0, 12, false],
  ])("overSpendPace(%s, %s, hour %s) = %s", (spent, cap, hour, expected) => {
    expect(overSpendPace(spent, cap, hour)).toBe(expected);
  });

  it("reads spend and summed caps in code", () => {
    expect(spendFrom({ total_usd: "4.50" }, [{ daily_spend_cap_usd: "5.00" }, { daily_spend_cap_usd: 2.5 }, { daily_spend_cap_usd: null }])).toEqual({ spentUsd: 4.5, dailyCapUsd: 7.5 });
    expect(spendFrom(undefined)).toEqual({ spentUsd: 0 });
  });

  it("does not read the account when the point is off (no key)", async () => {
    const read = vi.fn();
    expect(await autopilotDecision(runtime({}), "t1", read)).toEqual({ action: "proceed", reason: "heartbeat checklist" });
    expect(read).not.toHaveBeenCalled();
  });

  it("enforce holds a proposal when the goal is met; shadow keeps the rule", async () => {
    const wire = { inbox_waiting: { noul: 0.05 }, goal_status: { choice: "met", confidence: 0.95, probabilities: { met: 0.95 } } };
    const read = async () => ({ hour: 12, inbox: { items: [] }, spendToday: { spentUsd: 1, dailyCapUsd: 10 } });
    const enforce = runtime({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "autopilot=enforce" }, answeringFetch(wire) as unknown as typeof fetch);
    expect((await autopilotDecision(enforce, "t1", read)).action).toBe("hold");
    const shadow = runtime({ OPENROUTER_API_KEY: KEY }, answeringFetch(wire) as unknown as typeof fetch);
    expect((await autopilotDecision(shadow, "t1", read)).action).toBe("proceed");
    expect(Object.keys(AUTOPILOT_QUESTIONS)).toEqual(["inbox_waiting", "goal_status"]);
  });
});

// ── hooks ──────────────────────────────────────────────────────────────────────────────────────────────────────

const TENANT = { tenantId: "t1", userId: "u1", roles: ["user"] } as unknown as TenantSecurityContext;
const baseHit: MemoryHit = { id: "m1", text: "brand voice is playful", score: 0.9, source: "memory", metadata: {} };
const fakeRetriever = () => ({ retrieve: vi.fn(async () => [baseHit]) }) as unknown as KnowledgeRetriever;

describe("turn hooks (points 1 and 11)", () => {
  it("no key: no hooks, the retriever is returned untouched", () => {
    const r = fakeRetriever();
    expect(turnHooks(() => runtime({}), { routing: true, memoryGate: true })).toEqual([]);
    expect(observeTurns(() => r, [])(TENANT)).toBe(r);
  });

  it("shadow: retrieval is unchanged and the decisions are logged in the background", async () => {
    const log: DecisionLogEntry[] = [];
    const f = answeringFetch({ ...ROUTING_WIRE, lasting_fact: { noul: 0.9 } });
    const rt = runtime({ OPENROUTER_API_KEY: KEY }, f as unknown as typeof fetch, log);
    const wrapped = observeTurns(fakeRetriever, turnHooks(() => rt, { routing: true, memoryGate: true }))(TENANT)!;
    expect(await wrapped.retrieve("raise the ad budget")).toEqual([baseHit]);
    await flush();
    await flush();
    expect(log.map((e) => e.point).sort()).toEqual(["memory_gate", "routing"]);
  });

  it("enforce: a routing hint is put first", async () => {
    const rt = runtime({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "routing=enforce" }, answeringFetch(ROUTING_WIRE) as unknown as typeof fetch);
    const wrapped = observeTurns(fakeRetriever, turnHooks(() => rt, { routing: true }))(TENANT)!;
    const hits = await wrapped.retrieve("raise the ad budget");
    expect(hits).toHaveLength(2);
    expect(hits[0]!.text).toContain("media-buyer");
    expect(hits[0]!.text).toContain("paid-media-safety");
  });

  it("enforce + failure: no hint, retrieval still works", async () => {
    const rt = runtime({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "routing=enforce" }, failingFetch as unknown as typeof fetch);
    const wrapped = observeTurns(fakeRetriever, turnHooks(() => rt, { routing: true }))(TENANT)!;
    expect(await wrapped.retrieve("x")).toEqual([baseHit]);
  });
});

describe("MarketerReviewer (points 6 and 12)", () => {
  const call: ReviewCall = { tool: "approve_post", args: { caption: "Cures anxiety in 3 days" }, risk: "HIGH", sideEffect: "external" };
  const inner = (decision: ReviewDecision["decision"]) => {
    const r = new AutoReviewer();
    vi.spyOn(r, "review").mockResolvedValue({ decision, reason: "inner", by: "model" });
    return r;
  };
  const reviewer = (env: Record<string, unknown>, fetchImpl: typeof fetch | undefined, base: ReviewDecision["decision"], autopilot?: AutopilotCheck) =>
    new MarketerReviewer({ inner: inner(base), runtime: () => runtime(env, fetchImpl), tenantId: "t1", ...(autopilot ? { autopilot } : {}) });

  it("no key: the inner verdict stands untouched", async () => {
    const f = answeringFetch(RISK_WIRE_CLAIM);
    expect(await reviewer({}, f as unknown as typeof fetch, "approve").review(call)).toEqual({ decision: "approve", reason: "inner", by: "model" });
    expect(f).not.toHaveBeenCalled();
  });

  it("shadow: logs only, the inner verdict stands", async () => {
    expect((await reviewer({ OPENROUTER_API_KEY: KEY }, answeringFetch(RISK_WIRE_CLAIM) as unknown as typeof fetch, "approve").review(call)).decision).toBe("approve");
  });

  it("enforce: a regulated claim escalates an approval", async () => {
    const d = await reviewer({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "approval_risk=enforce" }, answeringFetch(RISK_WIRE_CLAIM) as unknown as typeof fetch, "approve").review(call);
    expect(d.decision).toBe("escalate");
    expect(d.reason).toContain("health, finance or legal claim");
  });

  it("enforce: never loosens a block or an escalation, even on a clean answer", async () => {
    const env = { OPENROUTER_API_KEY: KEY, DECISION_MODES: "approval_risk=enforce" };
    expect((await reviewer(env, answeringFetch(RISK_WIRE_CLEAN) as unknown as typeof fetch, "block").review(call)).decision).toBe("block");
    expect((await reviewer(env, answeringFetch(RISK_WIRE_CLEAN) as unknown as typeof fetch, "escalate").review(call)).decision).toBe("escalate");
    expect((await reviewer(env, answeringFetch(RISK_WIRE_CLEAN) as unknown as typeof fetch, "approve").review(call)).decision).toBe("approve");
  });

  it("enforce: a model failure fails closed (escalate)", async () => {
    const d = await reviewer({ OPENROUTER_API_KEY: KEY, DECISION_MODES: "approval_risk=enforce" }, failingFetch as unknown as typeof fetch, "approve").review(call);
    expect(d.decision).toBe("escalate");
  });

  it("a held autopilot proposal is blocked; other tools ignore the autopilot check", async () => {
    const hold = vi.fn(async () => ({ action: "hold" as const, reason: "goal met" }));
    const propose: ReviewCall = { tool: "propose_next_moves", args: {}, risk: "MEDIUM" };
    expect((await reviewer({}, undefined, "escalate", hold).review(propose)).decision).toBe("block");
    expect((await reviewer({}, undefined, "approve", hold).review(call)).decision).toBe("approve");
    expect(hold).toHaveBeenCalledTimes(1);
  });
});

// ── log ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("decision log", () => {
  const entry: DecisionLogEntry = {
    point: "routing",
    mode: "shadow",
    model: "m",
    questionsVersion: "v",
    stateHash: "h",
    answers: null,
    fallbackUsed: true,
    failure: null,
    latencyMs: 12,
    cost: 0.0001,
    actionTaken: { action: "frontier" },
    proposed: null,
    tenantId: "t1",
    runId: null,
    agent: "assistant",
    at: 1,
  };

  it("hashes state stably regardless of key order", async () => {
    expect(await stateHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(await stateHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(await stateHash({ a: 1 })).not.toBe(await stateHash({ a: 2 }));
  });

  it("publishes to telemetry and POSTs to the backend, best-effort", async () => {
    const events: TelemetryEvent[] = [];
    const backend = vi.fn(async () => new Response("not found", { status: 404 }));
    const logger = createDecisionLogger({ telemetry: () => [{ publish: async (e) => void events.push(e) }], backend: { apiUrl: "https://api.example.com/", token: "svc", fetch: backend as unknown as typeof fetch } });
    expect(() => logger.write(entry)).not.toThrow();
    await flush();
    expect(events[0]).toMatchObject({ type: "log", tenantId: "t1", data: { decision: entry } });
    const [url, init] = backend.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/v1/decisions/log");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe("t1");
  });

  it("never throws when the backend or a sink fails, and skips the backend when unconfigured", async () => {
    const backend = vi.fn(async () => {
      throw new Error("down");
    });
    const logger = createDecisionLogger({
      telemetry: () => [
        {
          publish: async () => {
            throw new Error("sink down");
          },
        },
      ],
      backend: { apiUrl: "https://api.example.com", token: "svc", fetch: backend as unknown as typeof fetch },
    });
    expect(() => logger.write(entry)).not.toThrow();
    await flush();
    const unconfigured = vi.fn();
    createDecisionLogger({ backend: { apiUrl: "", token: "svc", fetch: unconfigured as unknown as typeof fetch } }).write(entry);
    expect(unconfigured).not.toHaveBeenCalled();
  });
});
