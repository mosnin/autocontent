import { api } from "@/lib/api";
import type { HeadshotBatch, HeadshotStyle } from "@/lib/headshots-client";
import type { Niche } from "@/lib/types";
import { HeadshotsClient } from "./HeadshotsClient";

export const dynamic = "force-dynamic";

export default async function HeadshotsPage() {
  // The style catalog is pure data and stays readable even when the lane has
  // no image key, so the picker can render while an operator sets it - the
  // write endpoints are the ones that answer 409.
  const [styles, batches, niches] = await Promise.all([
    api<{ styles: HeadshotStyle[] }>("/api/v1/headshots/styles")
      .then((r) => r.styles ?? [])
      .catch(() => [] as HeadshotStyle[]),
    api<HeadshotBatch[]>("/api/v1/headshots?limit=50").catch(() => [] as HeadshotBatch[]),
    api<Niche[]>("/api/v1/niches").catch(() => [] as Niche[]),
  ]);
  return (
    <HeadshotsClient initialStyles={styles} initialBatches={batches} niches={niches} />
  );
}
