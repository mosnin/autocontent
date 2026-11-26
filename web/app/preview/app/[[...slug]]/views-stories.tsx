// Preview views for story videos (Content → Story video), one per step. key = path after /preview/app/.
import type { ReactNode } from "react";
import { StoriesView } from "@/components/app/stories/stories-view";
import { StoryView } from "@/components/app/stories/story-view";
import { FX_STORY_APPROVAL, FX_STORY_BOARD, FX_STORY_BOARDING, FX_STORY_DONE, FX_STORY_FAILED, FX_STORY_LIST, FX_STORY_RENDERING, FX_STORY_SCRIPT, FX_STORY_WRITING } from "@/lib/fixtures-stories";

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  "content/stories": () => <StoriesView preview stories={FX_STORY_LIST} />,
  "content/stories/empty": () => <StoriesView preview stories={[]} />,
  "content/stories/writing": () => <StoryView preview story={FX_STORY_WRITING} />,
  "content/stories/script": () => <StoryView preview story={FX_STORY_SCRIPT} />,
  "content/stories/boarding": () => <StoryView preview story={FX_STORY_BOARDING} />,
  "content/stories/storyboard": () => <StoryView preview story={FX_STORY_BOARD} />,
  "content/stories/approval": () => <StoryView preview story={FX_STORY_APPROVAL} />,
  "content/stories/rendering": () => <StoryView preview story={FX_STORY_RENDERING} />,
  "content/stories/done": () => <StoryView preview story={FX_STORY_DONE} />,
  "content/stories/failed": () => <StoryView preview story={FX_STORY_FAILED} />,
};
