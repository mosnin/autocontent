import { api } from "@/lib/api";
import type { Article } from "@/lib/types";
import { RepurposeClient } from "./RepurposeClient";

export const dynamic = "force-dynamic";

// Pick a finished article and turn it into platform-native social posts.
export default async function RepurposePage() {
  const articles = await api<Article[]>("/api/v1/articles?status_filter=done&limit=200");

  return <RepurposeClient articles={articles} />;
}
