// Status vocabulary for the work tools (Content, SEO, Playbooks).
// Pure + client-safe. One place maps raw pipeline states to human words and
// to StatusBadge tones (positive done, attention needs you, negative failed).

import type { StatusTone } from "@/design-system";
import type { ArticleStatus, ImagePost, Job, JobStatus, Platform } from "@/lib/types";

export const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts" };
export const platformLabel = (p: Platform | string) => PLATFORM_LABEL[p] ?? p;

/* ------------------------------------------------------------------ videos */

/** The video pipeline, in order. `awaiting_approval` sits between QA and scheduling when a playbook reviews first. */
export const VIDEO_STEPS: { id: JobStatus; label: string; detail: string }[] = [
  { id: "queued", label: "Queued", detail: "Waiting for a worker" },
  { id: "ideating", label: "Idea", detail: "Picks a topic and a hook from the playbook" },
  { id: "scripting", label: "Script", detail: "Writes narration scene by scene" },
  { id: "generating_images", label: "Keyframes", detail: "Renders a still for every scene" },
  { id: "animating", label: "Animation", detail: "Turns each still into a clip" },
  { id: "voicing", label: "Voiceover", detail: "Narrates the script" },
  { id: "editing", label: "Edit", detail: "Cuts clips, voice and music together" },
  { id: "captioning", label: "Captions", detail: "Burns in word-timed captions" },
  { id: "qa", label: "QA", detail: "Checks the hook, pacing and render" },
  { id: "awaiting_approval", label: "Your approval", detail: "Waits for a yes before posting" },
  { id: "scheduling", label: "Schedule", detail: "Books the next posting window" },
  { id: "done", label: "Posted", detail: "Live on the platform" },
];

const JOB_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  ideating: "Ideating",
  scripting: "Scripting",
  generating_images: "Rendering keyframes",
  animating: "Animating",
  voicing: "Voicing",
  editing: "Editing",
  captioning: "Captioning",
  qa: "In QA",
  scheduling: "Scheduling",
  awaiting_approval: "Needs approval",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export const jobStatusLabel = (s: JobStatus) => JOB_LABEL[s] ?? s;

export const JOB_IN_PROGRESS = new Set<JobStatus>(["queued", "ideating", "scripting", "generating_images", "animating", "voicing", "editing", "captioning", "qa", "scheduling"]);

export function jobTone(s: JobStatus): StatusTone {
  if (s === "done") return "positive";
  if (s === "failed") return "negative";
  if (s === "awaiting_approval") return "attention";
  if (s === "skipped") return "neutral";
  return "neutral";
}


export type VideoFilter = "all" | "awaiting" | "in_progress" | "done" | "failed";
export const VIDEO_FILTERS: { value: VideoFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Needs approval" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

export function matchesVideo(j: Job, f: VideoFilter): boolean {
  if (f === "all") return true;
  if (f === "awaiting") return j.status === "awaiting_approval";
  if (f === "done") return j.status === "done";
  if (f === "failed") return j.status === "failed";
  return JOB_IN_PROGRESS.has(j.status);
}

/** Index of the step a job is on (for the checklist). -1 when unknown. */
export function videoStepIndex(s: JobStatus): number {
  return VIDEO_STEPS.findIndex((x) => x.id === s);
}

export const jobTitle = (j: Pick<Job, "id" | "script">) => j.script?.idea?.hook ?? j.script?.idea?.topic ?? `Video ${j.id.slice(0, 8)}`;

/* --------------------------------------------------------------- carousels */

const POST_LABEL: Record<string, string> = {
  queued: "Queued",
  planning: "Planning",
  generating: "Rendering slides",
  awaiting_approval: "Needs approval",
  scheduling: "Scheduling",
  done: "Done",
  failed: "Failed",
};
export const postStatusLabel = (s: string) => POST_LABEL[s] ?? s.replaceAll("_", " ");
export function postTone(s: string): StatusTone {
  if (s === "done") return "positive";
  if (s === "failed") return "negative";
  if (s === "awaiting_approval") return "attention";
  return "neutral";
}
export const POST_IN_PROGRESS = new Set(["queued", "planning", "generating", "scheduling"]);

export function postTitle(p: ImagePost): string {
  const caption = typeof p.payload?.caption === "string" ? (p.payload.caption as string).split("\n")[0] : "";
  return p.topic || caption || (p.kind === "carousel" ? "Carousel" : "Still image");
}

/* ---------------------------------------------------------------- articles */

export const ARTICLE_STEPS: { id: ArticleStatus; label: string; detail: string }[] = [
  { id: "queued", label: "Queued", detail: "Waiting for a worker" },
  { id: "researching", label: "Research", detail: "Reads what ranks for the keyword" },
  { id: "outlining", label: "Outline", detail: "Plans headings and angle" },
  { id: "writing", label: "Draft", detail: "Writes the long-form piece" },
  { id: "qa", label: "QA", detail: "Scores E-E-A-T, readability and keyword use" },
  { id: "metadata", label: "Metadata", detail: "Title, slug, meta description, JSON-LD" },
  { id: "imaging", label: "Hero image", detail: "Generates an editorial image" },
  { id: "done", label: "Ready", detail: "Ready to publish or repurpose" },
];

const ARTICLE_LABEL: Record<ArticleStatus, string> = {
  queued: "Queued",
  researching: "Researching",
  outlining: "Outlining",
  writing: "Writing",
  qa: "In QA",
  metadata: "Metadata",
  imaging: "Imaging",
  done: "Ready",
  failed: "Failed",
};
export const articleStatusLabel = (s: ArticleStatus) => ARTICLE_LABEL[s] ?? s;
export const ARTICLE_IN_PROGRESS = new Set<ArticleStatus>(["queued", "researching", "outlining", "writing", "qa", "metadata", "imaging"]);
export function articleTone(s: ArticleStatus): StatusTone {
  if (s === "done") return "positive";
  if (s === "failed") return "negative";
  return "neutral";
}
