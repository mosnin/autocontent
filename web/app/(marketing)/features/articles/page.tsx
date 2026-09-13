import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/features/articles"];
export const metadata = storyMetadata(story, "/features/articles");
export default function Page() {
  return <StoryPage story={story} />;
}
