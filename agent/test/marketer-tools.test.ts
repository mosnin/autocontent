/**
 * Marketer tools (src/marketer/tools/*): honest risk tiers per department, typed input validation before any request,
 * the guarded pipeline (LOW runs, MEDIUM runs with the idempotency key, HIGH/CRITICAL park for approval, shadow mode
 * simulates), and "each agent gets only its department's tools". Plain Node with the core ToolExecutor; `fetch` stubbed.
 */
import { type AnyAgentTool, ApprovalStore, CORE_MIGRATIONS, MigrationRunner, SECURE_DEFAULT_TENANT_CONFIG, SqlIdempotencyStore, type TenantConfig, ToolExecutor } from "@agent-starter/core";
import { NodeSqlStore } from "@agent-starter/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appApiTools } from "../src/in-app/app-api.ts";
import { MARKETER_HEARTBEAT, marketerAutopilotConfig } from "../src/marketer/heartbeat.ts";
import { adsTools, MAX_DAILY_BUDGET_USD } from "../src/marketer/tools/ads.ts";
import { analyticsTools } from "../src/marketer/tools/analytics.ts";
import { contentTools } from "../src/marketer/tools/content.ts";
import { distributionTools } from "../src/marketer/tools/distribution.ts";
import { DEPARTMENT_TOOLS, departmentToolNames, marketerReadTools, persistentReadTools } from "../src/marketer/tools/index.ts";
import { createProposeNextMovesTool } from "../src/marketer/tools/proposals.ts";
import { seoTools } from "../src/marketer/tools/seo.ts";
import { strategyTools } from "../src/marketer/tools/strategy.ts";
import { DELEGATION_ROSTER, DEPARTMENT_GRANT, SPECIALISTS } from "../src/multi-agent/roster.ts";

const UUID = "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b";
const ENV = { PRIMARY_SAAS_API_URL: "https://api.marketer.test", SAAS_SERVICE_TOKEN: "svc-token-0123456789" };
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json({ ok: true, title: "Spring launch" });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** The risk tier of every Marketer tool. A change here is a deliberate risk decision: review it. */
const EXPECTED_RISK: Record<string, "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> = {
  // workspace
  get_workspace_overview: "LOW",
  get_workspace_inbox: "LOW",
  get_workspace_activity: "LOW",
  decide_inbox_item: "HIGH",
  // strategy
  list_playbooks: "LOW",
  get_playbook: "LOW",
  get_playbook_performance: "LOW",
  draft_playbook: "MEDIUM",
  create_playbook: "MEDIUM",
  update_playbook: "MEDIUM",
  set_playbook_spend_cap: "HIGH",
  get_brand_kit: "LOW",
  update_brand_kit: "HIGH",
  list_kits: "LOW",
  // content
  list_videos: "LOW",
  get_video: "LOW",
  get_video_metrics: "LOW",
  create_video: "MEDIUM",
  retry_video: "MEDIUM",
  list_carousels: "LOW",
  get_carousel: "LOW",
  create_carousel: "MEDIUM",
  retry_carousel: "MEDIUM",
  list_library_assets: "LOW",
  list_templates: "LOW",
  remix_template: "MEDIUM",
  list_short_videos: "LOW",
  get_short_video: "LOW",
  create_short_video: "MEDIUM",
  // seo
  list_articles: "LOW",
  get_article: "LOW",
  get_article_markdown: "LOW",
  create_article: "MEDIUM",
  repurpose_article: "MEDIUM",
  retry_article: "MEDIUM",
  // distribution
  get_calendar: "LOW",
  list_campaigns: "LOW",
  get_campaign: "LOW",
  create_campaign: "MEDIUM",
  start_campaign: "HIGH",
  pause_campaign: "MEDIUM",
  get_channel_status: "LOW",
  start_channel_connection: "MEDIUM",
  approve_video: "HIGH",
  reject_video: "HIGH",
  approve_carousel: "HIGH",
  // ads
  get_ads_overview: "LOW",
  list_ad_accounts: "LOW",
  list_ad_campaigns: "LOW",
  get_ad_campaign: "LOW",
  list_ad_approvals: "LOW",
  list_ad_actions: "LOW",
  connect_ad_account: "MEDIUM",
  create_ad_campaign: "MEDIUM",
  set_ad_budget: "CRITICAL",
  activate_ad_campaign: "CRITICAL",
  pause_ad_campaign: "HIGH",
  decide_ad_approval: "CRITICAL",
  // analytics
  get_spend_today: "LOW",
  get_spend_history: "LOW",
  get_metrics_summary: "LOW",
};

