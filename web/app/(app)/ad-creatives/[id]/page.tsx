import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { AdRunDetail } from "@/lib/ad-creatives-client";
import { AdRunDetailClient } from "./AdRunDetailClient";

export const dynamic = "force-dynamic";

export default async function AdRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: AdRunDetail;
  try {
    detail = await api<AdRunDetail>(`/api/v1/ad-creatives/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) notFound();
    throw e;
  }
  return <AdRunDetailClient initial={detail} />;
}
