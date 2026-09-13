import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/features/library"];
export const metadata = storyMetadata(story, "/features/library");
export default function Page() {
  return <StoryPage story={story} />;
}
