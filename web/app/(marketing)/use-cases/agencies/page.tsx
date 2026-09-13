import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/use-cases/agencies"];
export const metadata = storyMetadata(story, "/use-cases/agencies");
export default function Page() {
  return <StoryPage story={story} />;
}
