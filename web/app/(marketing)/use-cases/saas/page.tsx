import { StoryPage, storyMetadata } from "@/components/marketing/story-page";
import stories from "@/lib/marketing/stories.json";
const story = stories["/use-cases/saas"];
export const metadata = storyMetadata(story, "/use-cases/saas");
export default function Page() {
  return <StoryPage story={story} />;
}
