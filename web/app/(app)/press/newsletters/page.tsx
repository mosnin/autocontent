import { api } from "@/lib/api";
import type { NewsletterDigest, NewsletterSettings } from "@/lib/press-analytics-client";
import { NewslettersClient } from "./NewslettersClient";

export const dynamic = "force-dynamic";

// Newsletter digests: cadence settings, compose-now from recently done
// articles, send, and digest history with a markdown preview.
export default async function NewslettersPage() {
  const [settings, digests] = await Promise.all([
    api<NewsletterSettings>("/api/v1/newsletters/settings"),
    api<NewsletterDigest[]>("/api/v1/newsletters"),
  ]);

  return <NewslettersClient initialSettings={settings} initialDigests={digests} />;
}
