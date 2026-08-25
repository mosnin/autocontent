import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { DramaDetail } from "@/lib/dramas-client";
import { DramaDetailClient } from "./DramaDetailClient";

export const dynamic = "force-dynamic";

export default async function DramaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: DramaDetail;
  try {
    detail = await api<DramaDetail>(`/api/v1/dramas/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A drama belonging to another user is a 404, never a 403 - ids can't be
    // probed, so "missing" and "not yours" are the same page.
    if (msg.startsWith("404") || msg.startsWith("422")) notFound();
    throw e;
  }

  return <DramaDetailClient id={id} initial={detail} />;
}
