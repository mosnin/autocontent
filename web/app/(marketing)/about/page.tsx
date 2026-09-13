import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/about"];
export const metadata = storyMetadata(story, "/about");
export default function Page() {
  return <StoryPage story={story} />;
}
