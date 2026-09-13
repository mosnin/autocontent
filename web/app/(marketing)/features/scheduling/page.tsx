import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/features/scheduling"];
export const metadata = storyMetadata(story, "/features/scheduling");
export default function Page() {
  return <StoryPage story={story} />;
}
