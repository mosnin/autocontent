import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { HeadshotBatchDetail, HeadshotStyle } from "@/lib/headshots-client";
import { HeadshotBatchClient } from "./HeadshotBatchClient";

export const dynamic = "force-dynamic";

export default async function HeadshotBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: HeadshotBatchDetail;
  try {
    detail = await api<HeadshotBatchDetail>(`/api/v1/headshots/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) notFound();
    throw e;
  }
  // The catalog is a separate, ungated read: it turns a style_key into the
  // label and art direction the batch was actually rendered with.
  const styles = await api<{ styles: HeadshotStyle[] }>("/api/v1/headshots/styles")
    .then((r) => r.styles ?? [])
    .catch(() => [] as HeadshotStyle[]);

  return <HeadshotBatchClient initial={detail} styles={styles} />;
}
