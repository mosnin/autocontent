import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import type { MediaAsset } from "@/lib/studio-client";
import { StudioClient } from "./StudioClient";

export const dynamic = "force-dynamic";

async function fetchSourceAsset(id: string): Promise<MediaAsset | null> {
  try {
    return await api<MediaAsset>(`/api/v1/media/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

async function fetchNiches(): Promise<Niche[]> {
  try {
    return await api<Niche[]>("/api/v1/niches");
  } catch {
    return [];
  }
}

// Content Studio: on-demand image/video generation tools. `?source=<id>`
// (set by the library's "send to Studio" action) preselects that asset as
// the working source for edit/upscale/remove-bg/animate.
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const [initialSource, niches] = await Promise.all([
    source ? fetchSourceAsset(source) : Promise.resolve(null),
    fetchNiches(),
  ]);

  return <StudioClient initialSource={initialSource} niches={niches} />;
}