const allTools = (): AnyAgentTool[] => {
  const byName = new Map<string, AnyAgentTool>();
  for (const tools of Object.values(DEPARTMENT_TOOLS)) for (const tool of tools()) byName.set(tool.name, tool);
  return [...byName.values()];
};

function executor(tools: AnyAgentTool[]) {
  const sql = new NodeSqlStore();
  new MigrationRunner(sql).migrateUp(CORE_MIGRATIONS);
  return new ToolExecutor({ tools, approvals: new ApprovalStore(sql, "test-approval-secret"), idempotency: new SqlIdempotencyStore(sql) });
}

let callSeq = 0;
async function run(tools: AnyAgentTool[], name: string, args: Record<string, unknown>, options: { mode?: "live" | "shadow"; tenantConfig?: TenantConfig } = {}) {
  callSeq++;
  return executor(tools).execute(
    { id: `call_${callSeq}`, name, arguments: JSON.stringify(args) },
    {
      tenant: { tenantId: "user_2abcTenant", userId: "user_2abcTenant", environment: "test", roles: [], scopes: [] },
      tenantConfig: options.tenantConfig ?? SECURE_DEFAULT_TENANT_CONFIG,
      runId: "run_1",
      signal: new AbortController().signal,
      mode: options.mode ?? "live",
      log: () => {},
      services: { env: ENV },
    },
  );
}

describe("risk tiers", () => {
  it("gives every Marketer tool its reviewed risk tier", () => {
    const actual = Object.fromEntries(allTools().map((t) => [t.name, t.risk]));
    expect(actual).toEqual(EXPECTED_RISK);
  });

  it("keeps reads LOW and read-only, and never lets a mutating tool be LOW", () => {
    for (const tool of allTools()) {
      if (tool.risk === "LOW") expect(tool.sideEffect, tool.name).toBe("read");
      else expect(["write", "external"], tool.name).toContain(tool.sideEffect);
      expect(tool.timeoutMs, tool.name).toBeGreaterThan(0);
    }
  });

  it("forces approval on every money move and keeps CRITICAL tools in paid media only", () => {
    const critical = allTools().filter((t) => t.risk === "CRITICAL");
    expect(critical.map((t) => t.name).sort()).toEqual(["activate_ad_campaign", "decide_ad_approval", "set_ad_budget"]);
    for (const tool of critical) expect(tool.requiresApproval, tool.name).toBe(true);
    const nonAds = [...strategyTools(), ...contentTools(), ...seoTools(), ...distributionTools(), ...analyticsTools()];
    expect(nonAds.some((t) => t.risk === "CRITICAL")).toBe(false);
    expect(analyticsTools().every((t) => t.risk === "LOW")).toBe(true);
  });
});

describe("department isolation", () => {
  it("roster grants equal each department's own tools; Marketer holds reads only", () => {
    for (const entry of DELEGATION_ROSTER) expect(entry.tools).toEqual(departmentToolNames(entry.id as keyof typeof DEPARTMENT_TOOLS));
    expect(SPECIALISTS.map((s) => s.agent)).toEqual(["strategist", "content-producer", "seo-editor", "media-buyer", "distribution-manager", "analyst-agent"]);
    expect(marketerReadTools().every((t) => t.risk === "LOW" && t.sideEffect === "read")).toBe(true);
    expect(persistentReadTools().every((t) => t.risk === "LOW" && t.sideEffect === "read")).toBe(true);
    expect(DEPARTMENT_GRANT).toEqual(expect.arrayContaining(["set_ad_budget", "create_video", "approve_video"]));
  });

  it("gives paid-media tools only to the media buyer, and publishing decisions only to distribution", () => {
    const holders = (name: string) => Object.entries(DEPARTMENT_TOOLS).filter(([, tools]) => tools().some((t) => t.name === name)).map(([d]) => d);
    for (const name of ["set_ad_budget", "activate_ad_campaign", "decide_ad_approval", "pause_ad_campaign", "create_ad_campaign"]) expect(holders(name)).toEqual(["media-buyer"]);
    for (const name of ["approve_video", "reject_video", "approve_carousel", "decide_inbox_item", "start_campaign"]) expect(holders(name)).toEqual(["distribution-manager"]);
    expect(holders("update_brand_kit")).toEqual(["strategist"]);
    expect(holders("create_video")).toEqual(["content-producer"]);
  });

  it("gives the in-page copilot no paid-media tools and nothing CRITICAL", () => {
    const names = appApiTools().map((t) => t.name);
    expect(names.some((n) => n.includes("ad_"))).toBe(false);
    expect(appApiTools().some((t) => t.risk === "CRITICAL")).toBe(false);
    expect(names).toEqual(expect.arrayContaining(["get_workspace_overview", "create_video", "decide_inbox_item", "navigate_ui"]));
  });
});

