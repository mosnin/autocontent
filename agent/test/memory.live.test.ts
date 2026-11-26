import { describe, expect, it } from "vitest";
import { ApiMemoryStore, extractAndStore, recallForTurn, runConsolidation } from "../src/marketer/memory/index.ts";

/**
 * Contract test of the agent's backend store against a running Marketer API (the wire format of /api/v1/memory).
 * Opt-in: needs MEMORY_LIVE_API_URL, MEMORY_LIVE_SERVICE_TOKEN and two existing users in MEMORY_LIVE_TENANTS ("a,b").
 * See docs/memory/README.md "Checking the wire format".
 */
const url = process.env.MEMORY_LIVE_API_URL;
const token = process.env.MEMORY_LIVE_SERVICE_TOKEN;
const [A, B] = (process.env.MEMORY_LIVE_TENANTS ?? "").split(",");

describe.skipIf(!url || !token || !A || !B)("memory against a live backend", () => {
  const store = new ApiMemoryStore({ env: () => ({ PRIMARY_SAAS_API_URL: url, SAAS_SERVICE_TOKEN: token }) });
  const voice = (value: string, kind: "message" | "web" = "message") => ({ subject: { type: "brand", name: "Live Brand" }, predicate: "voice", value, source: { kind, ref: kind === "web" ? "https://example.com/about" : "chat:live" } });

  it("writes, supersedes, reads current facts and history, and keeps tenants apart", async () => {
    const first = await store.write(A!, voice("Warm and practical"));
    const second = await store.write(A!, voice("Dry and precise"));
    expect([first.status, second.status]).toEqual(["created", "superseded"]);
    expect(second.fact).toMatchObject({ tenantId: A, trust: "unconfirmed", value: "Dry and precise", pending: false, invalidAt: null, source: { kind: "message", ref: "chat:live" } });
    expect(second.fact!.validFrom).toBeGreaterThan(0);

    const current = await store.current(A!);
    expect(current.filter((f) => f.predicate === "voice").map((f) => f.value)).toEqual(["Dry and precise"]);
    const versions = await store.history(A!, second.fact!.id);
    expect(versions.map((f) => [f.value, f.invalidReason])).toEqual([
      ["Warm and practical", "superseded"],
      ["Dry and precise", null],
    ]);
    expect(versions[0]!.supersededBy).toBe(second.fact!.id);

    // Tenant B sees none of it, and A's fact id is a 404 for B.
    expect(await store.current(B!)).toEqual([]);
    await expect(store.history(B!, second.fact!.id)).rejects.toThrow(/404/);
    expect((await recallForTurn({ store }, B!, "what is our voice?")).text).toBe("");
    expect((await recallForTurn({ store }, A!, "what is our voice?")).text).toContain("Dry and precise");
  });

  it("holds an untrusted rule for the person and rejects a secret", async () => {
    const rule = await store.write(A!, { subject: { type: "rule", name: "No emoji" }, predicate: "text", value: "Never use emoji in captions", source: { kind: "web", ref: "https://example.com/brand" } });
    expect(rule).toMatchObject({ status: "pending", reason: "needs_person", fact: { pending: true, trust: "untrusted" } });
    expect((await store.current(A!)).some((f) => f.subject.type === "rule")).toBe(false);
    expect(await store.write(A!, voice("password: hunter2hunter2"))).toMatchObject({ status: "rejected", reason: "secret" });
  });

  it("runs the write path, records a learning and consolidates", async () => {
    const log = await extractAndStore({ env: { MEMORY_EXTRACTION_MODE: "write" }, store }, { tenantId: A!, message: "Our tagline is Dinner in ten.", source: { kind: "message", ref: "chat:live-2" } });
    expect(log.written).toEqual({ created: 1 });
    const learned = await store.recordLearning(A!, { claim: "Numbers in hooks win on TikTok", status: "supported", evidence: [{ kind: "metric", ref: "pm:1", label: "12 posts", metric: "ctr", value: 0.04, n: 12 }] });
    expect(learned).toMatchObject({ status: "recorded", learning: { status: "supported", tenantId: A } });
    expect((await store.learnings(A!)).map((l) => l.claim)).toContain("Numbers in hooks win on TikTok");
    expect(await store.learnings(B!)).toEqual([]);
    expect(await runConsolidation(store, A!)).toMatchObject({ tenantId: A, merged: 0 });
  });
});
