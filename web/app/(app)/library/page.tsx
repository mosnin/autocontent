import { LibraryView } from "@/components/mk/library/library-view";
import type { Composition, ImagePost, MediaAsset, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Library · Marketer" };

export default async function LibraryPage() {
  const [finals, clips, images, compositions, imagePosts, niches] = await Promise.all([
    safe<MediaAsset[]>("/api/v1/library?kind=final&limit=100"),
    safe<MediaAsset[]>("/api/v1/library?kind=clip&limit=200"),
    safe<MediaAsset[]>("/api/v1/library?kind=keyframe&limit=200"),
    safe<Composition[]>("/api/v1/library/compositions?limit=50"),
    safe<ImagePost[]>("/api/v1/image-posts?limit=25"),
    safe<Niche[]>("/api/v1/niches"),
  ]);
  return (
    <LibraryView
      initialFinals={finals ?? []}
      initialClips={clips ?? []}
      initialImages={images ?? []}
      initialCompositions={compositions ?? []}
      initialImagePosts={imagePosts ?? []}
      loadError={finals === null && clips === null && compositions === null}
      niches={(niches ?? []).filter((n) => !n.archived_at).map((n) => ({ id: n.id, title: n.title }))}
    />
  );
}