describe("guarded execution", () => {
  it("runs LOW reads with the tenant from the context and wraps the output as untrusted", async () => {
    const outcome = await run(analyticsTools(), "get_spend_history", { days: 14, playbookId: UUID });
    expect(outcome.status).toBe("ok");
    expect(outcome.text.startsWith("<untrusted_content")).toBe(true);
    expect(calls[0]?.url).toBe(`https://api.marketer.test/api/v1/spend/history?days=14&niche_id=${UUID}`);
    expect(calls[0]?.headers["x-tenant-id"]).toBe("user_2abcTenant");
  });

  it("never takes the tenant from arguments", async () => {
    const outcome = await run(contentTools(), "get_video", { videoId: UUID, tenantId: "user_other" });
    // The schema strips unknown keys; the header always comes from ctx.tenant.
    expect(outcome.status).toBe("ok");
    expect(calls[0]?.headers["x-tenant-id"]).toBe("user_2abcTenant");
    expect(JSON.stringify(calls[0])).not.toContain("user_other");
  });

  it("runs MEDIUM makers with the run's idempotency key and the exact request body", async () => {
    const outcome = await run(contentTools(), "create_video", { playbookId: UUID, platform: "reels" });
    expect(outcome.status).toBe("ok");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.marketer.test/api/v1/jobs", body: { niche_id: UUID, platform: "reels" } });
    expect(calls[0]?.headers["idempotency-key"]).toMatch(/.+/);
  });

  it("starts a short-video batch as a MEDIUM maker with the backend's settings shape", async () => {
    const topic = await run(contentTools(), "create_short_video", { topic: "coffee myths", variants: 3, settings: { aspect: "1:1", subtitles: "off", music: "none" } });
    expect(topic.status).toBe("ok");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://api.marketer.test/api/v1/short-videos",
      body: {
        source: "topic",
        topic: "coffee myths",
        variants: 3,
        settings: { look: { aspect: "1:1", duration_sec: 30 }, footage: { sources: ["pexels", "pixabay"], upload_ids: [] }, subtitles: { enabled: false }, music: { mode: "none" } },
      },
    });
    expect(calls[0]?.headers["idempotency-key"]).toMatch(/.+/);
    const script = await run(contentTools(), "create_short_video", { script: "Most people brew coffee the wrong way today.", settings: { footage: "both", uploadIds: [UUID] } });
    expect(script.status).toBe("ok");
    expect(calls[1]?.body).toMatchObject({ source: "script", settings: { footage: { sources: ["pexels", "pixabay", "uploads"], upload_ids: [UUID] } } });
  });

  it("parks HIGH and CRITICAL tools for approval without calling the API", async () => {
    for (const [tools, name, args] of [
      [distributionTools(), "approve_video", { videoId: UUID, reason: "Looks on brand" }],
      [distributionTools(), "start_campaign", { campaignId: UUID, reason: "Approved launch plan" }],
      [strategyTools(), "update_brand_kit", { brandName: "Acme", tagline: "", toneOfVoice: "", targetAudience: "", bannedWords: [], preferredHashtags: [], reason: "Rebrand" }],
      [adsTools(), "set_ad_budget", { campaignId: UUID, dailyBudgetUsd: 40, currentDailyBudgetUsd: 35, reason: "CPA under target" }],
      [adsTools(), "activate_ad_campaign", { campaignId: UUID, dailyBudgetUsd: 20, reason: "Draft reviewed" }],
      [adsTools(), "decide_ad_approval", { approvalId: UUID, decision: "approved", dollarDeltaUsd: 15, reason: "Person approved" }],
    ] as const) {
      const outcome = await run(tools as AnyAgentTool[], name, args as Record<string, unknown>);
      expect(outcome.status, name).toBe("approval_required");
    }
    expect(calls).toHaveLength(0);
  });

  it("simulates mutations in shadow mode", async () => {
    const outcome = await run(contentTools(), "create_carousel", { playbookId: UUID, topic: "5 hooks" }, { mode: "shadow" });
    expect(outcome.status).toBe("simulated");
    expect(calls).toHaveLength(0);
  });
});

