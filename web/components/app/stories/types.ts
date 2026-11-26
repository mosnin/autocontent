// Story videos (backend /api/v1/stories, docs/story-video.md).

export type StoryStatus = "draft" | "writing" | "script_ready" | "boarding" | "storyboard_ready" | "awaiting_approval" | "rendering" | "done" | "failed";
export type StoryAspect = "9:16" | "16:9" | "1:1";

export interface StoryScene {
  heading: string;
  script: string;
}

export interface StoryCharacter {
  name: string;
  visible: boolean;
  static_features: string;
  dynamic_features: string;
}

export interface StoryShot {
  idx: number;
  scene_idx: number;
  visual: string;
  first_frame: string;
  motion: string;
  narration: string;
  characters: string[];
  duration_sec: number;
  frame_rev: number;
  frame_ready: boolean;
  clip_ready: boolean;
}

export interface Story {
  id: string;
  niche_id: string | null;
  title: string;
  mode: "idea" | "script";
  source: string;
  requirement: string;
  style: string;
  aspect: StoryAspect;
  status: StoryStatus;
  stage: string;
  revision: number;
  logline: string;
  scenes: StoryScene[];
  characters: StoryCharacter[];
  shots: StoryShot[];
  portraits: string[];
  estimate_usd: string;
  spent_usd: string;
  approval_status: string | null;
  needs_approval: boolean;
  has_video: boolean;
  error: string | null;
  progress: { shots: number; frames: number; clips: number };
  created_at: string | null;
  updated_at: string | null;
}

export interface StorySummary {
  id: string;
  title: string;
  status: StoryStatus;
  stage: string;
  shots: number;
  spent_usd: string;
  has_video: boolean;
  created_at: string | null;
}

export const STORY_BUSY: ReadonlySet<StoryStatus> = new Set(["writing", "boarding", "rendering"]);

/** The four steps a person moves through, and which one a status belongs to. */
export const STORY_STEPS = [
  { id: "script", label: "Script" },
  { id: "storyboard", label: "Storyboard" },
  { id: "render", label: "Render" },
  { id: "video", label: "Video" },
] as const;

export function storyStep(s: Pick<Story, "status" | "stage">): number {
  switch (s.status) {
    case "draft":
    case "writing":
    case "script_ready":
      return 0;
    case "boarding":
    case "storyboard_ready":
      return 1;
    case "awaiting_approval":
    case "rendering":
      return 2;
    case "done":
      return 3;
    case "failed": {
      const stage = s.stage.split(":")[0];
      return stage === "render" ? 2 : stage === "storyboard" || stage === "frame" ? 1 : 0;
    }
  }
}

export const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  draft: "Draft",
  writing: "Writing",
  script_ready: "Script ready",
  boarding: "Drawing",
  storyboard_ready: "Storyboard ready",
  awaiting_approval: "Needs approval",
  rendering: "Rendering",
  done: "Done",
  failed: "Stopped",
};

export function storyTone(status: StoryStatus): "neutral" | "positive" | "negative" | "attention" | "accent" {
  if (status === "done") return "positive";
  if (status === "failed") return "negative";
  if (status === "awaiting_approval") return "attention";
  if (STORY_BUSY.has(status)) return "accent";
  return "neutral";
}

export const storyMedia = {
  frame: (id: string, shot: StoryShot) => `/api/proxy/api/v1/stories/${encodeURIComponent(id)}/shots/${shot.idx}/frame?v=${shot.frame_rev}`,
  video: (id: string, revision: number) => `/api/proxy/api/v1/stories/${encodeURIComponent(id)}/video?r=${revision}`,
};
