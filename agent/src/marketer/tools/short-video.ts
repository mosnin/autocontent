import * as v from "valibot";
import { limit, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";

/**
 * Short video (docs/short-video.md): a topic or a pasted script becomes 1 to 10 finished vertical videos from stock
 * footage, the workspace's uploads, a voiceover, subtitles and music. Endpoints: /short-videos.
 *
 * Risk: reads LOW; starting a batch spends content credits → MEDIUM, the same tier as `create_video`. The backend
 * meters every paid call, holds the batch to its own cap and the playbook/global/credit caps, and parks batches over
 * three variants or $5 in `awaiting_approval`. Only a person approves those (the approve route refuses the agent), so
 * there is deliberately no approve tool here.
 */

const settings = v.optional(
  v.object({
    aspect: v.optional(v.picklist(["9:16", "16:9", "1:1"]), "9:16"),
    durationSec: v.optional(v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(90)), 30),
    footage: v.optional(v.picklist(["stock", "uploads", "both"]), "stock"),
    uploadIds: v.optional(v.pipe(v.array(uuid("uploadIds")), v.maxLength(40)), []),
    subtitles: v.optional(v.picklist(["highlight", "sentence", "word", "off"]), "highlight"),
    music: v.optional(v.picklist(["library", "generated", "none"]), "library"),
    tone: v.optional(v.pipe(v.string(), v.maxLength(200)), ""),
  }),
  {},
);

type Settings = v.InferOutput<typeof settings>;

/** The agent's flat options → the backend's settings object. Anything not named keeps the backend default. */
export function toBackendSettings(s: Settings): Record<string, unknown> {
  const sources = s.footage === "uploads" ? ["uploads"] : s.footage === "both" ? ["pexels", "pixabay", "uploads"] : ["pexels", "pixabay"];
  return {
    look: { aspect: s.aspect, duration_sec: s.durationSec, tone: s.tone },
    footage: { sources, upload_ids: s.uploadIds },
    subtitles: s.subtitles === "off" ? { enabled: false } : { enabled: true, mode: s.subtitles },
    music: { mode: s.music },
  };
}

export const listShortVideos = readTool({
  name: "list_short_videos",
  description: "List recent short-video batches (topic or script → stock-footage videos) with each variant's status and stage.",
  input: v.object({ limit: limit(100, 10) }),
  request: ({ limit: n }) => ({ method: "GET", path: "/short-videos", query: { limit: n } }),
});

export const getShortVideo = readTool({
  name: "get_short_video",
  description: "Read one short-video batch: status, estimate and spend, and per variant the hook, stage, footage credits and error.",
  input: v.object({ batchId: uuid("batchId") }),
  request: ({ batchId }) => ({ method: "GET", path: `/short-videos/${seg(batchId)}` }),
});

export const createShortVideo = writeTool({
  name: "create_short_video",
  description:
    "Make short vertical videos from a topic (Marketer writes the script) or from a script you pass, using stock footage or the workspace's uploads, a voiceover, subtitles and music. variants 1-10, each with its own hook and footage (spends content credits). Batches over 3 variants or $5 wait for a person to approve them in the app; tell the person when that happens.",
  input: v.pipe(
    v.object({
      topic: v.optional(v.pipe(v.string(), v.maxLength(500)), ""),
      script: v.optional(v.pipe(v.string(), v.maxLength(6000)), ""),
      title: v.optional(v.pipe(v.string(), v.maxLength(200)), ""),
      playbookId: v.optional(uuid("playbookId")),
      variants: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)), 1),
      settings,
    }),
    v.check((a) => (a.topic ?? "").trim().length >= 3 || (a.script ?? "").trim().split(/\s+/).length >= 5, "Give a topic (3+ characters) or a script (5+ words)."),
  ),
  risk: "MEDIUM",
  request: ({ topic, script, title, playbookId, variants, settings: s }) => {
    const useScript = (script ?? "").trim().split(/\s+/).length >= 5;
    return {
      method: "POST",
      path: "/short-videos",
      body: {
        source: useScript ? "script" : "topic",
        topic: topic ?? "",
        script: useScript ? script : "",
        title: title ?? "",
        ...(playbookId ? { niche_id: playbookId } : {}),
        variants,
        settings: toBackendSettings(s as Settings),
      },
    };
  },
});

export const shortVideoTools = [listShortVideos, getShortVideo, createShortVideo];
