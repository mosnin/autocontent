// Tests for the pure formatter behind chat approval cards
// (components/chat/approval-format.ts) and the inbox helpers in
// lib/workspace.ts. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectNames, formatApprovalArgs, formatMoney, formatPercent, formatWhen, keyWords } from "../components/chat/approval-format.ts";
import { EMPTY_INBOX, type Inbox, type RequiredAction, requiredActionFocusId, requiredActionTarget, shellInbox, waitingCount } from "../lib/workspace.ts";

const UTC = { timeZone: "UTC" };
const row = (label: string, value: string) => ({ label, value });

// ── labels ───────────────────────────────────────────────────────────────────

test("keys split on underscores, dashes and camelCase", () => {
  assert.deepEqual(keyWords("from_daily_usd"), ["from", "daily", "usd"]);
  assert.deepEqual(keyWords("newDailyBudgetCents"), ["new", "daily", "budget", "cents"]);
  assert.deepEqual(keyWords("target-CPA"), ["target", "cpa"]);
});

test("the reported case: no raw field names, money reads as money", () => {
  const rows = formatApprovalArgs({ campaign: "Spring launch", from_daily_usd: 40, to: "Spark ad · 3 pasta mistakes", daily_usd: 40 }, UTC);
  assert.deepEqual(rows, [row("Campaign", "Spring launch"), row("From", "$40 a day"), row("To", "Spark ad · 3 pasta mistakes"), row("Amount", "$40 a day")]);
  for (const r of rows) assert.doesNotMatch(`${r.label} ${r.value}`, /usd|_/i);
});

// ── money ────────────────────────────────────────────────────────────────────

test("money: whole dollars drop cents, cents and micros convert, strings parse, negatives keep their sign", () => {
  assert.equal(formatMoney(40), "$40");
  assert.equal(formatMoney(12.5), "$12.50");
  assert.equal(formatMoney(1200), "$1,200");
  assert.equal(formatMoney(-3.2), "−$3.20");
  assert.deepEqual(formatApprovalArgs({ new_daily_budget_cents: 3550 }), [row("New budget", "$35.50 a day")]);
  assert.deepEqual(formatApprovalArgs({ bid_micros: 1_250_000 }), [row("Bid", "$1.25")]);
  assert.deepEqual(formatApprovalArgs({ target_cpa_usd: "11.40" }), [row("Target CPA", "$11.40")]);
  assert.deepEqual(formatApprovalArgs({ monthly_cap_usd: 900 }), [row("Cap", "$900 a month")]);
});

test("a money word without a number is left as text", () => {
  assert.deepEqual(formatApprovalArgs({ budget: "shared with Spring launch" }), [row("Budget", "shared with Spring launch")]);
});

// ── percentages ──────────────────────────────────────────────────────────────

test("percent: _pct is already a percentage; rates between 0 and 1 are fractions", () => {
  assert.equal(formatPercent(12.5), "12.5%");
  assert.equal(formatPercent(30), "30%");
  assert.deepEqual(formatApprovalArgs({ increase_pct: 12.5, win_rate: 0.31, budget_share: 1 }), [row("Increase", "12.5%"), row("Win rate", "31%"), row("Budget share", "100%")]);
});

// ── dates ────────────────────────────────────────────────────────────────────

test("dates: ISO values are formatted and the _at suffix is dropped", () => {
  assert.equal(formatWhen("2026-12-01"), "Dec 1, 2026");
  assert.equal(formatWhen("2026-11-18T09:00:00Z", "UTC"), "Nov 18, 9:00 AM");
  assert.equal(formatWhen("next tuesday"), null);
  assert.equal(formatWhen("2026-13-45"), null);
  assert.deepEqual(formatApprovalArgs({ scheduled_at: "2026-11-18T09:00:00Z", start_date: "2026-12-01" }, UTC), [row("Scheduled", "Nov 18, 9:00 AM"), row("Start", "Dec 1, 2026")]);
});

// ── ids and names ────────────────────────────────────────────────────────────

const CAMPAIGN = "9a1e44d2-6b3c-4e58-a7f0-1d2c3b4a5e6f";

test("ids: a known id shows its name, an unknown uuid is shortened, never the raw key", () => {
  assert.deepEqual(formatApprovalArgs({ campaign_id: CAMPAIGN }, { names: { [CAMPAIGN]: "Fresh pasta, Spring" } }), [row("Campaign", "Fresh pasta, Spring")]);
  assert.deepEqual(formatApprovalArgs({ campaign_id: CAMPAIGN }), [row("Campaign", "ID 9a1e44d2")]);
  assert.deepEqual(formatApprovalArgs({ niche_id: "n1" }), [row("Playbook", "n1")]);
});

test("ids: dropped when a sibling already names the same thing", () => {
  assert.deepEqual(formatApprovalArgs({ campaign_id: CAMPAIGN, campaign_name: "Spring launch" }), [row("Campaign", "Spring launch")]);
  assert.deepEqual(formatApprovalArgs({ campaign: "Spring launch", campaign_id: CAMPAIGN }), [row("Campaign", "Spring launch")]);
});

