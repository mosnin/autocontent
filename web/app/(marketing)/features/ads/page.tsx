import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/features/ads"];
export const metadata = storyMetadata(story, "/features/ads");
export default function Page() {
  return <StoryPage story={story} />;
}
