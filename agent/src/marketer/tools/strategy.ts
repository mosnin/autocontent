import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { reason, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";

/**
 * Strategy department: playbooks (the backend calls them "niches": who to talk to, how to sound, what to make,
 * where to post), the brand kit and kits. Endpoints: /niches, /niches/draft, /niches/{id}/performance, /brand-kit,
 * /kits.
 *
 * Risk: reads LOW; drafting (a metered LLM call) and creating/updating a playbook MEDIUM. The two playbook fields
 * that change spend or publishing behaviour are NOT editable here: new playbooks always require approval before
 * posting (`approve_before_post: true`), and the daily spend cap has its own HIGH tool. Editing the brand kit
 * changes every future post and draft: HIGH.
 */

const PLATFORM = v.picklist(["tiktok", "reels", "shorts"]);
const text = (max: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(max));
const hashtag = v.pipe(v.string(), v.minLength(1), v.maxLength(60));
const postingWindow = v.object({
  hour: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(23)),
  minute: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(59)),
  tz: v.pipe(v.string(), v.regex(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/, "tz must be an IANA time zone")),
});
/** Hard ceiling on a playbook's daily content spend the agent may set (people can go higher in the app). */
export const MAX_PLAYBOOK_DAILY_CAP_USD = 200;

export const listPlaybooks = readTool({
  name: "list_playbooks",
  description: "List the account's playbooks (audience, voice, visual style, platforms, posting windows, daily spend cap).",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/niches" }),
});

export const getPlaybook = readTool({
  name: "get_playbook",
  description: "Read one playbook in full (creative brief, platforms, posting windows, spend cap, approval setting).",
  input: v.object({ playbookId: uuid("playbookId") }),
  request: ({ playbookId }) => ({ method: "GET", path: `/niches/${seg(playbookId)}` }),
});

export const getPlaybookPerformance = readTool({
  name: "get_playbook_performance",
  description: "Performance attribution for one playbook over the last N days: per-video views and engagement against spend.",
  input: v.object({ playbookId: uuid("playbookId"), days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365)), 30) }),
  request: ({ playbookId, days }) => ({ method: "GET", path: `/niches/${seg(playbookId)}/performance`, query: { days } }),
});

export const draftPlaybook = writeTool({
  name: "draft_playbook",
  description: "Draft a full playbook spec from one sentence about the product and audience (a metered AI call; nothing is saved). Review the draft with the person before create_playbook.",
  input: v.object({ description: v.pipe(v.string(), v.minLength(8), v.maxLength(1000)) }),
  risk: "MEDIUM",
  sideEffect: "external",
  timeoutMs: 60_000,
  request: ({ description }) => ({ method: "POST", path: "/niches/draft", body: { description } }),
});

const playbookFields = {
  title: text(120),
  description: text(2000),
  targetAudience: text(1000),
  hashtags: v.pipe(v.array(hashtag), v.maxLength(30)),
  visualStyle: text(1000),
  voice: text(1000),
  targetDurationSec: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(180)),
  sceneCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
  postingWindows: v.pipe(v.array(postingWindow), v.minLength(1), v.maxLength(12)),
  platforms: v.pipe(v.array(PLATFORM), v.minLength(1), v.maxLength(3)),
};

export const createPlaybook = writeTool({
  name: "create_playbook",
  description: `Create a playbook. Every playbook the agent creates requires a person's approval before anything posts, and starts with a daily content spend cap (USD, at most ${MAX_PLAYBOOK_DAILY_CAP_USD}).`,
  input: v.object({ ...playbookFields, dailySpendCapUsd: v.pipe(v.number(), v.minValue(0.5), v.maxValue(MAX_PLAYBOOK_DAILY_CAP_USD)) }),
  risk: "MEDIUM",
  request: (a) => ({
    method: "POST",
    path: "/niches",
    body: {
      title: a.title,
      description: a.description,
      target_audience: a.targetAudience,
      hashtags: a.hashtags,
      visual_style: a.visualStyle,
      voice: a.voice,
      target_duration_sec: a.targetDurationSec,
      scene_count: a.sceneCount,
      posting_windows: a.postingWindows,
      platforms: a.platforms,
      daily_spend_cap_usd: a.dailySpendCapUsd,
      // Fail closed: content made by agents waits in the inbox until a person approves it.
      approve_before_post: true,
    },
  }),
});

