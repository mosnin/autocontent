// Fixture story videos for /preview/app/content/stories/* (no API). One per step.
import type { Story, StoryShot, StoryStatus, StorySummary } from "@/components/app/stories/types";

const SHOTS: Array<Pick<StoryShot, "first_frame" | "motion" | "narration" | "characters">> = [
  { first_frame: "Wide shot of a quiet cafe at dawn, Mia behind the bar on the left.", motion: "Slow push-in toward the bar as the lights flicker on.", narration: "", characters: ["Mia"] },
  { first_frame: "Medium shot, the stranger in a grey coat at the door.", motion: "Static camera; the man in the grey coat steps inside, shaking off rain.", narration: "Two flat whites, please.", characters: ["The stranger"] },
  { first_frame: "Close-up of two cups on the counter.", motion: "Rack focus from the first cup to the empty seat behind it.", narration: "", characters: [] },
  { first_frame: "Over-the-shoulder shot past Mia toward the window table.", motion: "Slow pan right to the untouched second cup.", narration: "Who's the second one for?", characters: ["Mia", "The stranger"] },
  { first_frame: "Wide shot, the stranger alone at the window table.", motion: "The camera drifts back as he slides the cup across the table.", narration: "", characters: ["The stranger"] },
  { first_frame: "Close-up on Mia, apron tied, smiling.", motion: "She sits down opposite him; gentle push-in.", narration: "Today, it's for me.", characters: ["Mia"] },
];

function shots(ready: number, clips = 0): StoryShot[] {
  return SHOTS.map((s, i) => ({ idx: i, scene_idx: i < 3 ? 0 : 1, visual: s.first_frame, duration_sec: 5, frame_rev: 0, frame_ready: i < ready, clip_ready: i < clips, ...s }));
}

function story(id: string, status: StoryStatus, over: Partial<Story> = {}): Story {
  return {
    id,
    niche_id: null,
    title: "The Second Cup",
    mode: "idea",
    source: "A night-shift barista notices the same stranger orders a coffee for someone who never arrives.",
    requirement: "Coffee lovers, warm and a little funny",
    style: "35mm film, soft morning light",
    aspect: "9:16",
    status,
    stage: "",
    revision: 0,
    logline: "Every morning a stranger buys two coffees. One morning, Mia finds out who the second is for.",
    scenes: [
      { heading: "INT. CAFE - DAWN", script: "Mia flips the sign to OPEN. The door chimes. A STRANGER in a grey coat shakes off the rain.\n\nSTRANGER: Two flat whites, please.\n\nMia sets two cups on the counter, glancing at the empty seat by the window." },
      { heading: "INT. CAFE - WINDOW TABLE - LATER", script: "The stranger slides the second cup across the table to nobody. Mia unties her apron, walks over and sits.\n\nMIA: Who's the second one for?\n\nHe pushes the cup toward her. She smiles.\n\nMIA: Today, it's for me." },
    ],
    characters: [
      { name: "Mia", visible: true, static_features: "late 20s, short black hair, freckles", dynamic_features: "green apron over a white shirt" },
      { name: "The stranger", visible: true, static_features: "60s, silver beard, tall", dynamic_features: "grey wool coat, wet from rain" },
    ],
    shots: shots(6),
    portraits: ["Mia", "The stranger"],
    estimate_usd: "1.500000",
    spent_usd: "0.390000",
    approval_status: null,
    needs_approval: false,
    has_video: false,
    error: null,
    progress: { shots: 6, frames: 6, clips: 0 },
    created_at: "2026-11-25T09:12:00Z",
    updated_at: "2026-11-25T09:20:00Z",
    ...over,
  };
}

export const FX_STORY_WRITING = story("st-writing", "writing", { title: "", logline: "", scenes: [], characters: [], shots: [], portraits: [], progress: { shots: 0, frames: 0, clips: 0 }, spent_usd: "0" });
export const FX_STORY_SCRIPT = story("st-script", "script_ready", { characters: [], shots: [], portraits: [], progress: { shots: 0, frames: 0, clips: 0 }, spent_usd: "0.020000" });
export const FX_STORY_BOARDING = story("st-boarding", "boarding", { shots: shots(2), portraits: ["Mia"], progress: { shots: 6, frames: 2, clips: 0 } });
export const FX_STORY_BOARD = story("st-board", "storyboard_ready");
export const FX_STORY_APPROVAL = story("st-approval", "awaiting_approval", { estimate_usd: "6.000000", needs_approval: true, approval_status: "pending", shots: shots(6).map((s) => ({ ...s, duration_sec: 10 })) });
export const FX_STORY_RENDERING = story("st-rendering", "rendering", { shots: shots(6, 4), progress: { shots: 6, frames: 6, clips: 4 } });
export const FX_STORY_DONE = story("st-done", "done", { shots: shots(6, 6), progress: { shots: 6, frames: 6, clips: 6 }, has_video: true, spent_usd: "1.890000", estimate_usd: "0" });
export const FX_STORY_FAILED = story("st-failed", "failed", { stage: "render", shots: shots(6, 3), progress: { shots: 6, frames: 6, clips: 3 }, error: "Stopped at a spend limit: user hit global daily cap during job: $15.02 >= $15.00" });

export const FX_STORY_LIST: StorySummary[] = [FX_STORY_RENDERING, FX_STORY_APPROVAL, FX_STORY_DONE, FX_STORY_FAILED].map((s, i) => ({
  id: s.id,
  title: ["The Second Cup", "Grandma's Recipe", "Morning Ritual", "Rain Check"][i]!,
  status: s.status,
  stage: s.stage,
  shots: s.shots.length,
  spent_usd: s.spent_usd,
  has_video: s.has_video,
  created_at: s.created_at,
}));
