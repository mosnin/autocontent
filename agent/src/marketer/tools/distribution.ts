import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { reason, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";
import { listCarousels, listVideos } from "./content.ts";
import { decideInboxItem, getWorkspaceInbox } from "./workspace.ts";

/**
 * Distribution department: the content calendar, campaigns (Studio + Press + Ads lanes against a window and a
 * content-credit budget), channel connection (Ayrshare) and the publishing decisions on finished content.
 * Endpoints: /calendar, /campaigns, /connect/ayrshare, /jobs/{id}/approve|reject, /image-posts/{id}/approve,
 * /workspace/inbox/{kind}/{ref}/decide.
 *
 * Risk: reads LOW; drafting a campaign, pausing one and starting a channel connection MEDIUM (nothing is published
 * or spent by them); starting a campaign (spends its budget and publishes on cadence), approving content
 * (publishes) and rejecting it (discards the render) HIGH.
 */

const isoDate = v.pipe(v.string(), v.isoTimestamp("must be an ISO 8601 timestamp"));

export const getCalendar = readTool({
  name: "get_calendar",
  description: "Scheduled videos and article activity in a window: the next N days by default, or an explicit start/end (ISO timestamps).",
  input: v.object({ days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)), 30), start: v.optional(isoDate), end: v.optional(isoDate) }),
  request: ({ days, start, end }) => ({ method: "GET", path: "/calendar", query: { days, start, end } }),
});

export const listCampaigns = readTool({
  name: "list_campaigns",
  description: "List marketing campaigns (status, window, content-credit budget).",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/campaigns" }),
});

export const getCampaign = readTool({
  name: "get_campaign",
  description: "Read one campaign with its lanes (video, article, image, ad), spend so far in USD and output totals.",
  input: v.object({ campaignId: uuid("campaignId") }),
  request: ({ campaignId }) => ({ method: "GET", path: `/campaigns/${seg(campaignId)}` }),
});

export const createCampaign = writeTool({
  name: "create_campaign",
  description: "Create a DRAFT campaign with a content-credit budget in USD (nothing runs or spends until start_campaign is approved).",
  input: v.object({
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
    objective: v.optional(v.pipe(v.string(), v.maxLength(1000)), ""),
    budgetUsd: v.pipe(v.number(), v.minValue(1), v.maxValue(10_000)),
    startsAt: v.optional(isoDate),
    endsAt: v.optional(isoDate),
  }),
  risk: "MEDIUM",
  request: ({ name, objective, budgetUsd, startsAt, endsAt }) => ({ method: "POST", path: "/campaigns", body: { name, objective, budget_usd: budgetUsd, starts_at: startsAt ?? null, ends_at: endsAt ?? null } }),
});

export const startCampaign = writeTool({
  name: "start_campaign",
  description: "Start (or resume) a campaign: its lanes begin producing and publishing on cadence and spending the campaign budget.",
  input: v.object({ campaignId: uuid("campaignId"), reason }),
  risk: "HIGH",
  sideEffect: "external",
  // Setting status "running" twice leaves it running.
  idempotent: true,
  request: ({ campaignId }) => ({ method: "POST", path: `/campaigns/${seg(campaignId)}/start` }),
});

export const pauseCampaign = writeTool({
  name: "pause_campaign",
  description: "Pause a running campaign (stops new production and posting; resumable with start_campaign).",
  input: v.object({ campaignId: uuid("campaignId"), reason }),
  risk: "MEDIUM",
  idempotent: true,
  request: ({ campaignId }) => ({ method: "POST", path: `/campaigns/${seg(campaignId)}/pause` }),
});

export const getChannelStatus = readTool({
  name: "get_channel_status",
  description: "Whether social channels are connected (Ayrshare profile present). Posting needs a connected profile.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/connect/ayrshare/status" }),
});

export const startChannelConnection = writeTool({
  name: "start_channel_connection",
  description: "Create (or reuse) the account's Ayrshare profile and return a login URL the PERSON must open to link their social accounts. Share the URL; never open it yourself.",
  input: v.object({}),
  risk: "MEDIUM",
  sideEffect: "external",
  request: () => ({ method: "POST", path: "/connect/ayrshare" }),
});

export const approveVideo = writeTool({
  name: "approve_video",
  description: "Approve a video that is awaiting_approval: it is uploaded and scheduled to post on its platform.",
  input: v.object({ videoId: uuid("videoId"), reason }),
  risk: "HIGH",
  sideEffect: "external",
  // Atomic claim server-side: a second approve answers 409 and never posts twice.
  idempotent: true,
  request: ({ videoId }) => ({ method: "POST", path: `/jobs/${seg(videoId)}/approve` }),
});

export const rejectVideo = writeTool({
  name: "reject_video",
  description: "Reject a video that is awaiting_approval: it is marked failed and never posts.",
  input: v.object({ videoId: uuid("videoId"), reason }),
  risk: "HIGH",
  idempotent: true,
  request: ({ videoId }) => ({ method: "POST", path: `/jobs/${seg(videoId)}/reject` }),
});

export const approveCarousel = writeTool({
  name: "approve_carousel",
  description: "Approve a carousel or image post that is awaiting approval: it is scheduled to post.",
  input: v.object({ carouselId: uuid("carouselId"), reason }),
  risk: "HIGH",
  sideEffect: "external",
  idempotent: true,
  request: ({ carouselId }) => ({ method: "POST", path: `/image-posts/${seg(carouselId)}/approve` }),
});

/** The distribution manager's department tools. */
export function distributionTools(): AnyAgentTool[] {
  return [getCalendar, listCampaigns, getCampaign, createCampaign, startCampaign, pauseCampaign, getChannelStatus, startChannelConnection, getWorkspaceInbox, decideInboxItem, approveVideo, rejectVideo, approveCarousel, listVideos, listCarousels];
}
