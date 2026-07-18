import { api } from "@/lib/api";
import type { MediaAssetPage } from "@/lib/studio-client";
import { LibraryClient } from "./LibraryClient";

export const dynamic = "force-dynamic";

async function fetchInitialPage(): Promise<MediaAssetPage | null> {
  try {
    return await api<MediaAssetPage>("/api/v1/media?limit=48");
  } catch {
    return null;
  }
}

// Media library: every pipeline render and Content Studio result, browsable
// and searchable by kind/source. First page is fetched server-side for a
// fast first paint; filtering and further pages are client-driven.
export default async function LibraryPage() {
  const initialPage = await fetchInitialPage();
  return <LibraryClient initialPage={initialPage} />;
}
