import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/use-cases/ai-agents"];
export const metadata = storyMetadata(story, "/use-cases/ai-agents");
export default function Page() {
  return <StoryPage story={story} />;
}
