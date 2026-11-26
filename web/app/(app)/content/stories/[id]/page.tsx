import { StoryView } from "@/components/app/stories/story-view";
import type { Story } from "@/components/app/stories/types";
import { toolGlyph } from "@/components/app/content/shared";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Story video · Marketer" };

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await safe<Story>(`/api/v1/stories/${encodeURIComponent(id)}`);
  if (!story) {
    return (
      <>
        <PageHeader icon={toolGlyph("content")} crumbs={[{ label: "Content", href: "/content" }, { label: "Story videos", href: "/content/stories" }]} />
        <Column width="sm">
          <EmptyLine action={<ButtonLink href="/content/stories" variant="primary">Back to story videos</ButtonLink>}>Couldn&apos;t find that story video. It may have been removed.</EmptyLine>
        </Column>
      </>
    );
  }
  return <StoryView story={story} />;
}
