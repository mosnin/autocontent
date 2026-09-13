import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/features/seo"];
export const metadata = storyMetadata(story, "/features/seo");
export default function Page() {
  return <StoryPage story={story} />;
}
