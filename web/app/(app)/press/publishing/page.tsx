import { api } from "@/lib/api";
import type { PublishTarget } from "@/lib/types";
import { PublishingClient } from "./PublishingClient";

export const dynamic = "force-dynamic";

// Publish target registry: WordPress sites and generic webhooks a finished
// article can be pushed to. Secrets are write-only; the API never echoes
// them back.
export default async function PublishingPage() {
  const targets = await api<PublishTarget[]>("/api/v1/press/targets");

  return <PublishingClient initial={targets} />;
}