test("collectNames finds id/name pairs in nested tool output and is bounded", () => {
  assert.deepEqual(collectNames({ items: [{ id: "n1", title: "Pasta at home", campaigns: [{ id: 7, name: "Spring" }] }] }), { n1: "Pasta at home", "7": "Spring" });
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, name: `N${i}` }));
  assert.equal(Object.keys(collectNames(many, {}, 10)).length, 10);
  assert.deepEqual(collectNames(null), {});
  assert.deepEqual(collectNames("text"), {});
});

// ── everything else ──────────────────────────────────────────────────────────

test("values: booleans, enums, platforms, durations, lists and nested objects read as words", () => {
  assert.deepEqual(formatApprovalArgs({ auto_post: true, status: "awaiting_approval", platform: "meta_ads", duration_sec: 45, count: 3, tags: ["pasta", "weeknight"], targeting: { geo: "US", age_min: 25 } }, { max: 10 }), [
    row("Auto post", "Yes"),
    row("Status", "Awaiting approval"),
    row("Platform", "Meta Ads"),
    row("Duration", "45 seconds"),
    row("How many", "3"),
    row("Tags", "pasta, weeknight"),
    row("Targeting", "geo US, age min 25"),
  ]);
});

test("plumbing and empty values are hidden; the list is capped", () => {
  assert.deepEqual(formatApprovalArgs({ type: "human-question", idempotency_key: "k", tenant_id: "t", note: "", tags: [], missing: null, name: "Keep me" }), [row("Name", "Keep me")]);
  const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field_${i}`, i]));
  assert.equal(formatApprovalArgs(wide).length, 6);
  assert.equal(formatApprovalArgs(wide, { max: 3 }).length, 3);
});

test("non-objects give no rows and never throw", () => {
  for (const bad of [null, undefined, "x", 3, [1, 2], true]) assert.deepEqual(formatApprovalArgs(bad), []);
  assert.doesNotThrow(() => formatApprovalArgs({ a: { b: { c: { d: { e: 1 } } } }, big: "x".repeat(5000), n: Number.NaN }));
});

test("long text is clipped", () => {
  const [r] = formatApprovalArgs({ caption: "word ".repeat(100) });
  assert.ok(r!.value.length <= 120);
  assert.ok(r!.value.endsWith("…"));
});

// ── workspace: required actions in the inbox ─────────────────────────────────

const action = (id: string, over: Partial<RequiredAction> = {}): RequiredAction => ({
  id,
  kind: "indeterminate_outcome",
  action: "content.post.send",
  title: "We can't confirm the post went out",
  detail: "Check video_post 3f2b before trying again.",
  target_type: "video_post",
  target_id: "3f2b",
  principal: "system",
  created_at: "2026-11-17T08:12:00Z",
  resolve_path: `/api/v1/workspace/required-actions/${id}/resolve`,
  resolutions: ["confirmed_succeeded", "confirmed_failed"],
  ...over,
});

const inbox: Inbox = {
  items: [{ id: "video:2", kind: "video", ref_id: "2", title: "Salt rule", detail: "", niche_id: null, created_at: "2026-11-17T09:00:00Z" }],
  counts: { total: 1, video: 1, carousel: 0, ad_change: 0, required_action: 2 },
  required_actions: [action("a"), action("b")],
};

test("waitingCount adds required actions to the approvals; null and old payloads are safe", () => {
  assert.equal(waitingCount(inbox), 3);
  assert.equal(waitingCount(null), 0);
  assert.equal(waitingCount(EMPTY_INBOX), 0);
  // A payload from before the rails has neither field.
  assert.equal(waitingCount({ items: inbox.items, counts: { total: 1, video: 1, carousel: 0, ad_change: 0 } }), 1);
});

test("shellInbox puts required actions first for the sidebar and counts them, without touching the original", () => {
  const shell = shellInbox(inbox)!;
  assert.equal(shell.counts.total, 3);
  assert.deepEqual(shell.items.map((i) => i.id), [requiredActionFocusId("a"), requiredActionFocusId("b"), "video:2"]);
  assert.equal(shell.items[0]!.title, "We can't confirm the post went out");
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.counts.total, 1);
  assert.equal(shellInbox(null), null);
  assert.equal(shellInbox(EMPTY_INBOX), EMPTY_INBOX);
});

test("requiredActionTarget names known targets and links them; unknown ones fall back to words with no link", () => {
  assert.deepEqual(requiredActionTarget({ target_type: "ad_campaign", target_id: "c 1" }), { label: "Ad campaign", where: "in the ad platform", href: "/paid/campaigns/c%201", known: true });
  assert.deepEqual(requiredActionTarget({ target_type: "weird_thing", target_id: "z" }), { label: "Weird thing", where: "on the platform", href: null, known: false });
  assert.equal(requiredActionTarget({ target_type: "", target_id: "" }).label, "The platform");
  assert.equal(requiredActionTarget({ target_type: "ad_campaign", target_id: "" }).href, null);
});
