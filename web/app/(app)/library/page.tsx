import { api } from "@/lib/api";
import type { Composition, MediaAsset, Niche } from "@/lib/types";
import { LibraryClient } from "./LibraryClient";

export const dynamic = "force-dynamic";

export default async function Library() {
  const [finals, clips, compositions, niches] = await Promise.all([
    api<MediaAsset[]>("/api/v1/library?kind=final&limit=100"),
    api<MediaAsset[]>("/api/v1/library?kind=clip&limit=200"),
    api<Composition[]>("/api/v1/library/compositions?limit=50"),
    api<Niche[]>("/api/v1/niches"),
  ]);
  return (
    <LibraryClient
      initialFinals={finals}
      initialClips={clips}
      initialCompositions={compositions}
      niches={niches}
    />
  );
}
