import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { requestDecision, toWireQuestions } from "../src/marketer/decisions/client.ts";
import { DEFAULT_DECISION_MODEL, DEFAULT_DECISIONS_URL, type DecisionQuestion } from "../src/marketer/decisions/questions.ts";

/**
 * Conformance: the golden request/response cases in docs/decisions/conformance are replayed here and by the Python
 * suite (tests/test_decisions_conformance.py). A case is one vendor-neutral request, the exact wire request it must
 * become, a recorded or documented response, and the outcome every client must reach. Add a case there, never a
 * client-only expectation here, so the two clients cannot drift apart.
 */

const DIR = fileURLToPath(new URL("../../docs/decisions/conformance/", import.meta.url));

interface Case {
  name: string;
  model: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  wire_request: unknown;
  response: { status: number; body?: unknown; raw?: string };
  expect: { ok: true; answers: Record<string, unknown>; cost: number; tokens: number; model: string } | { ok: false; kind: string };
}

const read = <T>(file: string): T => JSON.parse(readFileSync(`${DIR}${file}`, "utf8")) as T;
const contract = read<{ endpoint: string; models: { D1: string; D0: string }; cases: string[]; failure_kinds: string[] }>("contract.json");
const cases = contract.cases.map((name) => read<Case>(`${name}.json`));

describe("decision client conformance (shared golden cases)", () => {
  it("lists every case file in contract.json", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".json") && f !== "contract.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual([...contract.cases].sort());
    expect(cases.length).toBeGreaterThan(20);
  });

  it("uses the contract's endpoint and pinned model", () => {
    expect(DEFAULT_DECISIONS_URL).toBe(contract.endpoint);
    expect(DEFAULT_DECISION_MODEL).toBe(contract.models.D1);
    expect(DEFAULT_DECISION_MODEL).toMatch(/-\d{8}$/);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect({ model: c.model, state: c.state, questions: toWireQuestions(c.questions) }).toEqual(c.wire_request);

    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(c.response.raw ?? JSON.stringify(c.response.body), { status: c.response.status, headers: { "content-type": "application/json" } }),
    );
    const r = await requestDecision({ env: { OPENROUTER_API_KEY: "test-key-not-real" }, fetch: fetchImpl as unknown as typeof fetch }, c.state, c.questions, { timeoutMs: 500, model: c.model });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(contract.endpoint);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(c.wire_request);

    if (c.expect.ok) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.answers).toEqual(c.expect.answers);
      expect(r.cost).toBe(c.expect.cost);
      expect(r.tokens).toBe(c.expect.tokens);
      expect(r.model).toBe(c.expect.model);
    } else {
      expect(contract.failure_kinds).toContain(c.expect.kind);
      expect(r).toMatchObject({ ok: false, kind: c.expect.kind });
      if (c.response.status >= 400) expect(r).toMatchObject({ status: c.response.status });
      // A failure never carries anything a table could read as an answer.
      expect(r).not.toHaveProperty("answers");
    }
  });
});
