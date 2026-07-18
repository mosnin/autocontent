import { api } from "@/lib/api";
import type { GscStatus } from "@/lib/press-analytics-client";
import { SearchConsoleClient } from "./SearchConsoleClient";

export const dynamic = "force-dynamic";

// Search Console connection center: connect the OAuth app, pick a verified
// site, and see connection status. Rankings/gaps live on their own pages
// once a site is set.
export default async function SearchConsolePage() {
  const status = await api<GscStatus>("/api/v1/gsc/status");

  return <SearchConsoleClient initial={status} />;
}
