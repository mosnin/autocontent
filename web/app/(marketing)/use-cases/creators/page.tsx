import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/use-cases/creators"];
export const metadata = storyMetadata(story, "/use-cases/creators");
export default function Page() {
  return <StoryPage story={story} />;
}