describe("input validation (no request on bad arguments)", () => {
  const invalid: Array<[AnyAgentTool[], string, Record<string, unknown>]> = [
    [contentTools(), "get_video", { videoId: "../../admin" }],
    [contentTools(), "create_video", { playbookId: UUID, platform: "myspace" }],
    [contentTools(), "create_carousel", { playbookId: UUID, slideCount: 50 }],
    [contentTools(), "create_short_video", { topic: "x" }],
    [contentTools(), "create_short_video", { topic: "coffee myths", variants: 11 }],
    [contentTools(), "create_short_video", { topic: "coffee myths", settings: { aspect: "4:3" } }],
    [adsTools(), "set_ad_budget", { campaignId: UUID, dailyBudgetUsd: MAX_DAILY_BUDGET_USD + 1, currentDailyBudgetUsd: 10, reason: "scale up" }],
    [adsTools(), "set_ad_budget", { campaignId: UUID, dailyBudgetUsd: -5, currentDailyBudgetUsd: 10, reason: "scale down" }],
    [adsTools(), "pause_ad_campaign", { campaignId: UUID, status: "active", reason: "go live" }],
    [strategyTools(), "create_playbook", { title: "x" }],
    [strategyTools(), "set_playbook_spend_cap", { playbookId: UUID, dailySpendCapUsd: 5000, reason: "more output" }],
    [distributionTools(), "decide_inbox_item", { kind: "ad_change", refId: UUID, decision: "approve", reason: "fine" }],
    [distributionTools(), "approve_video", { videoId: UUID }],
    [seoTools(), "repurpose_article", { articleId: UUID, platforms: ["myspace"] }],
  ];
  it.each(invalid.map(([tools, name, args]) => ({ tools, name, args })))("rejects bad $name arguments", async ({ tools, name, args }) => {
    const outcome = await run(tools, name, args);
    expect(outcome.status).toBe("invalid_arguments");
    expect(calls).toHaveLength(0);
  });

  it("always creates playbooks that require approval before posting", async () => {
    const outcome = await run(strategyTools(), "create_playbook", {
      title: "Founders",
      description: "Short tips for bootstrapped founders",
      targetAudience: "Bootstrapped SaaS founders",
      hashtags: ["#saas"],
      visualStyle: "Clean, bright",
      voice: "Direct",
      targetDurationSec: 30,
      sceneCount: 5,
      postingWindows: [{ hour: 9, minute: 0, tz: "America/New_York" }],
      platforms: ["tiktok"],
      dailySpendCapUsd: 10,
    });
    expect(outcome.status).toBe("ok");
    expect(calls[0]?.body).toMatchObject({ approve_before_post: true, daily_spend_cap_usd: 10, target_audience: "Bootstrapped SaaS founders" });
  });
});

describe("Marketer autopilot", () => {
  it("proposes only behind the owner's approval", async () => {
    const sent: unknown[] = [];
    const tool = createProposeNextMovesTool(async (payload) => void sent.push(payload));
    expect(tool.requiresApproval).toBe(true);
    const outcome = await run([tool], "propose_next_moves", { summary: "Views dropped 25% week over week", moves: [{ department: "content-producer", action: "Make 3 reels for the founders playbook", why: "Reels drove 70% of views", estimatedCostUsd: 4.5 }] });
    expect(outcome.status).toBe("approval_required");
    expect(sent).toHaveLength(0);
  });

  it("ships a checklist and a config that binds the saas credential to the API host only", () => {
    expect(MARKETER_HEARTBEAT).toContain("HEARTBEAT_OK");
    const config = marketerAutopilotConfig("user_2abcTenant", "api.marketer.test");
    expect(config).toMatchObject({ ownerUserId: "user_2abcTenant", egress: { allow: ["api.marketer.test"] }, credentials: [{ name: "saas", hosts: ["api.marketer.test"] }] });
  });
});