export const updatePlaybook = writeTool({
  name: "update_playbook",
  description: "Update a playbook's positioning fields (title, description, audience, hashtags, visual style, voice, duration, scenes, posting windows, platforms). Only the fields you pass change. Spend cap and approval settings are not editable here.",
  input: v.object({
    playbookId: uuid("playbookId"),
    title: v.optional(playbookFields.title),
    description: v.optional(playbookFields.description),
    targetAudience: v.optional(playbookFields.targetAudience),
    hashtags: v.optional(playbookFields.hashtags),
    visualStyle: v.optional(playbookFields.visualStyle),
    voice: v.optional(playbookFields.voice),
    targetDurationSec: v.optional(playbookFields.targetDurationSec),
    sceneCount: v.optional(playbookFields.sceneCount),
    postingWindows: v.optional(playbookFields.postingWindows),
    platforms: v.optional(playbookFields.platforms),
  }),
  risk: "MEDIUM",
  // A partial PUT: replaying the same fields leaves the same record.
  idempotent: true,
  request: ({ playbookId, ...a }) => ({
    method: "PUT",
    path: `/niches/${seg(playbookId)}`,
    body: dropUndefined({
      title: a.title,
      description: a.description,
      target_audience: a.targetAudience,
      hashtags: a.hashtags,
      visual_style: a.visualStyle,
      voice: a.voice,
      target_duration_sec: a.targetDurationSec,
      scene_count: a.sceneCount,
      posting_windows: a.postingWindows,
      platforms: a.platforms,
    }),
  }),
});

export const setPlaybookSpendCap = writeTool({
  name: "set_playbook_spend_cap",
  description: `Change a playbook's daily content spend cap in USD (at most ${MAX_PLAYBOOK_DAILY_CAP_USD}). Raising it lets the pipelines spend more every day.`,
  input: v.object({ playbookId: uuid("playbookId"), dailySpendCapUsd: v.pipe(v.number(), v.minValue(0.5), v.maxValue(MAX_PLAYBOOK_DAILY_CAP_USD)), reason }),
  risk: "HIGH",
  idempotent: true,
  request: ({ playbookId, dailySpendCapUsd }) => ({ method: "PUT", path: `/niches/${seg(playbookId)}`, body: { daily_spend_cap_usd: dailySpendCapUsd } }),
});

export const getBrandKit = readTool({
  name: "get_brand_kit",
  description: "Read the brand kit: brand name, tagline, tone of voice, target audience, banned words, preferred hashtags, color.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/brand-kit" }),
});

export const updateBrandKit = writeTool({
  name: "update_brand_kit",
  description: "Replace the brand kit (affects every future draft, post and article). Send the complete kit: read it first with get_brand_kit.",
  input: v.object({
    brandName: v.pipe(v.string(), v.maxLength(120)),
    tagline: v.pipe(v.string(), v.maxLength(200)),
    toneOfVoice: v.pipe(v.string(), v.maxLength(300)),
    targetAudience: v.pipe(v.string(), v.maxLength(300)),
    bannedWords: v.pipe(v.array(v.pipe(v.string(), v.maxLength(60))), v.maxLength(100)),
    preferredHashtags: v.pipe(v.array(hashtag), v.maxLength(50)),
    colorHex: v.optional(v.union([v.literal(""), v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/))]), ""),
    reason,
  }),
  risk: "HIGH",
  // Full replace: a replay writes the same kit.
  idempotent: true,
  request: (a) => ({
    method: "PUT",
    path: "/brand-kit",
    body: { brand_name: a.brandName, tagline: a.tagline, tone_of_voice: a.toneOfVoice, target_audience: a.targetAudience, banned_words: a.bannedWords, preferred_hashtags: a.preferredHashtags, color_hex: a.colorHex },
  }),
});

export const listKits = readTool({
  name: "list_kits",
  description: "List design, ad and writing kits (reusable style guides a playbook can reference).",
  input: v.object({ kind: v.optional(v.picklist(["design", "ad", "writing"])) }),
  request: ({ kind }) => ({ method: "GET", path: "/kits", query: { kind } }),
});

function dropUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/** The strategist's department tools. */
export function strategyTools(): AnyAgentTool[] {
  return [listPlaybooks, getPlaybook, getPlaybookPerformance, draftPlaybook, createPlaybook, updatePlaybook, setPlaybookSpendCap, getBrandKit, updateBrandKit, listKits];
}
