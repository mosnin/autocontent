import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { limit, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";
import { getBrandKit, listKits, listPlaybooks } from "./strategy.ts";

/**
 * Content department: short-form videos (the backend's "jobs": a ten-step pipeline that renders and, after approval
 * when the playbook requires it, schedules a post), carousels/stills ("image-posts"), the media library and
 * templates (remixes). Endpoints: /jobs, /image-posts, /library, /templates.
 *
 * Risk: reads LOW; making or retrying content and remixing templates spend content credits → MEDIUM. Approving,
 * rejecting or publishing content is the distribution manager's job (HIGH), never the producer's.
 */

const VIDEO_STATUS = v.picklist(["queued", "ideating", "scripting", "generating_images", "animating", "voicing", "editing", "captioning", "qa", "scheduling", "awaiting_approval", "done", "failed", "skipped"]);

export const listVideos = readTool({
  name: "list_videos",
  description: "List short-form videos, newest first, optionally by status (e.g. awaiting_approval, failed, done) or playbook.",
  input: v.object({ status: v.optional(VIDEO_STATUS), playbookId: v.optional(uuid("playbookId")), limit: limit(200, 20) }),
  request: ({ status, playbookId, limit: n }) => ({ method: "GET", path: "/jobs", query: { status_filter: status, niche_id: playbookId, limit: n } }),
});

export const getVideo = readTool({
  name: "get_video",
  description: "Read one video job: pipeline status, platform, script, schedule, provider post id, error.",
  input: v.object({ videoId: uuid("videoId") }),
  request: ({ videoId }) => ({ method: "GET", path: `/jobs/${seg(videoId)}` }),
});

export const getVideoMetrics = readTool({
  name: "get_video_metrics",
  description: "Views, likes, comments and shares of one posted video: the latest sample and its history.",
  input: v.object({ videoId: uuid("videoId") }),
  request: ({ videoId }) => ({ method: "GET", path: `/jobs/${seg(videoId)}/metrics` }),
});

export const createVideo = writeTool({
  name: "create_video",
  description: "Start the video pipeline for a playbook on one platform (spends content credits; posting still follows the playbook's approval setting).",
  input: v.object({ playbookId: uuid("playbookId"), platform: v.picklist(["tiktok", "reels", "shorts"]) }),
  risk: "MEDIUM",
  request: ({ playbookId, platform }) => ({ method: "POST", path: "/jobs", body: { niche_id: playbookId, platform } }),
});

export const retryVideo = writeTool({
  name: "retry_video",
  description: "Re-run a FAILED video from scratch (spends content credits again). Read the failure first and only retry when the cause is transient.",
  input: v.object({ videoId: uuid("videoId") }),
  risk: "MEDIUM",
  request: ({ videoId }) => ({ method: "POST", path: `/jobs/${seg(videoId)}/retry` }),
});

export const listCarousels = readTool({
  name: "list_carousels",
  description: "List carousels and single-image posts, newest first, optionally by status.",
  input: v.object({ status: v.optional(v.pipe(v.string(), v.regex(/^[a-z_]{1,32}$/))), limit: limit(200, 20) }),
  request: ({ status, limit: n }) => ({ method: "GET", path: "/image-posts", query: { status_filter: status, limit: n } }),
});

export const getCarousel = readTool({
  name: "get_carousel",
  description: "Read one carousel or image post: slides, caption, status, error.",
  input: v.object({ carouselId: uuid("carouselId") }),
  request: ({ carouselId }) => ({ method: "GET", path: `/image-posts/${seg(carouselId)}` }),
});

export const createCarousel = writeTool({
  name: "create_carousel",
  description: "Make a carousel (or a single image post) for a playbook about a topic (spends content credits).",
  input: v.object({
    playbookId: uuid("playbookId"),
    kind: v.optional(v.picklist(["single", "carousel"]), "carousel"),
    topic: v.optional(v.pipe(v.string(), v.maxLength(500)), ""),
    slideCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)), 5),
  }),
  risk: "MEDIUM",
  request: ({ playbookId, kind, topic, slideCount }) => ({ method: "POST", path: "/image-posts", body: { niche_id: playbookId, kind, topic, slide_count: slideCount } }),
});

export const retryCarousel = writeTool({
  name: "retry_carousel",
  description: "Re-run a FAILED carousel (spends content credits again).",
  input: v.object({ carouselId: uuid("carouselId") }),
  risk: "MEDIUM",
  request: ({ carouselId }) => ({ method: "POST", path: `/image-posts/${seg(carouselId)}/retry` }),
});

export const listLibraryAssets = readTool({
  name: "list_library_assets",
  description: "Browse the media library (clips, keyframes, voiceovers, finals, compositions, music) to reuse or remix.",
  input: v.object({
    kind: v.optional(v.picklist(["clip", "keyframe", "voiceover", "final", "composition", "music"])),
    playbookId: v.optional(uuid("playbookId")),
    videoId: v.optional(uuid("videoId")),
    limit: limit(200, 30),
    offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_000)), 0),
  }),
  request: ({ kind, playbookId, videoId, limit: n, offset }) => ({ method: "GET", path: "/library", query: { kind, niche_id: playbookId, job_id: videoId, limit: n, offset } }),
});

export const listTemplates = readTool({
  name: "list_templates",
  description: "List published templates (video styles, image and carousel layouts) that can be remixed.",
  input: v.object({ kind: v.optional(v.picklist(["video", "image", "carousel"])) }),
  request: ({ kind }) => ({ method: "GET", path: "/templates", query: { kind } }),
});

export const remixTemplate = writeTool({
  name: "remix_template",
  description: "Remix an image or carousel template into new images in the library (spends content credits; video templates are applied as a playbook style instead).",
  input: v.object({ templateId: uuid("templateId"), count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)), 2), note: v.optional(v.pipe(v.string(), v.maxLength(500)), "") }),
  risk: "MEDIUM",
  timeoutMs: 45_000,
  request: ({ templateId, count, note }) => ({ method: "POST", path: `/templates/${seg(templateId)}/remix`, body: { count, note } }),
});

/** The content producer's department tools (plus read access to playbooks and brand). */
export function contentTools(): AnyAgentTool[] {
  return [listVideos, getVideo, getVideoMetrics, createVideo, retryVideo, listCarousels, getCarousel, createCarousel, retryCarousel, listLibraryAssets, listTemplates, remixTemplate, listPlaybooks, getBrandKit, listKits];
}
