import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/how-it-works"];
export const metadata = storyMetadata(story, "/how-it-works");
export default function Page() {
  return <StoryPage story={story} />;
}
